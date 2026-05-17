-- =============================================================
-- Migration 061: merge_clients RPC
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Merges a duplicate client into a keeper. Owner/supervisor only, MFA (aal2).
--
-- All child records are re-pointed from the source client to the target,
-- then the source client is permanently deleted in the same transaction
-- (all-or-nothing — any error rolls the whole thing back).
--
-- Collision tables (chart of accounts, system folders, vendor patterns,
-- compliance tasks, addresses, emails, user-access links): rows the keeper
-- already has an equivalent of are NOT moved — the keeper's version wins,
-- and the source's duplicate is dropped when the source client is deleted.
--
-- p_overrides: a JSON object of clients-column → chosen value, applied to
-- the keeper (the per-field "keep / from" choices made in the merge UI).
-- Unknown keys are ignored.
--
-- KNOWN LIMITATION: document/email storage FILES are not relocated — their
-- rows move to the keeper but the blobs stay under the original storage
-- path. Acceptable for de-duplicating clients; revisit if it becomes an issue.
-- =============================================================

create or replace function public.merge_clients(
  p_target    bigint,
  p_source    bigint,
  p_overrides jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_role  text;
  v_tname text;
  v_sname text;
  v_key   text;
  v_val   text;
  v_sf    record;
  v_twin  bigint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public.require_aal2();                       -- step-up MFA required
  select role  into v_role  from public.profiles where id = v_uid;
  select email into v_email from auth.users     where id = v_uid;
  if v_role not in ('owner', 'supervisor') then
    raise exception 'Only owners and supervisors can merge clients';
  end if;

  if p_target is null or p_source is null then
    raise exception 'Both a keep and a merge-from client are required';
  end if;
  if p_target = p_source then
    raise exception 'Cannot merge a client into itself';
  end if;
  select name into v_tname from public.clients where id = p_target;
  select name into v_sname from public.clients where id = p_source;
  if v_tname is null then raise exception 'Keep client % not found', p_target; end if;
  if v_sname is null then raise exception 'Merge-from client % not found', p_source; end if;

  -- ---- Collision-free child tables: straight re-point ----
  update public.invoices             set client_id = p_target where client_id = p_source;
  update public.platform_credentials set client_id = p_target where client_id = p_source;
  update public.staff_tasks          set client_id = p_target where client_id = p_source;
  update public.appointments         set client_id = p_target where client_id = p_source;
  update public.call_logs            set client_id = p_target where client_id = p_source;
  update public.client_tax_filings   set client_id = p_target where client_id = p_source;
  update public.time_entries         set client_id = p_target where client_id = p_source;
  update public.active_timers        set client_id = p_target where client_id = p_source;
  update public.client_invoices      set client_id = p_target where client_id = p_source;
  update public.client_directors     set client_id = p_target where client_id = p_source;
  update public.client_directors     set director_client_id = p_target where director_client_id = p_source;

  -- ---- Folders: where the keeper already has the same system folder,
  --      re-home the source folder's documents/sub-folders onto the twin
  --      and drop the duplicate; move everything else. ----
  for v_sf in
    select id, category_key from public.folders
    where client_id = p_source and is_system = true and coalesce(category_key, '') <> ''
  loop
    select id into v_twin from public.folders
      where client_id = p_target and is_system = true and category_key = v_sf.category_key
      limit 1;
    if v_twin is not null then
      update public.documents set folder_id = v_twin where folder_id = v_sf.id;
      update public.folders   set parent_id = v_twin where parent_id = v_sf.id;
      delete from public.folders where id = v_sf.id;
    end if;
  end loop;
  update public.folders   set client_id = p_target where client_id = p_source;
  update public.documents set client_id = p_target where client_id = p_source;

  -- ---- Collision tables: move only rows the keeper has no equivalent of.
  --      The rest stay on the source and are cleared by the cascade when
  --      the source client is deleted below. ----
  update public.accounts a set client_id = p_target
    where a.client_id = p_source
      and not exists (select 1 from public.accounts t
                      where t.client_id = p_target and t.code = a.code);

  update public.vendor_patterns v set client_id = p_target
    where v.client_id = p_source
      and not exists (select 1 from public.vendor_patterns t
                      where t.client_id = p_target
                        and t.vendor_name_normalized = v.vendor_name_normalized);

  update public.compliance_tasks c set client_id = p_target
    where c.client_id = p_source
      and not exists (select 1 from public.compliance_tasks t
                      where t.client_id = p_target and t.kind = c.kind
                        and t.period_start is not distinct from c.period_start);

  update public.client_addresses ca set client_id = p_target
    where ca.client_id = p_source
      and not exists (select 1 from public.client_addresses t
                      where t.client_id = p_target and t.address_type = ca.address_type);

  update public.client_emails ce set client_id = p_target
    where ce.client_id = p_source
      and not exists (select 1 from public.client_emails t
                      where t.client_id = p_target
                        and t.raw_message_id is not distinct from ce.raw_message_id);

  update public.user_clients uc set client_id = p_target
    where uc.client_id = p_source
      and not exists (select 1 from public.user_clients t
                      where t.client_id = p_target and t.user_id = uc.user_id);

  -- ---- Apply the chosen "keep / from" field values to the keeper.
  --      Unknown / non-column keys are silently ignored. ----
  for v_key, v_val in select * from jsonb_each_text(coalesce(p_overrides, '{}'::jsonb))
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'clients' and column_name = v_key
    ) then
      execute format('update public.clients set %I = $1 where id = $2', v_key)
        using nullif(v_val, ''), p_target;
    end if;
  end loop;

  -- ---- Remove the now-emptied source client. The FK cascade clears any
  --      leftover duplicate rows left behind in the collision tables. ----
  delete from public.clients where id = p_source;

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (
    v_uid, v_email, 'clients.merge', 'clients', p_target::text,
    jsonb_build_object('kept', p_target, 'kept_name', v_tname,
                       'merged_from', p_source, 'merged_from_name', v_sname)
  );

  return jsonb_build_object(
    'kept',             p_target,
    'kept_name',        v_tname,
    'merged_from',      p_source,
    'merged_from_name', v_sname
  );
end $$;

revoke all     on function public.merge_clients(bigint, bigint, jsonb) from public;
grant  execute on function public.merge_clients(bigint, bigint, jsonb) to authenticated;

-- =============================================================
-- End of migration 061.
-- =============================================================
