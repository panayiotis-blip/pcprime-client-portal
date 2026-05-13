-- 040_bulk_import_v3.sql
-- Part D RPC for clients-v3: full multi-sheet import in a single transaction.
-- Payload shape (all keys optional except clients):
--   {
--     clients:     [ { client_code, name, type, tic, he_number, category, status }, ... ],
--     contacts:    [ { client_code, email, phone, mobile, fax, contact_person, address }, ... ],
--     directors:   [ { company_code, individual_code, individual_name, role }, ... ],
--     credentials: [ { client_code, platform, sub_type, username, password, notes }, ... ],
--     tax_filings: [ { client_code, tax_year, filing_type, status }, ... ]
--   }
--
-- Returns summary { batch_id, clients, contacts, directors, credentials,
-- tax_filings, errors, error_details }.
--
-- Per-row audit is suppressed (via app.bulk_audit_off flag set in migration
-- 039); one summary audit row is written at the end.

begin;

create or replace function public.bulk_import_v3(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := auth.uid();
  v_user_email  text;
  v_role        text;
  v_batch_id    text;

  v_section     jsonb;
  v_row         jsonb;
  v_idx         int;
  v_code_to_id  jsonb := '{}'::jsonb;
  v_id          bigint;
  v_company_id  bigint;
  v_individual_id bigint;
  v_pwd_id      bigint;

  v_count_clients     int := 0;
  v_count_contacts    int := 0;
  v_count_directors   int := 0;
  v_count_credentials int := 0;
  v_count_filings     int := 0;
  v_errors            jsonb := '[]'::jsonb;

  -- Source value → enum value lookups
  v_type_map jsonb := jsonb_build_object(
    'IND',  'individual',
    'CO',   'company',
    'PART', 'partnership'
  );
  v_status_map jsonb := jsonb_build_object(
    'Active',             'active',
    'Old Client',         'old_client',
    'Deceased',           'deceased',
    'Defence Tax Only',   'defence_tax_only',
    'Liquidated/Dormant', 'liquidated_dormant',
    'Internal',           'internal'
  );
  v_filing_type_map jsonb := jsonb_build_object(
    'Individual Tax Return',                  'individual_tax_return',
    'Individual Tax Return (Self-Employed)',  'individual_tax_return_self_employed',
    'Individual Tax Return (Pensioner)',      'individual_tax_return_pensioner',
    'Company Tax Return',                     'company_tax_return',
    'VAT Return',                             'vat_return'
  );
  v_filing_status_map jsonb := jsonb_build_object(
    'Filed',        'filed',
    'Not Required', 'not_required',
    'N/A',          'not_required',
    'Pending',      'pending'
  );

  v_code       text;
  v_name       text;
  v_type       text;
  v_status     text;
  v_category   text;
  v_email_arr  text[];
begin
  -- ---- Permissions ----
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') not in ('owner', 'supervisor') then
    raise exception 'Bulk import v3 requires owner or supervisor role';
  end if;
  select email into v_user_email from auth.users where id = v_user_id;

  v_batch_id := 'bulk_import_v3_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MISS')
              || '_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);

  -- ---- Suppress per-row audit for this transaction ----
  perform set_config('app.bulk_audit_off', 'on', true);

  -- ============================================================
  -- Section 1: Clients (must come first — others reference codes)
  -- ============================================================
  v_section := coalesce(p_payload->'clients', '[]'::jsonb);
  v_idx := 0;
  for v_row in select * from jsonb_array_elements(v_section)
  loop
    v_idx := v_idx + 1;
    begin
      v_code := nullif(trim(coalesce(v_row->>'client_code', '')), '');
      v_name := nullif(trim(coalesce(v_row->>'name', '')), '');
      if v_name is null or v_code is null then
        v_errors := v_errors || jsonb_build_object(
          'section', 'clients', 'row', v_idx,
          'error', 'name and client_code are required'
        );
        continue;
      end if;
      if exists (
        select 1 from public.clients where client_code = v_code and deleted_at is null
      ) then
        v_errors := v_errors || jsonb_build_object(
          'section', 'clients', 'row', v_idx, 'client_code', v_code,
          'error', 'duplicate live code — skipped'
        );
        continue;
      end if;

      v_type     := upper(coalesce(v_row->>'type', ''));
      v_category := v_type_map->>v_type;
      v_status   := v_status_map->>coalesce(v_row->>'status', 'Active');
      if v_status is null then v_status := 'active'; end if;

      insert into public.clients (
        client_code, name, name_tax_office,
        client_category, client_status, is_active,
        tax_number, registration_number, tax_return_type, status,
        bulk_import_batch_id
      ) values (
        v_code, v_name, v_name,
        v_category, v_status, v_status = 'active',
        nullif(trim(coalesce(v_row->>'tic', '')), ''),
        nullif(trim(coalesce(v_row->>'he_number', '')), ''),
        nullif(trim(coalesce(v_row->>'category', '')), ''),
        case when v_status = 'active' then 'active' else 'inactive' end,
        v_batch_id
      ) returning id into v_id;

      v_code_to_id := v_code_to_id || jsonb_build_object(v_code, v_id);
      v_count_clients := v_count_clients + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'section', 'clients', 'row', v_idx, 'client_code', v_code,
        'error', sqlerrm
      );
    end;
  end loop;

  -- ============================================================
  -- Section 2: Contacts — UPDATE existing clients (no inserts)
  -- ============================================================
  v_section := coalesce(p_payload->'contacts', '[]'::jsonb);
  v_idx := 0;
  for v_row in select * from jsonb_array_elements(v_section)
  loop
    v_idx := v_idx + 1;
    begin
      v_code := nullif(trim(coalesce(v_row->>'client_code', '')), '');
      v_id := nullif(v_code_to_id->>v_code, '')::bigint;
      if v_id is null then
        v_errors := v_errors || jsonb_build_object(
          'section', 'contacts', 'row', v_idx, 'client_code', v_code,
          'error', 'no matching imported client'
        );
        continue;
      end if;

      -- Split email on ';' or ',' into text[]
      if nullif(trim(coalesce(v_row->>'email', '')), '') is null then
        v_email_arr := null;
      else
        select array_agg(trim(p)) into v_email_arr
        from unnest(regexp_split_to_array(v_row->>'email', '[,;]+')) p
        where trim(p) <> '';
        if array_length(v_email_arr, 1) is null then v_email_arr := null; end if;
      end if;

      update public.clients
      set email          = coalesce(v_email_arr, email),
          phone          = coalesce(nullif(trim(coalesce(v_row->>'phone', '')), ''), phone),
          mobile         = coalesce(nullif(trim(coalesce(v_row->>'mobile', '')), ''), mobile),
          fax            = coalesce(nullif(trim(coalesce(v_row->>'fax', '')), ''), fax),
          contact_person = coalesce(nullif(trim(coalesce(v_row->>'contact_person', '')), ''), contact_person),
          address        = coalesce(nullif(trim(coalesce(v_row->>'address', '')), ''), address)
      where id = v_id;

      v_count_contacts := v_count_contacts + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'section', 'contacts', 'row', v_idx, 'error', sqlerrm
      );
    end;
  end loop;

  -- ============================================================
  -- Section 3: Directors / Relationships
  -- ============================================================
  v_section := coalesce(p_payload->'directors', '[]'::jsonb);
  v_idx := 0;
  for v_row in select * from jsonb_array_elements(v_section)
  loop
    v_idx := v_idx + 1;
    begin
      v_company_id    := nullif(v_code_to_id->>coalesce(v_row->>'company_code', ''),    '')::bigint;
      v_individual_id := nullif(v_code_to_id->>coalesce(v_row->>'individual_code', ''), '')::bigint;

      if v_company_id is null then
        v_errors := v_errors || jsonb_build_object(
          'section', 'directors', 'row', v_idx,
          'error', 'company not in imported clients: ' || coalesce(v_row->>'company_code', '(blank)')
        );
        continue;
      end if;

      insert into public.client_directors (
        client_id, director_client_id, name, role
      ) values (
        v_company_id,
        v_individual_id,  -- nullable: external directors not in our system
        coalesce(nullif(trim(v_row->>'individual_name'), ''), 'Unknown'),
        coalesce(nullif(trim(v_row->>'role'), ''), 'Director')
      );
      v_count_directors := v_count_directors + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'section', 'directors', 'row', v_idx, 'error', sqlerrm
      );
    end;
  end loop;

  -- ============================================================
  -- Section 4: Platform credentials (with encryption)
  -- ============================================================
  v_section := coalesce(p_payload->'credentials', '[]'::jsonb);
  v_idx := 0;
  for v_row in select * from jsonb_array_elements(v_section)
  loop
    v_idx := v_idx + 1;
    begin
      v_id := nullif(v_code_to_id->>coalesce(v_row->>'client_code', ''), '')::bigint;
      if v_id is null then
        v_errors := v_errors || jsonb_build_object(
          'section', 'credentials', 'row', v_idx,
          'client_code', v_row->>'client_code',
          'error', 'no matching imported client'
        );
        continue;
      end if;

      insert into public.platform_credentials (
        client_id, platform, sub_type, username, notes
      ) values (
        v_id,
        coalesce(nullif(trim(coalesce(v_row->>'platform', '')), ''), 'Other'),
        nullif(trim(coalesce(v_row->>'sub_type', '')), ''),
        nullif(trim(coalesce(v_row->>'username', '')), ''),
        nullif(trim(coalesce(v_row->>'notes', '')), '')
      ) returning id into v_pwd_id;

      -- Encrypt password if provided (skip blanks)
      if nullif(trim(coalesce(v_row->>'password', '')), '') is not null then
        update public.platform_credentials
        set password_enc = extensions.pgp_sym_encrypt(v_row->>'password', public._platform_creds_key())
        where id = v_pwd_id;
      end if;

      v_count_credentials := v_count_credentials + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'section', 'credentials', 'row', v_idx, 'error', sqlerrm
      );
    end;
  end loop;

  -- ============================================================
  -- Section 5: Tax filings
  -- ============================================================
  v_section := coalesce(p_payload->'tax_filings', '[]'::jsonb);
  v_idx := 0;
  for v_row in select * from jsonb_array_elements(v_section)
  loop
    v_idx := v_idx + 1;
    begin
      v_id := nullif(v_code_to_id->>coalesce(v_row->>'client_code', ''), '')::bigint;
      if v_id is null then
        v_errors := v_errors || jsonb_build_object(
          'section', 'tax_filings', 'row', v_idx,
          'client_code', v_row->>'client_code',
          'error', 'no matching imported client'
        );
        continue;
      end if;

      insert into public.client_tax_filings (
        client_id, tax_year, filing_type, status, bulk_import_batch_id
      ) values (
        v_id,
        (v_row->>'tax_year')::int,
        coalesce(v_filing_type_map->>(v_row->>'filing_type'), 'other'),
        coalesce(v_filing_status_map->>(v_row->>'status'), 'pending'),
        v_batch_id
      );
      v_count_filings := v_count_filings + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'section', 'tax_filings', 'row', v_idx, 'error', sqlerrm
      );
    end;
  end loop;

  -- ---- Re-enable audit; write one summary row ----
  perform set_config('app.bulk_audit_off', 'off', true);

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (
    v_user_id, v_user_email,
    'clients.bulk_import_v3', 'clients', v_batch_id,
    jsonb_build_object(
      'batch_id',    v_batch_id,
      'clients',     v_count_clients,
      'contacts',    v_count_contacts,
      'directors',   v_count_directors,
      'credentials', v_count_credentials,
      'tax_filings', v_count_filings,
      'errors',      jsonb_array_length(v_errors)
    )
  );

  return jsonb_build_object(
    'batch_id',      v_batch_id,
    'clients',       v_count_clients,
    'contacts',      v_count_contacts,
    'directors',     v_count_directors,
    'credentials',   v_count_credentials,
    'tax_filings',   v_count_filings,
    'errors',        jsonb_array_length(v_errors),
    'error_details', v_errors
  );
end $$;

revoke all on function public.bulk_import_v3(jsonb) from public;
grant   execute on function public.bulk_import_v3(jsonb) to authenticated;

commit;
