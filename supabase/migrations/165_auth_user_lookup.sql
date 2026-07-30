-- =============================================================
-- Migration 165: auth_user_id_by_email() helper (App access Phase 2)
-- Run in Supabase Dashboard → SQL Editor → New Query  (after 164)
-- =============================================================
-- The app-grants-admin Edge Function grants app access "by email". To decide
-- whether an email already has an account (a portal client / staff member) vs.
-- needs a fresh invite, it must resolve email → auth.users.id. The auth schema
-- isn't exposed through PostgREST, so this SECURITY DEFINER helper does the
-- lookup. Locked down to service_role only (the Edge Function) to avoid email
-- enumeration by ordinary users.
-- =============================================================

begin;

create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;

comment on function public.auth_user_id_by_email(text) is
  'Resolve an email to its auth.users id (migration 165). service_role only — used by the app-grants-admin Edge Function to find-or-invite by email.';

-- Only the Edge Function (service_role) may call it — not anon/authenticated.
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

commit;
-- =============================================================
-- Verify:
--   select public.auth_user_id_by_email('info@primeandcalculate.com'); -- returns a uuid
--   select public.auth_user_id_by_email('nobody@example.com');         -- returns null
-- =============================================================
-- End of migration 165.
-- =============================================================
