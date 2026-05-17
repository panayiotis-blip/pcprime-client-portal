-- =============================================================
-- Migration 060: fix actor-email lookup (profiles has no email column)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Bug: smart_import (migration 055) and hard_delete_clients (migration 057)
-- read the actor's email from public.profiles — but that table has no
-- `email` column (email lives on auth.users). Every call failed with:
--     column "email" does not exist
-- This is why bulk-delete of soft-deleted clients errored, and the same
-- bug would break Smart Import.
--
-- Fix: read `role` from public.profiles and `email` from auth.users — the
-- pattern every other RPC already uses. No other behaviour change.
-- create-or-replace only — safe to run, no data touched.
-- =============================================================

create or replace function public.smart_import(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_role    text;
  v_batch   text;
  v_row     jsonb;
  v_action  text;
  v_fields  jsonb;
  v_addr    jsonb;
  v_atype   text;
  v_cred    jsonb;
  v_pwd_id  bigint;
  v_plat    text;
  v_cid     bigint;
  v_name    text;
  v_code    text;
  v_merged  jsonb;
  v_rec     public.clients;
  v_created int  := 0;
  v_updated int  := 0;
  v_creds   int  := 0;
  v_failed  int  := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_i       int  := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role  into v_role  from public.profiles where id = v_uid;
  select email into v_email from auth.users     where id = v_uid;
  if v_role not in ('owner', 'supervisor') then
    raise exception 'Only owners and supervisors can run Smart Import';
  end if;

  v_batch := 'smart_import_' || to_char(now() at time zone 'utc', 'YYYYMMDD_HH24MISS')
             || '_' || substr(md5(random()::text), 1, 8);

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_i := v_i + 1;
    begin
      v_action := v_row->>'action';
      v_fields := coalesce(v_row->'fields', '{}'::jsonb);
      v_name   := nullif(trim(coalesce(v_fields->>'name', '')), '');
      v_cid    := null;

      if v_action = 'create' then
        if v_name is null then raise exception 'Name is required'; end if;
        v_rec  := jsonb_populate_record(null::public.clients, v_fields);
        v_code := nullif(trim(coalesce(v_fields->>'client_code', '')), '');
        if v_code is null then v_code := public.generate_client_code_v2(v_name); end if;

        insert into public.clients (
          client_code, name, name_tax_office, trading_name, client_category, client_status,
          business_type, industry_sector, tax_number, vat_number, vat_status, vat_period,
          vat_registration_date, registration_number, incorporation_date, year_of_incorporation,
          year_end_date, employer_number, ergani_number, social_insurance_number, id_number,
          passport_number, date_of_birth, nationality, phone, mobile, email, website, fax,
          contact_person, bank_iban, engagement_letter_date, annual_fee_agreed, monthly_fee,
          auditor_name, services, notes, bulk_import_batch_id
        ) values (
          v_code, v_name, v_rec.name_tax_office, v_rec.trading_name, v_rec.client_category,
          coalesce(v_rec.client_status, 'active'),
          v_rec.business_type, v_rec.industry_sector, v_rec.tax_number, v_rec.vat_number,
          v_rec.vat_status, v_rec.vat_period, v_rec.vat_registration_date, v_rec.registration_number,
          v_rec.incorporation_date, v_rec.year_of_incorporation, v_rec.year_end_date,
          v_rec.employer_number, v_rec.ergani_number, v_rec.social_insurance_number, v_rec.id_number,
          v_rec.passport_number, v_rec.date_of_birth, v_rec.nationality, v_rec.phone, v_rec.mobile,
          v_rec.email, v_rec.website, v_rec.fax, v_rec.contact_person, v_rec.bank_iban,
          v_rec.engagement_letter_date, v_rec.annual_fee_agreed, v_rec.monthly_fee,
          v_rec.auditor_name, v_rec.services, v_rec.notes, v_batch
        )
        returning id into v_cid;
        v_created := v_created + 1;

      elsif v_action = 'update' then
        v_cid := nullif(v_row->>'client_id', '')::bigint;
        if v_cid is null then raise exception 'Missing client_id for update'; end if;
        select to_jsonb(c.*) into v_merged from public.clients c where c.id = v_cid;
        if v_merged is null then raise exception 'Client % no longer exists', v_cid; end if;
        v_merged := v_merged || v_fields;
        v_rec := jsonb_populate_record(null::public.clients, v_merged);

        update public.clients set
          name = v_rec.name, name_tax_office = v_rec.name_tax_office, trading_name = v_rec.trading_name,
          client_category = v_rec.client_category, client_status = v_rec.client_status,
          business_type = v_rec.business_type, industry_sector = v_rec.industry_sector,
          tax_number = v_rec.tax_number, vat_number = v_rec.vat_number, vat_status = v_rec.vat_status,
          vat_period = v_rec.vat_period, vat_registration_date = v_rec.vat_registration_date,
          registration_number = v_rec.registration_number, incorporation_date = v_rec.incorporation_date,
          year_of_incorporation = v_rec.year_of_incorporation, year_end_date = v_rec.year_end_date,
          employer_number = v_rec.employer_number, ergani_number = v_rec.ergani_number,
          social_insurance_number = v_rec.social_insurance_number, id_number = v_rec.id_number,
          passport_number = v_rec.passport_number, date_of_birth = v_rec.date_of_birth,
          nationality = v_rec.nationality, phone = v_rec.phone, mobile = v_rec.mobile,
          email = v_rec.email, website = v_rec.website, fax = v_rec.fax,
          contact_person = v_rec.contact_person, bank_iban = v_rec.bank_iban,
          engagement_letter_date = v_rec.engagement_letter_date,
          annual_fee_agreed = v_rec.annual_fee_agreed, monthly_fee = v_rec.monthly_fee,
          auditor_name = v_rec.auditor_name, services = v_rec.services, notes = v_rec.notes
        where id = v_cid;
        v_updated := v_updated + 1;

      else
        raise exception 'Unknown action: %', coalesce(v_action, '(null)');
      end if;

      -- Addresses — insert only when the client has no address of that type yet.
      v_addr := v_row->'addresses';
      if v_addr is not null and v_cid is not null then
        for v_atype in select * from jsonb_object_keys(v_addr)
        loop
          if v_atype in ('registered', 'trading', 'postal', 'home') then
            insert into public.client_addresses
              (client_id, address_type, line1, line2, city, postal_code, country)
            values (
              v_cid, v_atype,
              nullif(trim(coalesce(v_addr->v_atype->>'line1', '')), ''),
              nullif(trim(coalesce(v_addr->v_atype->>'line2', '')), ''),
              nullif(trim(coalesce(v_addr->v_atype->>'city', '')), ''),
              nullif(trim(coalesce(v_addr->v_atype->>'postal_code', '')), ''),
              coalesce(nullif(trim(coalesce(v_addr->v_atype->>'country', '')), ''), 'Cyprus')
            )
            on conflict (client_id, address_type) do nothing;
          end if;
        end loop;
      end if;

      -- Credential — insert one platform login when a platform or username is
      -- given, and the client doesn't already have that platform (keeps the
      -- import safe to re-run without creating duplicate credentials).
      v_cred := v_row->'credential';
      if v_cred is not null and v_cid is not null
         and (nullif(trim(coalesce(v_cred->>'platform', '')), '') is not null
              or nullif(trim(coalesce(v_cred->>'username', '')), '') is not null)
      then
        v_plat := coalesce(nullif(trim(coalesce(v_cred->>'platform', '')), ''), 'Other');
        if not exists (
          select 1 from public.platform_credentials pc
          where pc.client_id = v_cid and pc.platform = v_plat
        ) then
          insert into public.platform_credentials (client_id, platform, username, notes)
          values (
            v_cid, v_plat,
            nullif(trim(coalesce(v_cred->>'username', '')), ''),
            nullif(trim(coalesce(v_cred->>'notes', '')), '')
          )
          returning id into v_pwd_id;

          if nullif(trim(coalesce(v_cred->>'password', '')), '') is not null then
            update public.platform_credentials
            set password_enc = extensions.pgp_sym_encrypt(v_cred->>'password', public._platform_creds_key())
            where id = v_pwd_id;
          end if;
          v_creds := v_creds + 1;
        end if;
      end if;

    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', v_i, 'name', coalesce(v_name, '(unnamed)'), 'error', sqlerrm
      );
    end;
  end loop;

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (
    v_uid, v_email, 'clients.smart_import', 'clients', v_batch,
    jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
                       'credentials', v_creds, 'failed', v_failed)
  );

  return jsonb_build_object(
    'batch_id',    v_batch,
    'created',     v_created,
    'updated',     v_updated,
    'credentials', v_creds,
    'failed',      v_failed,
    'errors',      v_errors
  );
end $$;

revoke all     on function public.smart_import(jsonb) from public;
grant  execute on function public.smart_import(jsonb) to authenticated;


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
  select role  into v_role  from public.profiles where id = v_uid;
  select email into v_email from auth.users     where id = v_uid;
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
-- End of migration 060.
-- =============================================================
