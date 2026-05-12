-- 028_user_dashboard_preferences.sql
-- Per-user dashboard layout: which widgets are visible, in what order, at what
-- size. One row per user, JSONB column holds the full layout. RLS limits each
-- user to their own row.
--
-- JSONB shape:
--   { "widgets": [
--       { "id": "kpi-clients", "size": "small",  "visible": true, "order": 0 },
--       { "id": "tasks",       "size": "medium", "visible": true, "order": 5 },
--       ...
--     ] }
--
-- New widgets added later are merged client-side with the registry — users
-- don't get reset, they get the new widget at its default visibility.

create table if not exists public.user_dashboard_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  layout     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.user_dashboard_preferences is
  'Per-user dashboard layout config (which widgets, what order, what size). One row per user, layout JSONB.';

-- Auto-bump updated_at on UPDATE
create or replace function public._tg_user_dash_prefs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_user_dash_prefs_updated_at on public.user_dashboard_preferences;
create trigger trg_user_dash_prefs_updated_at
  before update on public.user_dashboard_preferences
  for each row execute function public._tg_user_dash_prefs_updated_at();

-- ---- RLS: each user reads/writes only their own row ----
alter table public.user_dashboard_preferences enable row level security;

drop policy if exists "self_read_dash_prefs"   on public.user_dashboard_preferences;
drop policy if exists "self_insert_dash_prefs" on public.user_dashboard_preferences;
drop policy if exists "self_update_dash_prefs" on public.user_dashboard_preferences;

create policy "self_read_dash_prefs"
  on public.user_dashboard_preferences for select to authenticated
  using (user_id = auth.uid());

create policy "self_insert_dash_prefs"
  on public.user_dashboard_preferences for insert to authenticated
  with check (user_id = auth.uid());

create policy "self_update_dash_prefs"
  on public.user_dashboard_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
