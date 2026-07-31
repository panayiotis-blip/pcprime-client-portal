-- =============================================================
-- Migration 167: Uploadable app templates
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Lets the firm UPLOAD app templates (self-contained HTML apps) and allocate
-- them to clients from the portal, instead of shipping each app in code. A
-- template is the shared UI; the DATA stays per-client in client_app_data
-- (keyed by client_id + app_key) — so the same template allocated to two
-- clients keeps completely separate data. Allocation reuses client_apps
-- (client_id, app_key = template key).
--
-- Uploaded apps render in an ISOLATED (blob-URL) frame client-side, so they get
-- their own origin and aren't bound by the portal's strict CSP — any
-- self-contained HTML works. Templates are uploaded by trusted firm staff.
-- =============================================================

begin;

create table if not exists public.app_templates (
  id          bigserial primary key,
  key         text    not null unique,     -- stored in client_apps.app_key
  name        text    not null,
  icon        text    not null default '📦',
  description text,
  html        text    not null,            -- the self-contained app HTML
  restricted  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.app_templates is
  'Uploadable app templates (migration 167). html = self-contained app UI rendered in an isolated blob frame. Allocation = client_apps rows; data = client_app_data (isolated per client). Read: any authenticated user (UI code, not client data); write: staff.';

alter table public.app_templates enable row level security;

-- Read: any authenticated user — a client must read the html to render an app
-- allocated to them; the template is UI code, not client data.
drop policy if exists "app_templates read" on public.app_templates;
create policy "app_templates read" on public.app_templates
  for select using (auth.uid() is not null);

-- Write: firm staff only.
drop policy if exists "app_templates write" on public.app_templates;
create policy "app_templates write" on public.app_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists app_templates_updated_at on public.app_templates;
create trigger app_templates_updated_at before update on public.app_templates
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select id, key, name, active, length(html) as html_len from public.app_templates;
-- =============================================================
-- End of migration 167.
-- =============================================================
