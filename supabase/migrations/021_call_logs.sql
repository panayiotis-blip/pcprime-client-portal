-- =============================================================
-- Migration 021: Call logs (typed notes per phone call)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A simple CRM-style log of phone calls. Phone messages that need
-- follow-up DON'T go here — they get captured as staff_tasks instead
-- (see the Log Message modal in the UI).
--
-- RLS: any internal-firm user reads + writes (firm-level visibility).
-- =============================================================

begin;

create table if not exists public.call_logs (
  id            bigserial primary key,
  client_id     bigint references public.clients(id) on delete set null,
  staff_id      uuid   references auth.users(id)   on delete set null,
  direction     text   not null check (direction in ('inbound', 'outbound')),
  contact_name  text,
  contact_phone text,
  call_at       timestamptz not null default now(),
  duration_min  int,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists call_logs_call_at_idx  on public.call_logs (call_at desc);
create index if not exists call_logs_client_idx   on public.call_logs (client_id) where client_id is not null;
create index if not exists call_logs_staff_idx    on public.call_logs (staff_id, call_at desc) where staff_id is not null;

drop trigger if exists call_logs_updated_at on public.call_logs;
create trigger call_logs_updated_at before update on public.call_logs
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_call_logs on public.call_logs;
create trigger tg_audit_call_logs
  after insert or update or delete on public.call_logs
  for each row execute function public.tg_audit();

alter table public.call_logs enable row level security;

drop policy if exists "call_logs read"  on public.call_logs;
drop policy if exists "call_logs write" on public.call_logs;

create policy "call_logs read" on public.call_logs
  for select using (public.is_admin());

create policy "call_logs write" on public.call_logs
  for all using (public.is_admin()) with check (public.is_admin());

commit;
-- =============================================================
-- End of migration 021.
-- =============================================================
