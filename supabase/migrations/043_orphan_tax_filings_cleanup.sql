-- 043_orphan_tax_filings_cleanup.sql
-- Two fixes:
--   1. The bulk wipe RPC (wipe_test_clients) didn't include
--      client_tax_filings in the list of child rows it deletes. After a wipe
--      + re-import, the new clients didn't pick up the old filings, but the
--      old filings remained pointing to soft-deleted clients, surfacing as
--      "Client #942" placeholders on the Tax Filings page.
--   2. Provide a one-shot cleanup helper to delete orphan tax filings
--      (those whose client row is soft-deleted or missing).

begin;

-- 1. Update wipe_test_clients to also remove tax filings
create or replace function public.wipe_test_clients(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_user_email   text;
  v_role         text;
  v_client_ids   bigint[];
  v_clients      int := 0;
  v_invoices     int := 0;
  v_documents    int := 0;
  v_credentials  int := 0;
  v_compliance   int := 0;
  v_tasks        int := 0;
  v_emails       int := 0;
  v_attachments  int := 0;
  v_appts        int := 0;
  v_calls        int := 0;
  v_uc           int := 0;
  v_directors    int := 0;
  v_tax_filings  int := 0;
  v_note         text;
  v_summary      jsonb;
begin
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') <> 'owner' then
    raise exception 'Only the owner can perform a bulk wipe (current role: %)', coalesce(v_role, 'none');
  end if;
  if coalesce(p_confirmation, '') <> 'WIPE ALL CLIENTS' then
    raise exception 'Confirmation phrase mismatch. Required exactly: WIPE ALL CLIENTS';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  select array_agg(id) into v_client_ids from public.clients where deleted_at is null;
  if v_client_ids is null then v_client_ids := array[]::bigint[]; end if;

  select count(*) into v_attachments
  from public.client_email_attachments
  where email_id in (select id from public.client_emails where client_id = any(v_client_ids));

  with d as (delete from public.client_emails        where client_id = any(v_client_ids) returning 1) select count(*) into v_emails       from d;
  with d as (delete from public.invoices             where client_id = any(v_client_ids) returning 1) select count(*) into v_invoices    from d;
  with d as (delete from public.documents            where client_id = any(v_client_ids) returning 1) select count(*) into v_documents   from d;
  with d as (delete from public.platform_credentials where client_id = any(v_client_ids) returning 1) select count(*) into v_credentials from d;
  with d as (delete from public.compliance_tasks     where client_id = any(v_client_ids) returning 1) select count(*) into v_compliance  from d;
  with d as (delete from public.client_tax_filings   where client_id = any(v_client_ids) returning 1) select count(*) into v_tax_filings from d;
  with d as (delete from public.client_directors     where client_id = any(v_client_ids) or director_client_id = any(v_client_ids) returning 1) select count(*) into v_directors from d;
  with d as (delete from public.staff_tasks          where client_id = any(v_client_ids) returning 1) select count(*) into v_tasks       from d;
  with d as (delete from public.appointments         where client_id = any(v_client_ids) returning 1) select count(*) into v_appts       from d;
  with d as (delete from public.call_logs            where client_id = any(v_client_ids) returning 1) select count(*) into v_calls       from d;
  with d as (delete from public.user_clients         where client_id = any(v_client_ids) returning 1) select count(*) into v_uc          from d;

  v_note := 'Wiped ' || now()::text || ' by ' || coalesce(v_user_email, v_user_id::text) || ' — pre-go-live cleanup';
  with u as (
    update public.clients
    set deleted_at = now(),
        notes      = case when coalesce(notes,'') = '' then v_note else notes || E'\n\n' || v_note end
    where id = any(v_client_ids)
    returning 1
  ) select count(*) into v_clients from u;

  v_summary := jsonb_build_object(
    'clients',              v_clients,
    'invoices',             v_invoices,
    'documents',            v_documents,
    'platform_credentials', v_credentials,
    'compliance_tasks',     v_compliance,
    'client_tax_filings',   v_tax_filings,
    'client_directors',     v_directors,
    'staff_tasks',          v_tasks,
    'client_emails',        v_emails,
    'email_attachments',    v_attachments,
    'appointments',         v_appts,
    'call_logs',            v_calls,
    'user_clients',         v_uc
  );

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (v_user_id, v_user_email, 'clients.bulk_wipe', 'clients', null, v_summary);

  return v_summary;
end $$;

-- 2. One-shot orphan cleanup helper. Deletes tax filings whose client row is
--    either gone or soft-deleted. Owner-only, aal2-required.
create or replace function public.cleanup_orphan_tax_filings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_role       text;
  v_count      int := 0;
begin
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') not in ('owner', 'supervisor') then
    raise exception 'Cleanup requires owner or supervisor role';
  end if;
  select email into v_user_email from auth.users where id = v_user_id;

  with orphans as (
    select tf.id from public.client_tax_filings tf
    left join public.clients c on c.id = tf.client_id
    where c.id is null or c.deleted_at is not null
  ),
  d as (
    delete from public.client_tax_filings
    where id in (select id from orphans)
    returning 1
  )
  select count(*) into v_count from d;

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (v_user_id, v_user_email, 'client_tax_filings.cleanup_orphans', 'client_tax_filings', null,
          jsonb_build_object('deleted', v_count));

  return jsonb_build_object('deleted', v_count);
end $$;

revoke all on function public.cleanup_orphan_tax_filings() from public;
grant   execute on function public.cleanup_orphan_tax_filings() to authenticated;

commit;
-- =============================================================
-- Inspect orphans first (read-only):
--   select tf.id, tf.client_id, tf.tax_year, tf.filing_type, tf.status,
--          c.client_code, c.name, c.deleted_at
--     from public.client_tax_filings tf
--     left join public.clients c on c.id = tf.client_id
--    where c.id is null or c.deleted_at is not null
--    order by tf.client_id;
--
-- Then to wipe them:
--   select public.cleanup_orphan_tax_filings();
-- =============================================================
