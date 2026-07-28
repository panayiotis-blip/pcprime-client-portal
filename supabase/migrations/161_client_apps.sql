-- =============================================================
-- Migration 161: Generic per-client apps
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Generalises the rental module into a reusable "client apps" framework so
-- each client can have one or more embedded apps (rentals today, more later),
-- surfaced as an Apps tab in the client file (firm) and an Apps section in the
-- client's own portal.
--
--   * client_apps       — which apps each client has (replaces clients.rental_enabled).
--   * client_app_data   — one JSON document per (client, app) (replaces rental_data).
--
-- RLS reuses user_can_access_client: firm staff reach every client's apps; a
-- client's own users reach only theirs. The old rental_data table +
-- clients.rental_enabled are left in place (unused) — drop later once verified.
-- =============================================================

begin;

-- Which apps a client has enabled.
create table if not exists public.client_apps (
  client_id  bigint  not null references public.clients(id) on delete cascade,
  app_key    text    not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (client_id, app_key)
);
alter table public.client_apps enable row level security;
drop policy if exists "client_apps access" on public.client_apps;
create policy "client_apps access" on public.client_apps
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

-- One JSON document per (client, app).
create table if not exists public.client_app_data (
  client_id  bigint not null references public.clients(id) on delete cascade,
  app_key    text   not null,
  data       jsonb  not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (client_id, app_key)
);
comment on table public.client_app_data is
  'One JSON document per (client, app) for embedded client apps (migration 161). RLS via user_can_access_client.';
alter table public.client_app_data enable row level security;
drop policy if exists "client_app_data access" on public.client_app_data;
create policy "client_app_data access" on public.client_app_data
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));
drop trigger if exists client_app_data_updated_at on public.client_app_data;
create trigger client_app_data_updated_at before update on public.client_app_data
  for each row execute function public.tg_set_updated_at();

-- Migrate existing rentals (enablement + data) into the generic tables.
insert into public.client_apps (client_id, app_key, enabled)
select id, 'rentals', true from public.clients where rental_enabled = true
on conflict (client_id, app_key) do update set enabled = excluded.enabled;

insert into public.client_app_data (client_id, app_key, data, updated_at)
select client_id, 'rentals', data, updated_at from public.rental_data
on conflict (client_id, app_key) do update set data = excluded.data, updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select ca.client_id, c.name, ca.app_key, ca.enabled,
--          (cad.client_id is not null) as has_data
--   from public.client_apps ca
--   join public.clients c on c.id = ca.client_id
--   left join public.client_app_data cad
--     on cad.client_id = ca.client_id and cad.app_key = ca.app_key;
-- =============================================================
-- End of migration 161.
-- =============================================================
