-- =============================================================
-- Migration 164: Per-user app grants (email-identity app access)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Phase 1 of unifying client-app access onto the email/Supabase-Auth
-- identity (retires the username-based client_app_users system over the
-- next phases). PURELY ADDITIVE — no behaviour change yet:
--
--   * client_app_grants — grants ONE Supabase-auth user access to ONE app
--     of ONE client, with a per-grant role. A person can hold several grants
--     (e.g. Greson rentals + mgmt) = one login, many apps.
--   * RLS on client_app_data / client_apps gains an "OR the caller holds a
--     matching app grant" clause, so a grant-only user reaches EXACTLY that
--     app's data row and nothing else. They are NOT in user_clients, so
--     user_can_access_client() stays false for them → no client portal, no
--     other client. That absence is the security boundary.
--   * profiles.role gains 'app_user' so Phase 2 can mark app-only accounts
--     (accounts with grants but NO portal link) distinctly from portal
--     clients. Access is still driven by the DATA (grants + user_clients),
--     not by this label.
--
-- The existing custom app-session/app-users path uses the service role and
-- bypasses RLS entirely, so Greson's current logins keep working untouched
-- until the Phase-5 cutover.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Widen profiles.role to allow 'app_user'
-- -------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles drop constraint profiles_role_check;
  end if;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'supervisor', 'admin', 'staff', 'client', 'app_user'));

-- -------------------------------------------------------------
-- 2. Grants table — (user, client, app) → role
-- -------------------------------------------------------------
create table if not exists public.client_app_grants (
  id         bigserial primary key,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  client_id  bigint not null references public.clients(id) on delete cascade,
  app_key    text   not null,
  role       text   not null default 'editor' check (role in ('admin','editor','viewer')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (user_id, client_id, app_key)
);

create index if not exists client_app_grants_client_app_idx
  on public.client_app_grants (client_id, app_key);
create index if not exists client_app_grants_user_idx
  on public.client_app_grants (user_id);

comment on table public.client_app_grants is
  'Per-user access to a client app (migration 164). One row = one auth user may open one (client, app) with the given role. Writes are service-role only (managed by the app-grants-admin Edge Function, Phase 2); RLS below allows self-read + firm-staff read.';

-- -------------------------------------------------------------
-- 3. Helper functions (SECURITY DEFINER — used by RLS)
-- -------------------------------------------------------------
-- Does the current auth user hold an active grant for this (client, app)?
create or replace function public.user_has_app_grant(cid bigint, akey text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_app_grants
    where user_id = auth.uid() and client_id = cid and app_key = akey and active
  );
$$;

-- The current auth user's role for this (client, app), or null if none.
create or replace function public.user_app_role(cid bigint, akey text)
returns text language sql stable security definer set search_path = public as $$
  select role from public.client_app_grants
  where user_id = auth.uid() and client_id = cid and app_key = akey and active
  limit 1;
$$;

-- -------------------------------------------------------------
-- 4. RLS on the grants table
--    Reads: a user sees their OWN grants (login chooser / app resolver);
--    firm staff (is_admin) see all. Writes: none here → service-role only.
-- -------------------------------------------------------------
alter table public.client_app_grants enable row level security;
drop policy if exists "client_app_grants read" on public.client_app_grants;
create policy "client_app_grants read" on public.client_app_grants
  for select using (user_id = auth.uid() or public.is_admin());

-- -------------------------------------------------------------
-- 5. Extend client_apps RLS — let a grant-holder READ their app's row
--    (to confirm the app is enabled). The existing staff "for all"
--    policy is untouched; permissive policies OR together.
-- -------------------------------------------------------------
drop policy if exists "client_apps app read" on public.client_apps;
create policy "client_apps app read" on public.client_apps
  for select using (public.user_has_app_grant(client_id, app_key));

-- -------------------------------------------------------------
-- 6. Extend client_app_data RLS — a grant-holder reaches ONLY their
--    (client, app) data row. Read = any active grant; write = editor/admin;
--    no delete. Staff keep full access via the existing "for all" policy.
-- -------------------------------------------------------------
drop policy if exists "client_app_data app read"   on public.client_app_data;
drop policy if exists "client_app_data app insert" on public.client_app_data;
drop policy if exists "client_app_data app update" on public.client_app_data;

create policy "client_app_data app read" on public.client_app_data
  for select using (public.user_has_app_grant(client_id, app_key));

create policy "client_app_data app insert" on public.client_app_data
  for insert with check (public.user_app_role(client_id, app_key) in ('editor','admin'));

create policy "client_app_data app update" on public.client_app_data
  for update using (public.user_app_role(client_id, app_key) in ('editor','admin'))
           with check (public.user_app_role(client_id, app_key) in ('editor','admin'));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   -- table exists with RLS on
--   select relname, relrowsecurity from pg_class where relname = 'client_app_grants';
--   -- new policies are present
--   select tablename, policyname, cmd from pg_policies
--     where tablename in ('client_app_grants','client_apps','client_app_data')
--     order by tablename, policyname;
--   -- role value is now legal
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'profiles_role_check';
--   -- no grants yet (Phase 2 creates them)
--   select count(*) from public.client_app_grants;
-- =============================================================
-- End of migration 164.
-- =============================================================
