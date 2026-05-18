-- =============================================================
-- Migration 065: editable cities list
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A managed list of cities, offered as a dropdown when entering a client
-- address. Managed in Company Settings. Seeded from the cities already in
-- use plus the main Cyprus cities.
-- =============================================================

begin;

create table if not exists public.cities (
  id          bigserial primary key,
  name        text    not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.cities is
  'Editable list of cities offered in the client address dropdown.';

drop trigger if exists cities_updated_at on public.cities;
create trigger cities_updated_at before update on public.cities
  for each row execute function public.tg_set_updated_at();

alter table public.cities enable row level security;

drop policy if exists "cities read"  on public.cities;
drop policy if exists "cities write" on public.cities;

create policy "cities read" on public.cities
  for select using (auth.uid() is not null);

create policy "cities write" on public.cities
  for all using (public.is_owner()) with check (public.is_owner());

-- Seed: main Cyprus cities, then every city already used on a client address.
insert into public.cities (name)
values ('Nicosia'), ('Limassol'), ('Larnaca'), ('Paphos'), ('Famagusta'), ('Kyrenia')
on conflict (name) do nothing;

insert into public.cities (name)
select distinct initcap(trim(city))
from public.client_addresses
where city is not null and trim(city) <> ''
on conflict (name) do nothing;

insert into public.cities (name)
select distinct initcap(trim(city))
from public.clients
where city is not null and trim(city) <> ''
on conflict (name) do nothing;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 065.
-- =============================================================
