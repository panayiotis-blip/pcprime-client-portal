-- =============================================================
-- Migration 071: VAT rate per line item
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Each invoice line (and each recurring-invoice line) now carries its own
-- VAT rate, so a single invoice can mix 0 / 5 / 9 / 19 % rates. The
-- existing invoice-level `vat_rate` is kept and used as the default for
-- new lines, but the editor no longer surfaces it as a header field.
--
-- Backfill: existing lines with `vatable = false` get vat_rate = 0;
-- the rest default to 19 (standard Cyprus rate).
-- =============================================================

begin;

alter table public.client_invoice_lines
  add column if not exists vat_rate numeric(5,2) not null default 19.00;
update public.client_invoice_lines
   set vat_rate = 0
 where vatable = false and vat_rate <> 0;

alter table public.recurring_invoice_lines
  add column if not exists vat_rate numeric(5,2) not null default 19.00;
update public.recurring_invoice_lines
   set vat_rate = 0
 where vatable = false and vat_rate <> 0;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 071.
-- =============================================================
