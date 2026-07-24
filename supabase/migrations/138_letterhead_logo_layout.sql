-- =============================================================
-- Migration 138: letterhead logo layout settings
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Lets the firm control how the logo and company name lock up on printed
-- documents (engagement letter, invoices, statements, receipts, timesheets,
-- client card). Brand COLOURS were already configurable (migration 056); this
-- adds POSITION and SIZE.
--
--   letterhead_logo_position:
--     name_only   — company name only, no logo
--     logo_left   — logo immediately left of the name (one lockup)
--     logo_right  — logo immediately right of the name (one lockup)   [default]
--     logo_above  — logo above the name
--     logo_only   — logo only, no name text
--   letterhead_logo_height: small | medium | large
--
-- Default is logo_right (the "logo beside the name, as one unit" the firm
-- asked for). The customer-facing sales documents keep the client's own
-- business identity and are unaffected.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists letterhead_logo_position text not null default 'logo_right'
    check (letterhead_logo_position in ('name_only','logo_left','logo_right','logo_above','logo_only'));

alter table public.company_settings
  add column if not exists letterhead_logo_height text not null default 'medium'
    check (letterhead_logo_height in ('small','medium','large'));

commit;

-- =============================================================
-- Verify:
--   select letterhead_logo_position, letterhead_logo_height
--   from public.company_settings;
-- =============================================================
-- End of migration 138.
-- =============================================================
