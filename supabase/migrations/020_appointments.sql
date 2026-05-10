-- =============================================================
-- Migration 020: Appointments / calendar
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Each appointment belongs to ONE owner (whose diary it sits in).
-- Other internal users can also see + edit it (small-firm workflow,
-- audit log captures who did what).
--
-- RLS:
--   Read  → any internal-firm user (is_admin)
--   Write → any internal-firm user (is_admin)
--   Client role users see nothing.
-- =============================================================

begin;

create table if not exists public.appointments (
  id           bigserial primary key,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  client_id    bigint references public.clients(id) on delete set null,

  title        text not null,
  description  text,
  location     text,

  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  all_day      boolean not null default false,

  status       text not null default 'confirmed'
                check (status in ('confirmed', 'tentative', 'cancelled')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  check (ends_at >= starts_at)
);

create index if not exists appointments_owner_starts_idx on public.appointments(owner_id, starts_at);
create index if not exists appointments_starts_idx       on public.appointments(starts_at);
create index if not exists appointments_client_idx       on public.appointments(client_id) where client_id is not null;

-- updated_at trigger
drop trigger if exists appointments_updated_at on public.appointments;
create trigger appointments_updated_at before update on public.appointments
  for each row execute function public.tg_set_updated_at();

-- audit trigger (uses tg_audit from migration 007)
drop trigger if exists tg_audit_appointments on public.appointments;
create trigger tg_audit_appointments
  after insert or update or delete on public.appointments
  for each row execute function public.tg_audit();

-- RLS: any internal-firm user reads + writes
alter table public.appointments enable row level security;

drop policy if exists "appointments read"  on public.appointments;
drop policy if exists "appointments write" on public.appointments;

create policy "appointments read" on public.appointments
  for select using (public.is_admin());

create policy "appointments write" on public.appointments
  for all using (public.is_admin()) with check (public.is_admin());

commit;
-- =============================================================
-- End of migration 020.
-- =============================================================
