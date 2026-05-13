-- 033_kyc_fields_and_random_uuid_fix.sql
-- Fixes two bugs surfaced after Clients-v2 ship:
--   1. KYC save fails — the KYC tab writes 6 columns that didn't exist.
--      Adds them as plain columns on `clients` (matching existing kyc_*
--      fields from migration 001).
--   2. Bulk import fails for some rows with "function gen_random_bytes
--      does not exist" — migrations 029/030's generate_client_email_address
--      called pgcrypto's gen_random_bytes from inside a `set search_path = ''`
--      function. Rewriting to use Postgres's built-in gen_random_uuid()
--      (no extension dependency).

begin;

-- ============================================================
-- 1. Add missing KYC columns to clients
-- ============================================================
alter table public.clients add column if not exists kyc_status              text;
alter table public.clients add column if not exists kyc_risk_level          text;
alter table public.clients add column if not exists kyc_last_reviewed       date;
alter table public.clients add column if not exists kyc_next_review         date;
alter table public.clients add column if not exists kyc_pep_status          text;
alter table public.clients add column if not exists kyc_source_of_funds     text;
alter table public.clients add column if not exists kyc_beneficial_owner    text;

-- (kyc_completed, kyc_expiry_date, kyc_notes already exist from migration 001)

-- ============================================================
-- 2. Replace gen_random_bytes usage in generate_client_email_address
-- ============================================================
-- gen_random_uuid() is a Postgres built-in since v13 — no extension needed.
-- A UUID string is 36 chars including hyphens; strip them and we get 32
-- random hex chars. Slice off what we need.

create or replace function public.generate_client_email_address(
  p_client_code text, p_name text default null
)
returns text
language plpgsql
as $$
declare
  v_code  text;
  v_rand  text;
  v_addr  text;
  v_tries int := 0;
begin
  -- Strip everything non-alphanumeric and lowercase: 'AND-001' -> 'and001'
  v_code := lower(regexp_replace(coalesce(p_client_code, ''), '[^A-Za-z0-9]', '', 'g'));

  if v_code <> '' then
    v_addr := format('%s@inbox.primeandcalculate.com', v_code);
    if not exists (select 1 from public.clients where unique_email = v_addr) then
      return v_addr;
    end if;
    -- Collision shouldn't happen since client_code is unique, but defend with
    -- a short random suffix derived from gen_random_uuid() (no pgcrypto needed).
    return format(
      '%s-%s@inbox.primeandcalculate.com',
      v_code,
      substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4)
    );
  end if;

  -- No client_code yet — fall back to a short random local-part.
  loop
    v_rand := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);
    v_addr := format('client-%s@inbox.primeandcalculate.com', v_rand);
    if not exists (select 1 from public.clients where unique_email = v_addr) then
      return v_addr;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 10 then
      raise exception 'Could not generate a unique fallback client email';
    end if;
  end loop;
end $$;

commit;
-- =============================================================
-- Verify:
--   select column_name from information_schema.columns
--    where table_name='clients' and column_name like 'kyc_%' order by 1;
--   -- expect 10 rows
--
--   select public.generate_client_email_address('TEST01', 'Test');
--   -- expect 'test01@inbox.primeandcalculate.com' (or a -xxxx suffix on clash)
--
--   select public.generate_client_email_address('', 'No code given');
--   -- expect 'client-xxxxxx@inbox.primeandcalculate.com'
-- =============================================================
