-- =============================================================
-- Migration 067: address line 3 + office/building
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds a third address line and an office / building number field to
-- client_addresses.
-- =============================================================

begin;

alter table public.client_addresses
  add column if not exists line3  text,
  add column if not exists office text;

comment on column public.client_addresses.office is
  'Office / building number for the address.';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 067.
-- =============================================================
