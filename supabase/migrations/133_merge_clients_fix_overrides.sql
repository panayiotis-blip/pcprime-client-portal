-- =============================================================
-- Migration 133: fix merge_clients — array-typed & unique overrides
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Two bugs surfaced when merging duplicate clients (both in the field-override
-- step of migration 061's merge_clients):
--
--   1. `column "email" is of type text[] but expression is of type text`
--      Some clients columns are ARRAYS (e.g. email text[]). The override loop
--      always bound the chosen value as scalar text, so re-pointing an array
--      column failed. → The loop is now type-aware: array columns are built
--      into a proper text[] from the JSON value (array or scalar).
--
--   2. `duplicate key value violates constraint "clients_client_code_unique_live"`
--      Overrides were applied to the keeper BEFORE the source was deleted, so
--      choosing the source's client_code (or any other live-unique value) put
--      two live rows with the same code side by side for an instant. → Overrides
--      are now applied AFTER the source client is removed, so its value is free.
--
-- Also adds the `receipts` re-point (a RESTRICT child table missing from the
-- original re-point list — empty today, but it would block future merges).
--
-- Everything else (auth/MFA gate, child re-points, collision handling, audit)
-- is unchanged from migration 061.
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
  v_dtype text;
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
  update public.receipts             set client_id = p_target where client_id = p_source;
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

  -- ---- Remove the now-emptied source client FIRST, so any live-unique value
  --      it held (e.g. client_code) is freed before we apply overrides. The FK
  --      cascade clears leftover duplicate rows in the collision tables. ----
  delete from public.clients where id = p_source;

  -- ---- Apply the chosen "keep / from" field values to the keeper.
  --      Type-aware: array columns (e.g. email text[]) are built into a text[]
  --      from the JSON value (array or scalar). Unknown keys are ignored. ----
  for v_key in select jsonb_object_keys(coalesce(p_overrides, '{}'::jsonb))
  loop
    select data_type into v_dtype
      from information_schema.columns
      where table_schema = 'public' and table_name = 'clients' and column_name = v_key;
    if v_dtype is null then continue; end if;          -- not a real clients column

    if v_dtype = 'ARRAY' then
      execute format('update public.clients set %I = $1 where id = $2', v_key)
        using (
          case
            when jsonb_typeof(p_overrides -> v_key) = 'array'
              then (select array_agg(x) from jsonb_array_elements_text(p_overrides -> v_key) as x)
            when nullif(p_overrides ->> v_key, '') is null then null
            else array[p_overrides ->> v_key]
          end
        ), p_target;
    else
      execute format('update public.clients set %I = $1 where id = $2', v_key)
        using nullif(p_overrides ->> v_key, ''), p_target;
    end if;
  end loop;

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

notify pgrst, 'reload schema';

-- =============================================================
-- End of migration 133.
-- =============================================================
