-- =============================================================
-- Migration 057: hard_delete_clients RPC (UI Refinements Part D)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Permanently deletes soft-deleted clients. Owner-only + MFA (aal2).
--
-- Safety rules per client:
--   * must already be soft-deleted (deleted_at is not null)
--   * BLOCKED if the client has any sales invoice (client_invoices) —
--     those are financial records and must not be destroyed
--   * otherwise DELETEd; FK cascades remove addresses, directors,
--     documents rows, credentials, compliance tasks, etc.
--
-- Per-row delete passes a single-element array; the bulk "Empty Deleted
-- Clients" passes every soft-deleted id. Skipped clients are returned
-- with a reason. One summary row is written to audit_log.
--
-- NOTE: storage objects (document / KYC / email-attachment files) are
-- NOT removed here — they become orphaned blobs in their buckets.
-- =============================================================

create or replace function public.hard_delete_clients(p_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_role    text;
  v_id      bigint;
  v_name    text;
  v_deleted int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public.require_aal2();          -- step-up MFA required
  select email, role into v_email, v_role from public.profiles where id = v_uid;
  if v_role <> 'owner' then
    raise exception 'Only the owner can permanently delete clients';
  end if;

  foreach v_id in array coalesce(p_ids, array[]::bigint[])
  loop
    select name into v_name from public.clients where id = v_id;
    if v_name is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not found');
      continue;
    end if;
    if not exists (select 1 from public.clients where id = v_id and deleted_at is not null) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name,
                                                   'reason', 'not in the deleted list');
      continue;
    end if;
    if exists (select 1 from public.client_invoices where client_id = v_id) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'name', v_name,
                                                   'reason', 'has sales invoices — cannot be deleted');
      continue;
    end if;
    delete from public.clients where id = v_id;
    v_deleted := v_deleted + 1;
  end loop;

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (
    v_uid, v_email, 'clients.hard_delete', 'clients', null,
    jsonb_build_object('deleted', v_deleted, 'skipped', jsonb_array_length(v_skipped))
  );

  return jsonb_build_object('deleted', v_deleted, 'skipped', v_skipped);
end $$;

revoke all     on function public.hard_delete_clients(bigint[]) from public;
grant  execute on function public.hard_delete_clients(bigint[]) to authenticated;

-- =============================================================
-- End of migration 057.
-- =============================================================
