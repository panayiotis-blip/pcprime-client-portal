-- =============================================================
-- Migration 170: app template versions + per-client app variants
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Until now one app_templates row held the only copy of an app's HTML, so
-- editing a template changed the app for every client on it the instant it was
-- saved, and no client could differ. This adds both halves of the fix:
--
--   * app_templates.version   — bumped each time the shared HTML is replaced,
--                               so a pinned client records what it is running.
--   * client_apps.pinned_html — a snapshot of the shared template taken when
--                               the firm chooses "leave existing clients as
--                               they are" on save. That client keeps running
--                               this copy.
--   * client_apps.html_override — a copy customised FOR ONE CLIENT. Set by
--                               "Customise for this client".
--
-- An app's HTML resolves as: html_override → pinned_html → the live template.
-- A client holding either one never follows a shared edit again; the firm
-- pushes a new version to them deliberately (clearing both puts them back on
-- the shared template).
--
-- SERVING: the app runs in an iframe from /api/app-frame, a plain GET that
-- carries no session, so it cannot read client_apps under RLS. It resolves a
-- variant through app_frame_html(token) below — a security-definer function
-- keyed by an unguessable per-row token, the same posture as the app share
-- links in migration 162. Enumeration is impossible: without the exact token
-- the function returns nothing, and client_apps itself stays behind RLS.
-- What comes back is app UI code (already world-readable for shared templates
-- since migration 168), never client data — data reaches the app over
-- postMessage from the authenticated portal parent.
-- =============================================================

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- 1. Version counter on the shared template
-- -------------------------------------------------------------
alter table public.app_templates
  add column if not exists version int not null default 1;

comment on column public.app_templates.version is
  'Bumped whenever the shared HTML is replaced (migration 170). Pinned clients record the version they stayed on.';

-- -------------------------------------------------------------
-- 2. Per-client variant columns
-- -------------------------------------------------------------
alter table public.client_apps
  add column if not exists html_override  text,
  add column if not exists pinned_html    text,
  add column if not exists pinned_version int,
  add column if not exists variant_at     timestamptz,
  add column if not exists variant_token  text;

-- Cheap flags so the portal can ask "is this client customised / pinned?"
-- without dragging the whole app HTML (often hundreds of KB) down the wire on
-- every app open and on the rollout screen.
alter table public.client_apps
  add column if not exists is_customised boolean generated always as (html_override is not null) stored,
  add column if not exists is_pinned     boolean generated always as (pinned_html   is not null) stored;

comment on column public.client_apps.html_override is
  'This client''s own customised copy of the app (migration 170). Wins over pinned_html and the shared template.';
comment on column public.client_apps.pinned_html is
  'Snapshot of the shared template kept when the firm chose not to push an edit to this client (migration 170).';

-- Every allocation gets an unguessable token; only rows that actually carry a
-- variant ever return HTML through it.
update public.client_apps
   set variant_token = replace(gen_random_uuid()::text, '-', '')
 where variant_token is null;

alter table public.client_apps
  alter column variant_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists client_apps_variant_token_idx
  on public.client_apps (variant_token) where variant_token is not null;

-- -------------------------------------------------------------
-- 3. Token-gated read for the iframe (see SERVING note above)
-- -------------------------------------------------------------
create or replace function public.app_frame_html(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(html_override, pinned_html)
    from public.client_apps
   where variant_token = p_token
     and enabled
   limit 1;
$$;

comment on function public.app_frame_html(text) is
  'Returns a client''s customised/pinned app HTML for an exact variant token (migration 170). UI code only — no client data. Used by /api/app-frame, which holds no session.';

revoke all on function public.app_frame_html(text) from public;
grant execute on function public.app_frame_html(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   -- columns are there, every allocation has a token, nothing is pinned yet
--   select client_id, app_key, pinned_version, is_customised, is_pinned,
--          (variant_token is not null) as has_token
--     from public.client_apps order by client_id, app_key;
--   -- templates start at version 1
--   select key, name, version, length(html) as html_len from public.app_templates;
--   -- a token with no variant returns null (not an error)
--   select public.app_frame_html('nope');
-- =============================================================
-- End of migration 170.
-- =============================================================
