-- =============================================================
-- Migration 064: editable client categories
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Turns the previously hard-coded client/company category list into an
-- editable master list, managed in Company Settings (like Document
-- Categories). The clients.client_category column still stores the
-- category `value`.
--
-- is_system rows are the categories the app branches on (company /
-- partnership / sole_trader drive the registration panels; vendor_only
-- drives the vendor flag). They can be renamed or hidden but a trigger
-- blocks deleting them.
-- =============================================================

begin;

create table if not exists public.client_categories (
  id            bigserial primary key,
  value         text    not null unique,
  label         text    not null,
  is_active     boolean not null default true,
  is_system     boolean not null default false,
  display_order int     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.client_categories is
  'Editable master list of client/company categories. is_system rows are core categories the app branches on — they can be renamed or hidden but not deleted.';

drop trigger if exists client_categories_updated_at on public.client_categories;
create trigger client_categories_updated_at before update on public.client_categories
  for each row execute function public.tg_set_updated_at();

-- Block deletion of built-in categories (the app's form logic relies on them).
create or replace function public.tg_block_system_category_delete()
returns trigger language plpgsql as $$
begin
  if old.is_system then
    raise exception 'Cannot delete the built-in category "%". Rename or hide it instead.', old.label;
  end if;
  return old;
end $$;

drop trigger if exists block_system_category_delete on public.client_categories;
create trigger block_system_category_delete before delete on public.client_categories
  for each row execute function public.tg_block_system_category_delete();

alter table public.client_categories enable row level security;

drop policy if exists "client_categories read"  on public.client_categories;
drop policy if exists "client_categories write" on public.client_categories;

-- Any signed-in user reads the list (it drives the client form dropdown).
create policy "client_categories read" on public.client_categories
  for select using (auth.uid() is not null);

-- Only the Owner can add / edit / delete categories.
create policy "client_categories write" on public.client_categories
  for all using (public.is_owner()) with check (public.is_owner());

-- Seed the existing categories as built-ins. Idempotent.
insert into public.client_categories (value, label, is_system, display_order)
values
  ('company',       'Company',           true, 1),
  ('partnership',   'Partnership',       true, 2),
  ('individual',    'Individual',        true, 3),
  ('sole_trader',   'Sole Trader',       true, 4),
  ('self_employed', 'Self-Employed',     true, 5),
  ('deceased',      'Deceased',          true, 6),
  ('dormant',       'Dormant',           true, 7),
  ('prospective',   'Prospective',       true, 8),
  ('other',         'Other',             true, 9),
  ('vendor_only',   'Vendor (supplier)', true, 10)
on conflict (value) do nothing;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 064.
-- =============================================================
