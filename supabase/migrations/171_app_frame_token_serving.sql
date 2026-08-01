-- =============================================================
-- Migration 171: serve the SHARED template through the variant token too
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Step 1 of closing the public read on app_templates (migration 168), which
-- currently lets anyone who guesses an app key download that app's HTML.
--
-- app_frame_html() already answers with a client's customised or pinned copy
-- for their unguessable per-allocation token. It now falls back to the shared
-- template as well, so EVERY uploaded app can be served by token alone and the
-- key-based public read is no longer needed by anything.
--
-- ADDITIVE AND SAFE TO RUN NOW: the old key path keeps working until the new
-- /api/app-frame is deployed. Migration 172 then revokes the public read —
-- run that one only AFTER the deploy, or apps will stop loading in between.
-- =============================================================

begin;

create or replace function public.app_frame_html(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(ca.html_override, ca.pinned_html, t.html)
    from public.client_apps ca
    left join public.app_templates t
      on t.key = ca.app_key and t.active
   where ca.variant_token = p_token
     and ca.enabled
   limit 1;
$$;

comment on function public.app_frame_html(text) is
  'App HTML for one allocation, by its unguessable token (migrations 170/171): the client''s customised copy, else the version they were held on, else the shared template. UI code only — no client data. Used by /api/app-frame, which holds no session.';

revoke all on function public.app_frame_html(text) from public;
grant execute on function public.app_frame_html(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify (pick a real allocation):
--   select app_key, variant_token from public.client_apps where enabled limit 5;
--   -- should now return the shared template's HTML length for a client that
--   -- is neither customised nor pinned:
--   select length(public.app_frame_html('<paste a variant_token>'));
--   -- an unknown token still returns null, not an error:
--   select public.app_frame_html('nope');
-- =============================================================
-- End of migration 171.
-- =============================================================
