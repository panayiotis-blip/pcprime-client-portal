-- =============================================================
-- Migration 174: finish migration 170's columns on client_apps
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 170 gained its two generated columns (is_customised / is_pinned)
-- in an edit after the file was first written, so a copy taken before that
-- edit leaves them missing. Everything else still worked — migration 173 only
-- needs html_override/pinned_html — but the portal's "which copy is this
-- client running" query selects them, and PostgREST answers a missing column
-- with 400. The app then has no variant token and refuses to open for the
-- client, while previewing the same template is fine.
--
-- Safe to run whether or not 170 landed in full: every step is idempotent.
-- =============================================================

begin;

create extension if not exists pgcrypto;

alter table public.client_apps
  add column if not exists html_override  text,
  add column if not exists pinned_html    text,
  add column if not exists pinned_version int,
  add column if not exists variant_at     timestamptz,
  add column if not exists variant_token  text;

-- Every allocation needs a token: it is how /api/app-frame serves the app.
update public.client_apps
   set variant_token = replace(gen_random_uuid()::text, '-', '')
 where variant_token is null;

alter table public.client_apps
  alter column variant_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists client_apps_variant_token_idx
  on public.client_apps (variant_token) where variant_token is not null;

-- The flags the portal reads instead of pulling whole app HTML down the wire.
alter table public.client_apps
  add column if not exists is_customised boolean generated always as (html_override is not null) stored,
  add column if not exists is_pinned     boolean generated always as (pinned_html   is not null) stored;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify — all five should be present, and no allocation without a token:
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='client_apps'
--      and column_name in ('html_override','pinned_html','pinned_version',
--                          'variant_token','variant_at','is_customised','is_pinned')
--    order by column_name;
--
--   select count(*) as allocations, count(variant_token) as with_token
--     from public.client_apps;
-- =============================================================
-- End of migration 174.
-- =============================================================
