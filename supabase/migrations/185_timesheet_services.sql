-- =============================================================
-- Migration 185: services become data, not a CHECK constraint
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- WHY. The list of services was frozen into three CHECK constraints and
-- re-typed into three React files. Adding one meant a migration and a deploy,
-- so in practice nobody could. Worse, the lists had already drifted:
-- time_entries allowed FOURTEEN services (8 billable + 6 internal: Internal
-- Admin, Training, Annual Leave, Sick Leave, Public Holiday, Other Internal)
-- while staff_service_rates allowed only the 8 billable ones — which is why
-- the internal ones could be logged against but never appeared under Default
-- Service Rates to be edited.
--
-- The list becomes a table. The CHECKs become foreign keys, so the database
-- still refuses a service that does not exist — the rule is kept, only its
-- source moves from DDL to a row an admin can edit.
--
-- ON UPDATE CASCADE is the point of using the label as the key: renaming
-- "Meetings" to "Client Meetings" rewrites every historic entry with it, so a
-- rename is a rename rather than an orphaning.
--
-- ON DELETE RESTRICT: a service that has been used cannot be deleted out from
-- under its history. Retire it with active = false — it then disappears from
-- the pickers while every past entry keeps its meaning.
-- =============================================================

begin;

create table if not exists public.timesheet_services (
  label      text primary key,
  billable   boolean not null default true,
  ordinal    integer not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed from what the constraints already allowed, so nothing in use is lost
-- and the ordering matches the pickers people are used to.
insert into public.timesheet_services (label, billable, ordinal) values
  ('Bookkeeping',     true,  10),
  ('VAT',             true,  20),
  ('Payroll',         true,  30),
  ('Audit',           true,  40),
  ('Tax Returns',     true,  50),
  ('Company Admin',   true,  60),
  ('Meetings',        true,  70),
  ('Other',           true,  80),
  ('Internal Admin',  false, 110),
  ('Training',        false, 120),
  ('Annual Leave',    false, 130),
  ('Sick Leave',      false, 140),
  ('Public Holiday',  false, 150),
  ('Other Internal',  false, 160)
on conflict (label) do nothing;

-- Anything already recorded that the seed missed (a value added by hand at
-- some point) is adopted rather than left to break the foreign key below.
insert into public.timesheet_services (label, billable, ordinal)
select distinct t.service, true, 200 from public.time_entries t
 where t.service is not null
on conflict (label) do nothing;

insert into public.timesheet_services (label, billable, ordinal)
select distinct r.service, true, 200 from public.staff_service_rates r
 where r.service is not null
on conflict (label) do nothing;

alter table public.time_entries        drop constraint if exists time_entries_service_check;
alter table public.active_timers       drop constraint if exists active_timers_service_check;
alter table public.staff_service_rates drop constraint if exists staff_service_rates_service_check;

alter table public.time_entries
  add constraint time_entries_service_fkey foreign key (service)
  references public.timesheet_services(label) on update cascade on delete restrict;

alter table public.active_timers
  add constraint active_timers_service_fkey foreign key (service)
  references public.timesheet_services(label) on update cascade on delete restrict;

alter table public.staff_service_rates
  add constraint staff_service_rates_service_fkey foreign key (service)
  references public.timesheet_services(label) on update cascade on delete restrict;

alter table public.timesheet_services enable row level security;

-- Mirrors service_definitions, the closest existing thing: any active staff
-- member reads it (it fills the timesheet picker), supervisors and above edit
-- it. Note is_admin() here means "active staff", not "role = admin".
drop policy if exists "timesheet_services read"  on public.timesheet_services;
drop policy if exists "timesheet_services write" on public.timesheet_services;
create policy "timesheet_services read" on public.timesheet_services
  for select using (public.is_admin());
create policy "timesheet_services write" on public.timesheet_services
  for all
  using (public.is_supervisor_or_higher()) with check (public.is_supervisor_or_higher());

commit;

-- =============================================================
-- Verify:
--   select label, billable, ordinal, active from public.timesheet_services order by ordinal;
--   select conname from pg_constraint where conname like '%service_fkey';
-- =============================================================
-- End of migration 185.
-- =============================================================
