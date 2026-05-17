-- =============================================================
-- Migration 058: VAT Category + OSS VAT Category
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds two dropdown-backed columns to clients for the Cyprus VAT period
-- categories (A-G). The existing free-text `vat_period` column is left
-- UNTOUCHED — it is the preserved reference for any value that can't be
-- mapped automatically.
--
-- Categories: A 2-monthly(odd) · B 2-monthly(even) · C monthly ·
--             D 6-monthly · E annually · F 4-monthly · G 3-monthly
-- =============================================================

begin;

alter table public.clients
  add column if not exists vat_category     text,
  add column if not exists oss_vat_category text;

comment on column public.clients.vat_category is
  'Cyprus VAT period category A-G. Free-text vat_period is kept as the legacy reference.';

-- Backfill vat_category from recognisable legacy vat_period values.
-- 2-monthly (odd/even = A/B) is ambiguous from free text, so it is left
-- blank for manual review. vat_period is never modified.
update public.clients set vat_category = upper(trim(vat_period))
  where vat_category is null and upper(trim(coalesce(vat_period, ''))) in ('A','B','C','D','E','F','G');
update public.clients set vat_category = 'C'
  where vat_category is null and lower(trim(coalesce(vat_period, ''))) in ('monthly','1 monthly','1-monthly');
update public.clients set vat_category = 'G'
  where vat_category is null and (
    lower(trim(coalesce(vat_period, ''))) in ('3 monthly','3-monthly','quarterly')
    or trim(coalesce(vat_period, '')) = '1/4/7/10');
update public.clients set vat_category = 'F'
  where vat_category is null and lower(trim(coalesce(vat_period, ''))) in ('4 monthly','4-monthly');
update public.clients set vat_category = 'D'
  where vat_category is null and lower(trim(coalesce(vat_period, ''))) in ('6 monthly','6-monthly');
update public.clients set vat_category = 'E'
  where vat_category is null and lower(trim(coalesce(vat_period, ''))) in ('annually','annual','yearly');

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 058.
-- =============================================================
