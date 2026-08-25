-- =============================================================
-- Migration 187: per-client app configuration
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- WHY. "Customise the template under each customer" has two possible meanings
-- and only one of them is safe. Forking the app's HTML per client (the
-- html_override column) gives total freedom and cuts that client off from every
-- future fix — a forked rentals client would still be silently destroying
-- uploaded contracts today. Decided 2026-08-24: per-client difference is
-- CONFIGURATION. See docs/APP_ALLOCATION_DESIGN.md.
--
-- OWNERSHIP IS THE POINT. client_app_data is the CLIENT's — their tenants,
-- their receipts, written by them through the app. This table is the FIRM's:
-- how the app is set up for that client. Different owners, different write
-- rules, so they get different tables rather than one blob where a client edit
-- could overwrite an accountant's decision.
--
-- Anything absent means "behave as the app always has", so an unconfigured
-- client is bit-for-bit unchanged. Where a value IS set it wins over the app's
-- own setting AND the app hides the matching control — the client cannot
-- contradict their accountant on, say, the VAT rate.
--
-- Shape (all optional, per app):
--   { "title": "…",                          -- header override
--     "hiddenTabs": ["deposits","insights"],  -- screens this client does not get
--     "vat": { "enabled": true, "rate": 19, "onRent": false } }
-- =============================================================

begin;

create table if not exists public.client_app_config (
  client_id  bigint not null references public.clients(id) on delete cascade,
  app_key    text   not null,
  config     jsonb  not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (client_id, app_key)
);

alter table public.client_app_config enable row level security;

-- Readable by anyone who can reach the client — firm staff and that client's
-- own portal users — because the app needs it at startup to render correctly.
-- It holds settings, never client data.
drop policy if exists "client_app_config read"  on public.client_app_config;
drop policy if exists "client_app_config write" on public.client_app_config;
create policy "client_app_config read" on public.client_app_config
  for select using (public.user_can_access_client(client_id));

-- Writable by the firm only. user_can_access_client is deliberately NOT enough
-- here: it is also true for the client's own portal users, and the whole point
-- is that a client cannot reconfigure their own app.
create policy "client_app_config write" on public.client_app_config
  for all
  using (public.is_supervisor_or_higher()) with check (public.is_supervisor_or_higher());

commit;

-- =============================================================
-- Verify:
--   select client_id, app_key, config from public.client_app_config;
--   select policyname, cmd from pg_policies where tablename = 'client_app_config';
-- =============================================================
-- End of migration 187.
-- =============================================================
