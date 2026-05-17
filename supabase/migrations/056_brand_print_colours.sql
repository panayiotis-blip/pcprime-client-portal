-- =============================================================
-- Migration 056: Brand & Print Colours (UI Refinements Part B)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds four configurable brand colours to company_settings. These apply
-- to printed materials only (client card, sales invoice, future
-- letterhead templates) — never to the live UI.
--
-- company_settings already has RLS (read = authenticated, write = owner)
-- and an audit trigger, so colour changes are access-controlled + logged.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists brand_primary_colour        text not null default '#0d1b2e',
  add column if not exists brand_secondary_colour      text not null default '#b8963e',
  add column if not exists letterhead_background_colour text not null default '#ffffff',
  add column if not exists letterhead_text_colour       text not null default '#0d1b2e';

comment on column public.company_settings.brand_primary_colour is
  'Print only — headings/accents on printed templates. Not used in the live UI.';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 056.
-- =============================================================
