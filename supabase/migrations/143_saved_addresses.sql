-- =============================================================
-- Migration 143: Saved (reusable) address book
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Some clients share the same address (same building, same registered
-- office, etc.). This adds a firm-wide address book so an address can be
-- saved once (with a label) and reused on any client.
--
-- Reuse is COPY-ON-USE: picking a saved address copies its text into the
-- client's own client_addresses row, so each client keeps an independent
-- copy — editing one client's address never changes another.
-- =============================================================

begin;

create table if not exists public.saved_addresses (
  id           bigserial primary key,
  label        text not null,
  line1        text,
  line2        text,
  line3        text,
  office       text,
  city         text,
  postal_code  text,
  country      text default 'Cyprus',
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists saved_addresses_updated_at on public.saved_addresses;
create trigger saved_addresses_updated_at before update on public.saved_addresses
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_saved_addresses on public.saved_addresses;
create trigger tg_audit_saved_addresses
  after insert or update or delete on public.saved_addresses
  for each row execute function public.tg_audit();

alter table public.saved_addresses enable row level security;

drop policy if exists "saved_addresses read"  on public.saved_addresses;
drop policy if exists "saved_addresses write" on public.saved_addresses;

-- Firm-internal reference data: any staff member can read/use and manage it.
create policy "saved_addresses read" on public.saved_addresses
  for select using (public.is_admin());

create policy "saved_addresses write" on public.saved_addresses
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 143.
-- =============================================================
