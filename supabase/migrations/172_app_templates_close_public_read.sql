-- =============================================================
-- Migration 172: close the public read on app_templates
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- ⚠ RUN THIS ONLY AFTER migration 171 AND after the deploy that makes
--   /api/app-frame fetch by variant token. Running it earlier stops every
--   uploaded app from loading.
--
-- Migration 168 made app_templates world-readable so the iframe — which
-- carries no session — could fetch an app by key. That also meant anyone who
-- guessed a key could download that app's HTML. Apps are now served through
-- app_frame_html() against an unguessable per-allocation token, so the public
-- read has no job left and goes back to authenticated-only (as migration 167
-- had it): the portal registry still lists templates for signed-in users, and
-- the iframe reaches HTML only via a token it was given.
--
-- After this, an uploaded app's HTML is no longer downloadable by key. It is
-- still readable by any signed-in portal user, so treat app HTML as internal
-- code: no secrets, no API keys, nothing client-specific that others shouldn't
-- see.
-- =============================================================

begin;

drop policy if exists "app_templates read" on public.app_templates;
create policy "app_templates read" on public.app_templates
  for select using (auth.uid() is not null);

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   -- the policy is back to authenticated-only
--   select policyname, qual from pg_policies
--    where tablename = 'app_templates' and policyname = 'app_templates read';
--   -- and from a signed-OUT session (e.g. curl with the anon key) this now
--   -- returns no rows:
--   --   curl "$SUPABASE_URL/rest/v1/app_templates?select=key" -H "apikey: $ANON"
--   -- while an allocated app still loads in the portal (served by token).
-- =============================================================
-- End of migration 172.
-- =============================================================
