-- =============================================================
-- Migration 162: App-only users for client apps
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A client app (e.g. Property Rentals) can have its OWN logins — the
-- client's operational staff — completely separate from portal users.
-- They open a share link, sign in at the app's own login box, and get
-- ONLY the full-screen app. Data still lives in client_app_data.
--
--   * client_apps.access_token — unguessable token in the share link
--     (/app/<appKey>/<token>), identifies which client+app to sign into.
--   * client_app_users — the app logins (username + PBKDF2 password hash +
--     role). Service-role only: all access is via the app-session /
--     app-users Edge Functions, so password hashes are never exposed to
--     the browser. RLS is ON with NO policies (denies authenticated reads).
-- =============================================================

begin;

create extension if not exists pgcrypto;

alter table public.client_apps
  add column if not exists access_token text;

-- Give every existing enabled app a share token.
update public.client_apps
   set access_token = replace(gen_random_uuid()::text, '-', '')
 where access_token is null;

create unique index if not exists client_apps_access_token_idx
  on public.client_apps (access_token) where access_token is not null;

create table if not exists public.client_app_users (
  id            bigserial primary key,
  client_id     bigint not null references public.clients(id) on delete cascade,
  app_key       text   not null,
  username      text   not null,
  name          text,
  role          text   not null default 'editor' check (role in ('admin','editor','viewer')),
  password_hash text   not null,        -- pbkdf2$<iters>$<saltB64>$<hashB64>
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  last_login_at timestamptz
);

-- Username is GLOBALLY unique so the single /app entry page can resolve which
-- client + app to open from the username alone.
create unique index if not exists client_app_users_uname_idx
  on public.client_app_users (lower(username));

comment on table public.client_app_users is
  'App-only logins for client apps (migration 162). Service-role only — managed via the app-users Edge Function, authenticated via app-session. RLS on, no policies.';

-- Lock it down: only the Edge Functions (service_role, bypasses RLS) touch it.
alter table public.client_app_users enable row level security;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- The share link for a client's app is:
--   https://portal.primeandcalculate.com/app/<appKey>/<access_token>
-- Find Greson's rentals token:
--   select ca.access_token from public.client_apps ca
--   join public.clients c on c.id = ca.client_id
--   where c.name ilike '%greson%' and ca.app_key = 'rentals';
-- =============================================================
-- End of migration 162.
-- =============================================================
