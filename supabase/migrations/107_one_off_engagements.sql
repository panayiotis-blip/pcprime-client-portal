-- Migration 107: One-off engagement letters
-- ===========================================
-- An engagement is now either:
--   annual   (default) — recurring monthly billing, annual rate review
--   one_off            — a defined project: single fee, project end date,
--                        no monthly billing or annual review wording
--
-- The PDF and builder pick wording based on engagement_type so a one-off
-- consulting brief does not read like a perpetual retainer.

alter table public.engagement_letters
  add column if not exists engagement_type text not null default 'annual'
    check (engagement_type in ('annual', 'one_off'));
