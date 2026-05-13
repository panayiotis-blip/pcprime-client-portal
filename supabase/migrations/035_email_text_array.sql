-- 035_email_text_array.sql
-- Bug A3: clients.email is a single text column, but real-world data has
-- multiple addresses per client (owner + accountant + reception). Converting
-- to text[] is cleaner than parsing a single string everywhere.
--
-- The conversion uses regexp_split_to_array to split existing values on ';'
-- or ',', trim each, drop empties. Single-email rows become single-element
-- arrays. Null/empty stays null.

begin;

alter table public.clients
  alter column email type text[]
  using case
    when email is null or trim(email) = '' then null
    else (
      select array_agg(trim(p))
      from unnest(regexp_split_to_array(email, '[,;]+')) p
      where trim(p) <> ''
    )
  end;

comment on column public.clients.email is
  'Array of contact email addresses. Multi-email is the norm — owner + accountant + reception. Display joined with "; "; bulk import splits the cell on ";" or ","; the API methods translate at the boundary so frontend keeps using a string form.';

-- ------------------------------------------------------------
-- Update bulk_import_clients to accept the incoming JSON email string
-- and store as text[]. Same RPC, only the email field expression changes.
-- ------------------------------------------------------------
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
  v_email_arr  text[];
  v_email_str  text;
  v_inserted   jsonb := '{}'::jsonb;
  v_errors     jsonb := '[]'::jsonb;
  v_count_ok   int := 0;
  v_count_err  int := 0;
  v_id         bigint;
begin
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') not in ('owner', 'supervisor') then
    raise exception 'Bulk import requires owner or supervisor role';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  v_batch_id := 'bulk_import_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MISS')
              || '_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);

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

      v_code := nullif(trim(coalesce(v_row->>'client_code', '')), '');
      if v_code is null then
        v_code := public.generate_client_code_v2(v_name);
      end if;

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

      v_category := nullif(trim(coalesce(v_row->>'client_category', '')), '');
      if v_category is not null and v_category not in (
        'company','partnership','individual','sole_trader',
        'self_employed','deceased','dormant','prospective','other'
      ) then
        v_category := null;
      end if;

      v_status := nullif(trim(coalesce(v_row->>'status', '')), '');
      if v_status is null then v_status := 'active'; end if;

      -- Split email on ';' or ',' into text[]; null if no parts
      v_email_str := nullif(trim(coalesce(v_row->>'email', '')), '');
      if v_email_str is null then
        v_email_arr := null;
      else
        select array_agg(trim(p)) into v_email_arr
        from unnest(regexp_split_to_array(v_email_str, '[,;]+')) p
        where trim(p) <> '';
        if v_email_arr is null or array_length(v_email_arr, 1) is null then
          v_email_arr := null;
        end if;
      end if;

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
        v_email_arr,    -- text[] from split
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

commit;
-- =============================================================
-- Verify:
--   select email from clients where deleted_at is null and email is not null
--     and array_length(email, 1) > 1 limit 5;
--   -- expect each row showing an array {a@x.com,b@y.com}
--
--   select email from clients where deleted_at is null and email is not null
--     and array_length(email, 1) = 1 limit 5;
--   -- expect single-element arrays {a@x.com}
-- =============================================================
