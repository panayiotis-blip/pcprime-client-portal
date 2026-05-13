-- 032_bulk_import_clients.sql
-- Phase 4: server-side helpers for the Excel bulk-import flow.
--
--   bulk_import_clients(rows jsonb)   — inserts a batch of clients, returns
--                                       summary { batch_id, inserted, errors,
--                                       codes_to_ids, error_details }.
--   rollback_bulk_import(batch_id)    — soft-deletes everything from a batch
--                                       within 24h of import.
--   list_recent_bulk_imports()        — for the rollback UI; lists batches
--                                       from the last 7 days.

begin;

-- ============================================================
-- bulk_import_clients
-- ============================================================
create or replace function public.bulk_import_clients(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_role       text;
  v_batch_id   text;
  v_row        jsonb;
  v_idx        int := 0;
  v_name       text;
  v_code       text;
  v_category   text;
  v_status     text;
  v_inserted   jsonb := '{}'::jsonb;
  v_errors     jsonb := '[]'::jsonb;
  v_count_ok   int := 0;
  v_count_err  int := 0;
  v_id         bigint;
begin
  -- Step-up MFA + role gate
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') not in ('owner', 'supervisor') then
    raise exception 'Bulk import requires owner or supervisor role';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  -- Generate a batch id with embedded timestamp so rollback can enforce the 24h window
  v_batch_id := 'bulk_import_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MISS')
              || '_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);

  -- Per-row insertion with savepoint isolation: one bad row doesn't kill the batch
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_name := nullif(trim(coalesce(v_row->>'name', '')), '');
      if v_name is null then
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'name is required');
        v_count_err := v_count_err + 1;
        continue;
      end if;

      -- Use provided client_code, or generate one (v2: no 221 prefix)
      v_code := nullif(trim(coalesce(v_row->>'client_code', '')), '');
      if v_code is null then
        v_code := public.generate_client_code_v2(v_name);
      end if;

      -- Skip duplicates against LIVE clients (deleted_at is null)
      if exists (
        select 1 from public.clients
        where client_code = v_code and deleted_at is null
      ) then
        v_errors := v_errors || jsonb_build_object(
          'row', v_idx, 'client_code', v_code,
          'error', 'client_code already exists in live data — skipped'
        );
        v_count_err := v_count_err + 1;
        continue;
      end if;

      -- Validate / sanitise enum-ish fields. Drop unknown values to NULL so the
      -- CHECK constraint doesn't kill the row.
      v_category := nullif(trim(coalesce(v_row->>'client_category', '')), '');
      if v_category is not null and v_category not in (
        'company','partnership','individual','sole_trader',
        'self_employed','deceased','dormant','prospective','other'
      ) then
        v_category := null;
      end if;

      v_status := nullif(trim(coalesce(v_row->>'status', '')), '');
      if v_status is null then v_status := 'active'; end if;

      insert into public.clients (
        client_code, name, name_tax_office, trading_name, business_type, client_category,
        tax_return_type, status, is_active,
        tax_number, vat_number, registration_number,
        employer_number, ergani_number, id_number, passport_number,
        date_of_birth, nationality, contact_person, director_name,
        email, phone, mobile, fax, website,
        address, city, postal_code, country,
        incorporation_date, year_end_date, financial_year_end, vat_period,
        notes, bulk_import_batch_id
      ) values (
        v_code, v_name,
        nullif(trim(coalesce(v_row->>'name_tax_office', '')), ''),
        nullif(trim(coalesce(v_row->>'trading_name', '')), ''),
        nullif(trim(coalesce(v_row->>'business_type', '')), ''),
        v_category,
        nullif(trim(coalesce(v_row->>'tax_return_type', '')), ''),
        v_status,
        coalesce((v_row->>'is_active')::boolean, lower(v_status) = 'active'),
        nullif(trim(coalesce(v_row->>'tax_number', '')), ''),
        nullif(trim(coalesce(v_row->>'vat_number', '')), ''),
        nullif(trim(coalesce(v_row->>'registration_number', '')), ''),
        nullif(trim(coalesce(v_row->>'employer_number', '')), ''),
        nullif(trim(coalesce(v_row->>'ergani_number', '')), ''),
        nullif(trim(coalesce(v_row->>'id_number', '')), ''),
        nullif(trim(coalesce(v_row->>'passport_number', '')), ''),
        nullif(v_row->>'date_of_birth', '')::date,
        nullif(trim(coalesce(v_row->>'nationality', '')), ''),
        nullif(trim(coalesce(v_row->>'contact_person', '')), ''),
        nullif(trim(coalesce(v_row->>'director_name', '')), ''),
        nullif(trim(coalesce(v_row->>'email', '')), ''),
        nullif(trim(coalesce(v_row->>'phone', '')), ''),
        nullif(trim(coalesce(v_row->>'mobile', '')), ''),
        nullif(trim(coalesce(v_row->>'fax', '')), ''),
        nullif(trim(coalesce(v_row->>'website', '')), ''),
        nullif(trim(coalesce(v_row->>'address', '')), ''),
        nullif(trim(coalesce(v_row->>'city', '')), ''),
        nullif(trim(coalesce(v_row->>'postal_code', '')), ''),
        nullif(trim(coalesce(v_row->>'country', '')), ''),
        nullif(v_row->>'incorporation_date', '')::date,
        nullif(trim(coalesce(v_row->>'year_end_date', '')), ''),
        nullif(trim(coalesce(v_row->>'financial_year_end', '')), ''),
        nullif(trim(coalesce(v_row->>'vat_period', '')), ''),
        nullif(trim(coalesce(v_row->>'notes', '')), ''),
        v_batch_id
      ) returning id into v_id;

      v_inserted := v_inserted || jsonb_build_object(v_code, v_id);
      v_count_ok := v_count_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', sqlerrm);
      v_count_err := v_count_err + 1;
    end;
  end loop;

  -- Single audit log entry tagged with the batch id
  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (
    v_user_id, v_user_email, 'clients.bulk_import', 'clients', v_batch_id,
    jsonb_build_object('batch_id', v_batch_id, 'inserted', v_count_ok, 'errors', v_count_err)
  );

  return jsonb_build_object(
    'batch_id',      v_batch_id,
    'inserted',      v_count_ok,
    'errors',        v_count_err,
    'codes_to_ids',  v_inserted,
    'error_details', v_errors
  );
end $$;

revoke all on function public.bulk_import_clients(jsonb) from public;
grant   execute on function public.bulk_import_clients(jsonb) to authenticated;

-- ============================================================
-- rollback_bulk_import — soft-delete a batch within 24h
-- ============================================================
create or replace function public.rollback_bulk_import(p_batch_id text)
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
  v_batch_ts   timestamptz;
  v_ts_str     text;
begin
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') not in ('owner', 'supervisor') then
    raise exception 'Rollback requires owner or supervisor role';
  end if;

  -- Pull the timestamp portion out of the batch id (bulk_import_YYYYMMDD_HH24MISS_xxx)
  v_ts_str := substring(p_batch_id from 'bulk_import_(\d{8}_\d{6})');
  if v_ts_str is null then
    raise exception 'Invalid batch_id format';
  end if;
  begin
    v_batch_ts := to_timestamp(v_ts_str, 'YYYYMMDD_HH24MISS') at time zone 'UTC';
  exception when others then
    raise exception 'Invalid batch_id timestamp';
  end;

  if (now() - v_batch_ts) > interval '24 hours' then
    raise exception 'Rollback window expired (24h after import). Use per-client restore from Deleted Clients instead.';
  end if;

  with u as (
    update public.clients
    set deleted_at = now()
    where bulk_import_batch_id = p_batch_id
      and deleted_at is null
    returning 1
  ) select count(*) into v_count from u;

  select email into v_user_email from auth.users where id = v_user_id;
  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (
    v_user_id, v_user_email, 'clients.bulk_import_rollback', 'clients', p_batch_id,
    jsonb_build_object('batch_id', p_batch_id, 'rolled_back', v_count)
  );

  return jsonb_build_object('batch_id', p_batch_id, 'rolled_back', v_count);
end $$;

revoke all on function public.rollback_bulk_import(text) from public;
grant   execute on function public.rollback_bulk_import(text) to authenticated;

-- ============================================================
-- list_recent_bulk_imports — for the rollback UI
-- ============================================================
create or replace function public.list_recent_bulk_imports()
returns table (
  batch_id      text,
  imported_at   timestamptz,
  client_count  int,
  active_count  int,
  age_hours     numeric,
  can_rollback  boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  with batches as (
    select
      bulk_import_batch_id as batch_id,
      min(created_at)      as imported_at,
      count(*)::int        as client_count,
      count(*) filter (where deleted_at is null)::int as active_count
    from public.clients
    where bulk_import_batch_id is not null
      and created_at > now() - interval '7 days'
    group by bulk_import_batch_id
  )
  select
    batch_id, imported_at, client_count, active_count,
    round(extract(epoch from (now() - imported_at)) / 3600.0, 1) as age_hours,
    (now() - imported_at < interval '24 hours' and active_count > 0) as can_rollback
  from batches
  order by imported_at desc;
$$;

revoke all on function public.list_recent_bulk_imports() from public;
grant   execute on function public.list_recent_bulk_imports() to authenticated;

commit;
