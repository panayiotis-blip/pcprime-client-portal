-- =============================================================
-- Migration 049: UI Polish — Internal Go-Live
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Bundles all schema changes for the UI polish pass:
--
-- 1. sidebar_state column on user_dashboard_preferences (Part 1)
-- 2. user_favourites table + RLS (Part 3)
-- 3. client_addresses table + data migration from clients.address etc. (Part 5)
-- 4. New columns on clients: vat_status, vat_registration_date,
--    si_registration_date (Part 6)
--
-- Legacy single-address columns on `clients` are PRESERVED in this
-- migration so reads keep working until all callers are updated. They
-- can be dropped in a later migration.
-- =============================================================

begin;

-- =============================================================
-- 1. Sidebar collapsed/expanded state (Part 1)
-- =============================================================
alter table public.user_dashboard_preferences
  add column if not exists sidebar_state jsonb not null default '{}'::jsonb;

-- Shape: { "groups": { "operations": "collapsed", "clients": "expanded" } }
-- Groups not present default to the smart default (current route open).
comment on column public.user_dashboard_preferences.sidebar_state is
  'Per-user sidebar group collapse/expand state. JSONB { "groups": { groupKey: "expanded" | "collapsed" } }';

-- =============================================================
-- 2. user_favourites (Part 3)
-- =============================================================
create table if not exists public.user_favourites (
  id              bigserial primary key,
  user_id         uuid    not null references auth.users(id) on delete cascade,
  favourite_type  text    not null check (favourite_type in ('menu_item','client')),
  target_id       text    not null,
  label           text,                 -- snapshot of display name (clients change)
  sort_order      int     not null default 0,
  created_at      timestamptz not null default now(),
  unique (user_id, favourite_type, target_id)
);

create index if not exists user_favourites_user_idx
  on public.user_favourites (user_id, favourite_type, sort_order);

alter table public.user_favourites enable row level security;

drop policy if exists "user_favourites self read"   on public.user_favourites;
drop policy if exists "user_favourites self insert" on public.user_favourites;
drop policy if exists "user_favourites self update" on public.user_favourites;
drop policy if exists "user_favourites self delete" on public.user_favourites;

create policy "user_favourites self read" on public.user_favourites
  for select using (user_id = auth.uid());
create policy "user_favourites self insert" on public.user_favourites
  for insert with check (user_id = auth.uid());
create policy "user_favourites self update" on public.user_favourites
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_favourites self delete" on public.user_favourites
  for delete using (user_id = auth.uid());

-- Atomic pin RPC: enforces the 5-per-type cap and chooses the next sort_order.
create or replace function public.pin_favourite(
  p_favourite_type text,
  p_target_id      text,
  p_label          text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count   int;
  v_next    int;
  v_id      bigint;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_favourite_type not in ('menu_item','client') then
    raise exception 'Invalid favourite type: %', p_favourite_type;
  end if;

  -- Idempotent: if already pinned, return existing id
  select id into v_id from public.user_favourites
   where user_id = v_user_id and favourite_type = p_favourite_type and target_id = p_target_id;
  if v_id is not null then return v_id; end if;

  -- Cap enforcement
  select count(*) into v_count from public.user_favourites
   where user_id = v_user_id and favourite_type = p_favourite_type;
  if v_count >= 5 then
    raise exception 'Maximum 5 % favourites reached. Unpin one first.', p_favourite_type;
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_next from public.user_favourites
   where user_id = v_user_id and favourite_type = p_favourite_type;

  insert into public.user_favourites (user_id, favourite_type, target_id, label, sort_order)
  values (v_user_id, p_favourite_type, p_target_id, p_label, v_next)
  returning id into v_id;

  -- Audit (only meaningful for clients per spec; menu items are noise)
  if p_favourite_type = 'client' then
    insert into public.audit_log (actor_id, action, target_type, target_id, summary)
    values (v_user_id, 'favourites.pin_client', 'clients', null,
            jsonb_build_object('client_id', p_target_id, 'label', p_label));
  end if;

  return v_id;
end $$;

revoke all on function public.pin_favourite(text, text, text) from public;
grant   execute on function public.pin_favourite(text, text, text) to authenticated;

-- =============================================================
-- 3. client_addresses (Part 5)
-- =============================================================
create table if not exists public.client_addresses (
  id            bigserial primary key,
  client_id     bigint  not null references public.clients(id) on delete cascade,
  address_type  text    not null check (address_type in ('registered','trading','postal','home')),
  line1         text,
  line2         text,
  city          text,
  postal_code   text,
  country       text default 'Cyprus',
  notes         text,
  is_linked_to_registered  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, address_type)
);

create index if not exists client_addresses_client_idx
  on public.client_addresses (client_id);

drop trigger if exists client_addresses_updated_at on public.client_addresses;
create trigger client_addresses_updated_at before update on public.client_addresses
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_client_addresses on public.client_addresses;
create trigger tg_audit_client_addresses
  after insert or update or delete on public.client_addresses
  for each row execute function public.tg_audit();

alter table public.client_addresses enable row level security;

drop policy if exists "client_addresses read"  on public.client_addresses;
drop policy if exists "client_addresses write" on public.client_addresses;

-- Reuse the existing access helper from earlier migrations
create policy "client_addresses read" on public.client_addresses
  for select using (public.user_can_access_client(client_id));

create policy "client_addresses write" on public.client_addresses
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

-- Data migration: seed client_addresses from the legacy single-address fields.
-- Skip rows that already have a client_addresses entry (idempotent re-runs).
insert into public.client_addresses (client_id, address_type, line1, city, postal_code, country)
select
  c.id,
  case
    when c.client_category in ('company','partnership','sole_trader') then 'registered'
    else 'home'
  end as address_type,
  nullif(trim(coalesce(c.address, '')), '')      as line1,
  nullif(trim(coalesce(c.city, '')), '')         as city,
  nullif(trim(coalesce(c.postal_code, '')), '')  as postal_code,
  coalesce(nullif(trim(coalesce(c.country, '')), ''), 'Cyprus') as country
from public.clients c
where (
  (c.address is not null and trim(c.address) <> '')
  or (c.city is not null and trim(c.city) <> '')
  or (c.postal_code is not null and trim(c.postal_code) <> '')
)
and not exists (
  select 1 from public.client_addresses ca
   where ca.client_id = c.id
);

-- =============================================================
-- 4. New columns on clients for the Registrations tab (Part 6)
-- =============================================================
alter table public.clients add column if not exists vat_status            text;
alter table public.clients add column if not exists vat_registration_date date;
alter table public.clients add column if not exists si_registration_date  date;

comment on column public.clients.vat_status is
  'VAT status (free-text picklist on UI: Regular / Reduced / Exempt / Not Registered)';

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 049.
-- =============================================================
