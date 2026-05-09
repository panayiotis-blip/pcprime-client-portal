-- =============================================================
-- Migration 010: Staff Tasks
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A general-purpose to-do list for the firm's internal users.
-- Distinct from public.compliance_tasks (which is for regulatory
-- deadlines like VAT, SI, IR7).
--
-- RLS: any internal-firm role (owner / supervisor / admin / staff)
-- can read and write any task. Client role users see nothing.
--
-- Wrapped in a transaction; rolls back atomically on failure.
-- =============================================================

begin;

create table if not exists public.staff_tasks (
  id           bigserial primary key,
  title        text not null,
  description  text,
  client_id    bigint references public.clients(id) on delete set null,
  assigned_to  uuid   references auth.users(id)    on delete set null,
  created_by   uuid   references auth.users(id)    on delete set null,
  due_date     date,
  priority     text not null default 'medium'
                check (priority in ('low','medium','high','urgent')),
  status       text not null default 'open'
                check (status in ('open','in_progress','blocked','done','cancelled')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists staff_tasks_assigned_idx
  on public.staff_tasks (assigned_to, status);
create index if not exists staff_tasks_due_open_idx
  on public.staff_tasks (due_date)
  where status not in ('done', 'cancelled');
create index if not exists staff_tasks_client_idx
  on public.staff_tasks (client_id)
  where client_id is not null;

-- updated_at trigger
drop trigger if exists staff_tasks_updated_at on public.staff_tasks;
create trigger staff_tasks_updated_at before update on public.staff_tasks
  for each row execute function public.tg_set_updated_at();

-- Audit trigger (uses tg_audit from migration 007)
drop trigger if exists tg_audit_staff_tasks on public.staff_tasks;
create trigger tg_audit_staff_tasks
  after insert or update or delete on public.staff_tasks
  for each row execute function public.tg_audit();

-- RLS
alter table public.staff_tasks enable row level security;

drop policy if exists "staff_tasks read"  on public.staff_tasks;
drop policy if exists "staff_tasks write" on public.staff_tasks;

create policy "staff_tasks read" on public.staff_tasks
  for select using (public.is_admin());

create policy "staff_tasks write" on public.staff_tasks
  for all using (public.is_admin()) with check (public.is_admin());

commit;
-- =============================================================
-- End of migration 010.
-- =============================================================
