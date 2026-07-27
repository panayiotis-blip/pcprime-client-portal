-- =============================================================
-- Migration 155: Customer / supplier code
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds a reference code to the client's customers and suppliers, shown as
-- the first column of each list and accepted as the first import column
-- (code, name, email, telephone).
-- =============================================================

begin;

alter table public.customer add column if not exists code text;
alter table public.supplier add column if not exists code text;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 155.
-- =============================================================
