-- =============================================================
-- Migration 052: Vendor flag on clients (UI Polish v2 — Part 6)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- 6A — adds:
--   * clients.is_vendor      — a client that is also a supplier; appears
--                              in Purchase Invoice vendor dropdowns.
--   * client_category value 'vendor_only' — a pure vendor (created via the
--                              quick-create flow), never an engagement client.
-- =============================================================

begin;

-- ---- is_vendor flag ----
alter table public.clients
  add column if not exists is_vendor boolean not null default false;

comment on column public.clients.is_vendor is
  'When true, the client also appears in Purchase Invoice vendor dropdowns.';

-- Partial index — speeds up the vendor dropdown lookup.
create index if not exists clients_is_vendor_idx
  on public.clients (is_vendor) where is_vendor;

-- ---- add 'vendor_only' to the client_category CHECK ----
-- The original constraint (migration 031) was created inline and unnamed, so
-- its name is auto-generated. Find it by introspection and drop it, so this
-- migration is robust regardless of the exact generated name.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.clients'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%client_category%';
  if cname is not null then
    execute format('alter table public.clients drop constraint %I', cname);
  end if;
end $$;

alter table public.clients
  add constraint clients_client_category_check
  check (client_category is null or client_category in (
    'company', 'partnership', 'individual', 'sole_trader',
    'self_employed', 'deceased', 'dormant', 'prospective', 'other',
    'vendor_only'
  ));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 052.
-- =============================================================
