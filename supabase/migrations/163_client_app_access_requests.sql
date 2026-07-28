-- =============================================================
-- Migration 163: Client-app access requests (self-registration)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The /app login page can offer "Register for access" (like the portal's
-- "Request an account"). A prospective app user submits their client name,
-- desired username + password and contact details; it lands here as a
-- PENDING request. The firm reviews it and, on approval, the request becomes
-- a real client_app_users login linked to the right client.
--
-- Service-role only (RLS on, no policies) — written by app-session
-- (register) and read/actioned by app-users (list/approve/reject).
-- =============================================================

begin;

create table if not exists public.client_app_access_requests (
  id            bigserial primary key,
  app_key       text   not null default 'rentals',
  client_name   text   not null,           -- as typed by the requester
  full_name     text,
  username      text   not null,
  password_hash text   not null,           -- pbkdf2 — approval creates the login directly
  email         text,
  phone         text,
  message       text,
  status        text   not null default 'pending' check (status in ('pending','approved','rejected')),
  client_id         bigint references public.clients(id) on delete set null,
  resulting_user_id bigint references public.client_app_users(id) on delete set null,
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists client_app_access_requests_pending_idx
  on public.client_app_access_requests (created_at) where status = 'pending';

comment on table public.client_app_access_requests is
  'Self-service app-access requests (migration 163). Service-role only — submitted via app-session (register), reviewed via app-users.';

alter table public.client_app_access_requests enable row level security;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 163.
-- =============================================================
