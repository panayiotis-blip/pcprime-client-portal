-- =============================================================
-- Migration 148: Firm toggle for AI document extraction (EU→US transfer)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The AI document-extract feature sends document images to Anthropic
-- (US) — the portal's only EU→US personal-data transfer. This adds a
-- firm-wide on/off switch. When off, the extract-document edge function
-- refuses before calling Anthropic, and the scanner falls back to the
-- on-device (Tesseract) OCR — so nothing leaves EU infrastructure.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists ai_extract_enabled boolean not null default true;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 148.
-- =============================================================
