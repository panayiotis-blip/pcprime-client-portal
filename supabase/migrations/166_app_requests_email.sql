-- =============================================================
-- Migration 166: Email-based app-access requests (App access Phase 4)
-- Run in Supabase Dashboard → SQL Editor → New Query  (after 164, 165)
-- =============================================================
-- Self-registration moves from "pick a username + password" to "request by
-- email". Approval now invites/reuses the email account and writes a
-- client_app_grants row (Phase 4), instead of creating a client_app_users
-- login. So the old username/password_hash columns become optional, and we
-- record which grant an approval produced.
-- =============================================================

begin;

alter table public.client_app_access_requests
  alter column username      drop not null,
  alter column password_hash drop not null;

alter table public.client_app_access_requests
  add column if not exists resulting_grant_id bigint
    references public.client_app_grants(id) on delete set null;

comment on table public.client_app_access_requests is
  'Self-service app-access requests (mig 163; email-based since mig 166). Submitted via the public app-request fn, reviewed via app-grants-admin — approval invites/reuses the email account and creates a client_app_grants grant.';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select column_name, is_nullable from information_schema.columns
--     where table_name = 'client_app_access_requests'
--       and column_name in ('username','password_hash','email','resulting_grant_id');
-- =============================================================
-- End of migration 166.
-- =============================================================
