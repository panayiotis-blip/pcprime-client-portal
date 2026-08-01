-- =============================================================
-- Migration 169: mark legacy app logins as moved to email identity
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- App access Phase 5 (cutover). The username-based logins in
-- client_app_users (migration 162) are being replaced by email/Supabase-Auth
-- accounts holding client_app_grants (migration 164). The firm moves each
-- legacy login over one at a time from the client's Apps tab; this records
-- where it went so the old row stays as an audit trail instead of vanishing:
--
--   * migrated_at      — when the firm moved this login to an email account
--   * migrated_user_id — the auth.users id that now holds the grant
--   * migrated_email   — the email it was moved to (kept even if the auth
--                        user is later deleted, so the trail survives)
--
-- The move itself sets active = false, so the old username can no longer sign
-- in at /app while the row (and its username) is still on file. Purely
-- additive — nothing reads these columns except the firm-side panel.
-- =============================================================

begin;

alter table public.client_app_users
  add column if not exists migrated_at      timestamptz,
  add column if not exists migrated_user_id uuid references auth.users(id) on delete set null,
  add column if not exists migrated_email   text;

comment on column public.client_app_users.migrated_at is
  'Phase 5: when this username login was moved onto an email account (client_app_grants). Non-null = retired.';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select id, username, active, migrated_at, migrated_email
--     from public.client_app_users order by client_id, username;
--   -- who is still on the old system (must be empty before the old login
--   -- box and the app-session login action are removed):
--   select count(*) from public.client_app_users where active and migrated_at is null;
-- =============================================================
-- End of migration 169.
-- =============================================================
