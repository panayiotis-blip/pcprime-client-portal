-- =============================================================
-- Migration 160: Rental-collections module (foundation)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Backs the "Property Rentals" module (originally a standalone HTML app
-- built for the client Greson Easy Loo). Instead of the app's browser
-- localStorage + client-side password, its whole state now lives as one
-- JSON document per client in Supabase, behind the portal's real auth:
--
--   * clients.rental_enabled — switch the module on per client (only
--     enabled clients see the Rentals nav / route).
--   * public.rental_data — one row per client holding the app's data
--     (properties, tenants, rent schedules, receipts, deposits, audit).
--     RLS reuses user_can_access_client: firm staff reach every client's
--     data; a client's own users reach only theirs. Multiple client users
--     per client are already supported via user_clients.
--
-- The app's own users[] array is dropped — login is the portal's.
-- =============================================================

begin;

alter table public.clients
  add column if not exists rental_enabled boolean not null default false;

create table if not exists public.rental_data (
  client_id  bigint primary key references public.clients(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.rental_data is
  'One JSON document per client for the Property Rentals module (migration 160). Written by the client''s own users and firm staff; RLS via user_can_access_client.';

-- Keep updated_at fresh on every write.
drop trigger if exists rental_data_updated_at on public.rental_data;
create trigger rental_data_updated_at before update on public.rental_data
  for each row execute function public.tg_set_updated_at();

alter table public.rental_data enable row level security;

-- Firm staff (is_admin) reach all; a client's linked users reach only their row.
drop policy if exists "rental_data access" on public.rental_data;
create policy "rental_data access" on public.rental_data
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- After running: enable the module for Greson Easy Loo, e.g.
--   update public.clients set rental_enabled = true
--   where name ilike '%greson%';
-- (Find the exact client id with:  select id, name from public.clients where name ilike '%greson%';)
-- =============================================================
-- End of migration 160.
-- =============================================================
