-- =============================================================
-- Migration 168: Public read for app_templates
-- Run in Supabase Dashboard → SQL Editor → New Query  (after 167)
-- =============================================================
-- The uploaded apps are served to the iframe by a Vercel serverless function
-- (/api/app-frame) that runs with no logged-in user — it fetches the template
-- HTML with the public (anon) key. A template is app UI code, not client data,
-- so public read is fine. Writes stay staff-only. Client data is never here —
-- it lives in client_app_data (RLS-protected) and flows in over postMessage.
-- =============================================================

begin;

drop policy if exists "app_templates read" on public.app_templates;
create policy "app_templates read" on public.app_templates
  for select using (true);

commit;
-- =============================================================
-- Verify (as anon this returns rows; html is UI code, not client data):
--   select key, name, active from public.app_templates;
-- =============================================================
-- End of migration 168.
-- =============================================================
