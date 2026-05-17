-- =============================================================
-- Migration 051: Merge invoice Reference into Invoice Number
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- UI Polish v2 — Part 5C. The Edit Invoice form now has a single
-- "Invoice Number / Reference" field bound to invoices.invoice_number.
--
-- This backfills invoice_number from the old reference column wherever
-- invoice_number is blank, so no reference data is stranded. The
-- reference column is intentionally KEPT (deprecated) — existing values
-- are preserved untouched; the form simply no longer edits it.
--
-- Idempotent: re-running changes nothing once invoice_number is filled.
-- =============================================================

begin;

update public.invoices
   set invoice_number = reference
 where coalesce(trim(invoice_number), '') = ''
   and coalesce(trim(reference), '') <> '';

commit;
-- =============================================================
-- End of migration 051.
-- =============================================================
