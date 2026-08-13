-- =============================================================
-- Migration 181: filing periods on tax filings
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- client_tax_filings has recorded a tax YEAR since migration 037, which suits
-- an income tax return and suits VAT not at all. A category G client files
-- four VAT returns a year, a category C client twelve — and the table could
-- hold exactly one row per year per type, so the second one you tried to enter
-- looked like a duplicate of the first.
--
--   period_label — how the period reads: 'Feb–Apr 2026', 'Nov 2026–Jan 2027'
--   period_start / period_end — the actual dates, for ordering and for
--                               anything later that needs to compare them
--
-- All three are nullable and stay null for annual filings: a company tax
-- return has a year and needs nothing more. Only the periodic types fill them.
--
-- No back-fill. Existing rows keep their year and gain no period, which is
-- honest — nobody recorded which period they were for, and a guess written
-- into the record is worse than a blank.
--
-- Still no unique constraint here, as before. (client_id, filing_type,
-- period_start) is the natural key for periodic filings, but the existing rows
-- have no period, so a constraint added today would fire on the first two VAT
-- rows anyone has already entered for the same year. Worth adding once the
-- historic rows have been sorted out.
-- =============================================================

begin;

alter table public.client_tax_filings
  add column if not exists period_label text,
  add column if not exists period_start date,
  add column if not exists period_end   date;

comment on column public.client_tax_filings.period_label is
  'Filing period as it reads to a person, e.g. ''Feb–Apr 2026''. Null for annual filings.';
comment on column public.client_tax_filings.period_start is
  'First day of the filing period. Null for annual filings, which are identified by tax_year.';

-- The VAT question is "what has this client filed, in order" — by period, not
-- by the year it happens to fall in.
create index if not exists client_tax_filings_period_idx
  on public.client_tax_filings (client_id, filing_type, period_start desc)
  where period_start is not null;

notify pgrst, 'reload schema';

commit;

-- =============================================================
-- Verify:
--   select filing_type, count(*) filter (where period_start is null) as annual_style,
--          count(*) filter (where period_start is not null)          as with_period
--     from public.client_tax_filings group by filing_type order by filing_type;
-- =============================================================
