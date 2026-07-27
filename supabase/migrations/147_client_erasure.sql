-- =============================================================
-- Migration 147: Client erasure (anonymise & keep) — GDPR Art. 17
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Right to be forgotten, done the accounting-safe way: the client's
-- direct personal identifiers are wiped and their personal ancillary
-- data (addresses, notes, emails, credentials, directors, messages,
-- intake, couple links, company profile) is deleted — but the accounting
-- records that Cyprus law requires us to keep ~6–7 years (invoices,
-- receipts, journal lines, tax filings, engagement letters, timesheets,
-- documents) are RETAINED, now de-identified because they hang off the
-- anonymised client row.
--
-- Historical invoice/engagement snapshots keep the name as issued (a
-- legal record) — GDPR's legal-obligation exemption covers this.
--
-- Irreversible. Restricted to supervisor/owner. Audit-logged.
-- =============================================================

begin;

alter table public.clients add column if not exists erased_at timestamptz;
alter table public.clients add column if not exists erased_by uuid references auth.users(id) on delete set null;

create or replace function public.anonymise_client(p_client_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  summary jsonb := '{}'::jsonb;
  n int;
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'client % not found', p_client_id;
  end if;

  -- 1. Anonymise the client master row (keep the row for accounting FKs).
  update public.clients set
    name                 = '[Erased #' || id || ']',
    trading_name         = null,
    tax_number           = null,
    vat_number           = null,
    registration_number  = null,
    employer_number      = null,
    ergani_number        = null,
    social_insurance_number = null,
    id_number            = null,
    passport_number      = null,
    contact_person       = null,
    director_name        = null,
    address              = null,
    phone                = null,
    email                = null,
    mobile               = null,
    website              = null,
    fax                  = null,
    city                 = null,
    postal_code          = null,
    notes                = null,
    kyc_notes            = null,
    date_of_birth        = null,
    nationality          = null,
    name_tax_office      = null,
    kyc_completed        = false,
    kyc_expiry_date      = null,
    kyc_status           = null,
    kyc_risk_level       = null,
    kyc_last_reviewed    = null,
    kyc_next_review      = null,
    kyc_pep_status       = null,
    kyc_source_of_funds  = null,
    kyc_beneficial_owner = null,
    tags                 = '{}'::text[],
    is_active            = false,
    erased_at            = now(),
    erased_by            = auth.uid(),
    updated_at           = now()
  where id = p_client_id;

  -- 2. Delete personal ancillary data (not accounting records).
  delete from public.client_addresses where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('addresses', n);

  delete from public.client_notes where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('notes', n);

  delete from public.client_emails where client_id = p_client_id;  -- attachments cascade
  get diagnostics n = row_count; summary := summary || jsonb_build_object('emails', n);

  delete from public.platform_credentials where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('credentials', n);

  delete from public.client_directors where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('directors', n);

  delete from public.client_company_profile where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('company_profile', n);

  delete from public.client_couples where client_a_id = p_client_id or client_b_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('couple_links', n);

  delete from public.client_messages where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('messages', n);

  delete from public.message_thread where client_id = p_client_id;  -- thread replies cascade
  get diagnostics n = row_count; summary := summary || jsonb_build_object('message_threads', n);

  delete from public.client_intake_submissions where client_id = p_client_id;
  get diagnostics n = row_count; summary := summary || jsonb_build_object('intake_submissions', n);

  -- 3. Audit.
  insert into public.audit_log (action, target_type, target_id, summary)
  values ('client.erased', 'clients', p_client_id::text, summary);

  return summary;
end;
$$;

revoke all on function public.anonymise_client(bigint) from public;
grant execute on function public.anonymise_client(bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 147.
-- =============================================================
