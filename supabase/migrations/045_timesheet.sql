-- =============================================================
-- Migration 045: Timesheet (time_entries + active_timers + hourly_rate)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Purpose: let staff record how much time they spent on each client
-- and what service was provided. Supports a quick-log form, an
-- active start/stop timer, and optional linking to appointments.
--
-- Storage model:
--   profiles.hourly_rate           Per-staff hourly rate (€/h). Snapshot
--                                  is captured per entry so rate changes
--                                  don't rewrite historical figures.
--   time_entries                   One row per logged unit of work.
--   active_timers                  One row per user with a running timer.
--                                  When the user presses Stop the row is
--                                  converted into time_entries and deleted.
--
-- Service picklist is enforced by a CHECK constraint.
--
-- RLS:
--   Internal-firm users (owner/supervisor/admin/staff) read + write
--   anyone's entries. Day-to-day staff will typically only view their
--   own via UI filters, but RLS is permissive so admin/supervisor can
--   inspect all timesheets without extra plumbing.
-- =============================================================

begin;

-- ---------- 1. Add hourly_rate to profiles ----------
alter table public.profiles
  add column if not exists hourly_rate numeric(10,2);

-- ---------- 2. time_entries ----------
create table if not exists public.time_entries (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_id       bigint references public.clients(id) on delete set null,
  entry_date      date not null default current_date,
  minutes         int not null check (minutes > 0),
  service         text not null check (service in (
                    'Bookkeeping','VAT','Payroll','Audit','Tax Returns',
                    'Company Admin','Meetings','Other'
                  )),
  description     text,
  billable        boolean not null default true,
  rate_snapshot   numeric(10,2),          -- captured from profiles.hourly_rate at insert
  appointment_id  bigint references public.appointments(id) on delete set null,
  start_at        timestamptz,            -- populated when entry came from a timer
  end_at          timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists time_entries_user_date_idx
  on public.time_entries (user_id, entry_date desc);
create index if not exists time_entries_client_date_idx
  on public.time_entries (client_id, entry_date desc)
  where client_id is not null;
create index if not exists time_entries_appointment_idx
  on public.time_entries (appointment_id)
  where appointment_id is not null;

-- updated_at trigger
drop trigger if exists time_entries_updated_at on public.time_entries;
create trigger time_entries_updated_at before update on public.time_entries
  for each row execute function public.tg_set_updated_at();

-- audit trigger
drop trigger if exists tg_audit_time_entries on public.time_entries;
create trigger tg_audit_time_entries
  after insert or update or delete on public.time_entries
  for each row execute function public.tg_audit();

-- Auto-fill rate_snapshot from profiles.hourly_rate on insert if not provided
create or replace function public.tg_time_entries_snapshot_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rate_snapshot is null then
    select hourly_rate into new.rate_snapshot
    from public.profiles where id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists time_entries_snapshot_rate on public.time_entries;
create trigger time_entries_snapshot_rate before insert on public.time_entries
  for each row execute function public.tg_time_entries_snapshot_rate();

-- RLS
alter table public.time_entries enable row level security;

drop policy if exists "time_entries read"  on public.time_entries;
drop policy if exists "time_entries write" on public.time_entries;

create policy "time_entries read" on public.time_entries
  for select using (public.is_admin());

create policy "time_entries write" on public.time_entries
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 3. active_timers (one row max per user) ----------
create table if not exists public.active_timers (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  client_id       bigint references public.clients(id) on delete set null,
  service         text check (service in (
                    'Bookkeeping','VAT','Payroll','Audit','Tax Returns',
                    'Company Admin','Meetings','Other'
                  )),
  description     text,
  appointment_id  bigint references public.appointments(id) on delete set null,
  billable        boolean not null default true,
  started_at      timestamptz not null default now()
);

alter table public.active_timers enable row level security;

drop policy if exists "active_timers read"  on public.active_timers;
drop policy if exists "active_timers write" on public.active_timers;

create policy "active_timers read" on public.active_timers
  for select using (public.is_admin());

create policy "active_timers write" on public.active_timers
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 4. start/stop timer RPCs ----------
-- Atomic helpers so the UI doesn't have to juggle insert + delete across
-- two tables.

create or replace function public.start_timer(
  p_client_id      bigint default null,
  p_service        text   default null,
  p_description    text   default null,
  p_appointment_id bigint default null,
  p_billable       boolean default true
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  -- Upsert the active timer (latest start wins if already running)
  insert into public.active_timers (user_id, client_id, service, description, appointment_id, billable, started_at)
  values (v_user_id, p_client_id, p_service, p_description, p_appointment_id, coalesce(p_billable, true), now())
  on conflict (user_id) do update set
    client_id      = excluded.client_id,
    service        = excluded.service,
    description    = excluded.description,
    appointment_id = excluded.appointment_id,
    billable       = excluded.billable,
    started_at     = excluded.started_at;
end $$;

revoke all on function public.start_timer(bigint, text, text, bigint, boolean) from public;
grant   execute on function public.start_timer(bigint, text, text, bigint, boolean) to authenticated;

-- Stop the current user's running timer; if minutes elapsed >= 1, persist
-- a time_entries row. Returns the new time_entries.id (or null if discarded).
create or replace function public.stop_timer(
  p_description text default null,         -- optional override before saving
  p_service     text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_timer   public.active_timers%rowtype;
  v_minutes int;
  v_new_id  bigint;
  v_service text;
  v_desc    text;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_timer from public.active_timers where user_id = v_user_id;
  if not found then return null; end if;

  v_minutes := greatest(1, round(extract(epoch from (now() - v_timer.started_at)) / 60)::int);
  v_service := coalesce(nullif(trim(p_service), ''), v_timer.service, 'Other');
  v_desc    := coalesce(nullif(trim(p_description), ''), v_timer.description);

  insert into public.time_entries (
    user_id, client_id, entry_date, minutes, service, description,
    billable, appointment_id, start_at, end_at
  ) values (
    v_user_id, v_timer.client_id, (v_timer.started_at at time zone 'UTC')::date,
    v_minutes, v_service, v_desc,
    v_timer.billable, v_timer.appointment_id, v_timer.started_at, now()
  )
  returning id into v_new_id;

  delete from public.active_timers where user_id = v_user_id;
  return v_new_id;
end $$;

revoke all on function public.stop_timer(text, text) from public;
grant   execute on function public.stop_timer(text, text) to authenticated;

-- Discard the running timer without saving
create or replace function public.cancel_timer() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  delete from public.active_timers where user_id = v_user_id;
end $$;

revoke all on function public.cancel_timer() from public;
grant   execute on function public.cancel_timer() to authenticated;

-- Reload PostgREST schema so the new RPCs are visible immediately
notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 045.
-- =============================================================
