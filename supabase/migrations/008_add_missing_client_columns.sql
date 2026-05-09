-- =============================================================
-- Migration 008: Add the 10 missing client columns
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Background: the client edit form has historically referenced
-- 14 fields that didn't exist as columns, so saves to those
-- fields silently failed. After Phase 0, the form is being
-- cleaned up to:
--   - REMOVE: vat_period (replaced by vat_period_group),
--             fax (unused), year_end_date (merged into
--             financial_year_end), contact_email (renamed to
--             use the existing 'email' column).
--   - KEEP and add as real columns: the 10 below.
--
-- Wrapped in a transaction; rolls back atomically on failure.
-- All ADD COLUMN statements use IF NOT EXISTS so the migration
-- is safe to re-run.
-- =============================================================

begin;

alter table public.clients add column if not exists notes              text;
alter table public.clients add column if not exists incorporation_date date;
alter table public.clients add column if not exists financial_year_end text;
alter table public.clients add column if not exists mobile             text;
alter table public.clients add column if not exists website            text;
alter table public.clients add column if not exists city               text;
alter table public.clients add column if not exists postal_code        text;
alter table public.clients add column if not exists country            text default 'Cyprus';
alter table public.clients add column if not exists date_of_birth      date;
alter table public.clients add column if not exists nationality        text;

commit;
-- =============================================================
-- End of migration 008.
--
-- Verify in SQL Editor:
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'clients'
--     and column_name in ('notes','incorporation_date','financial_year_end',
--                         'mobile','website','city','postal_code','country',
--                         'date_of_birth','nationality');
-- Should return 10 rows.
-- =============================================================
