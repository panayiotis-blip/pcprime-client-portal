-- 027_view_preferences.sql
-- Cross-device view-mode preferences for each user. One JSONB column on
-- profiles, with object keys per page (clients / invoices / documents) and
-- string values from the set {grid, compact, list}. Trivial RLS reuse:
-- profiles already only lets a user read/write their own row.
--
-- Future preferences (theme, default landing page, etc.) can drop into the
-- same column without a schema change.

alter table public.profiles
  add column if not exists view_preferences jsonb not null default '{}'::jsonb;

comment on column public.profiles.view_preferences is
  'Per-user UI preferences (currently view modes per list page). Object shape: { clients?: "grid"|"compact"|"list", invoices?: ..., documents?: ... }. Defaults to {} so each page falls back to its own default until the user picks something.';
