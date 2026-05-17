-- =============================================================
-- Migration 059: VAT / OSS period starting month
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds the first month of each VAT period cycle. Combined with the
-- category's frequency (A/B = 2, C = 1, D = 6, E = 12, F = 4, G = 3
-- months) this drives the staggered filing-period calculation, so the
-- actual periods (e.g. Feb-Apr, May-Jul, ...) are computed in the app.
-- Stored as the month number 1-12.
-- =============================================================

begin;

alter table public.clients
  add column if not exists vat_start_month     smallint,
  add column if not exists oss_vat_start_month smallint;

comment on column public.clients.vat_start_month is
  'First month (1-12) of the VAT period cycle — drives the staggered period calculation.';
comment on column public.clients.oss_vat_start_month is
  'First month (1-12) of the OSS VAT period cycle.';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 059.
-- =============================================================
