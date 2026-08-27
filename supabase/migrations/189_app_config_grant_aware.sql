-- =============================================================
-- Migration 189: app configuration must be readable by app-grant users
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 187 gated client_app_config on user_can_access_client, which is
-- `is_admin() OR a row in user_clients`. It predates client_app_grants and
-- knows nothing about them, so an app-grant user — a real Supabase login whose
-- access comes entirely from a grant, which is what every client app user
-- actually is — reads nothing and the app renders as if unconfigured.
--
-- The effect was silent and exactly backwards: configuration set for a client
-- applied when the FIRM opened the app and not when the CLIENT did. A VAT rate
-- or a hidden screen would look right in testing and do nothing in use.
--
-- Reads now also accept a grant on that app, matching how client_app_data is
-- already gated (user_has_app_grant). WRITES ARE UNCHANGED — still
-- is_supervisor_or_higher, so a client still cannot reconfigure their own app.
-- That asymmetry is the whole point of the table.
-- =============================================================

begin;

drop policy if exists "client_app_config read" on public.client_app_config;
create policy "client_app_config read" on public.client_app_config
  for select using (
    public.user_can_access_client(client_id)      -- firm staff, portal clients
    or public.user_has_app_grant(client_id, app_key)  -- app-grant users
  );

commit;

-- =============================================================
-- Verify (as a grant user, config for an app they hold should be visible):
--   select policyname, qual from pg_policies
--    where tablename = 'client_app_config' and cmd = 'SELECT';
-- =============================================================
-- End of migration 189.
-- =============================================================
