-- =============================================================
-- Phase 4: Compliance tasks (VAT, etc.)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================

-- -------------------------------------------------------------
-- 1. VAT registration fields on clients
-- -------------------------------------------------------------
alter table public.clients
  add column if not exists vat_registered boolean not null default false;

alter table public.clients
  add column if not exists vat_period_group smallint;

-- Cyprus VAT has three period groups based on quarter start month:
--   1 = Jan/Apr/Jul/Oct  (calendar quarters)
--   2 = Feb/May/Aug/Nov
--   3 = Mar/Jun/Sep/Dec
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_vat_period_group_chk'
  ) then
    alter table public.clients
      add constraint clients_vat_period_group_chk
      check (vat_period_group is null or vat_period_group in (1, 2, 3));
  end if;
end $$;

-- -------------------------------------------------------------
-- 2. compliance_tasks
-- -------------------------------------------------------------
create table if not exists public.compliance_tasks (
  id              bigserial primary key,
  client_id       bigint not null references public.clients(id) on delete cascade,
  kind            text   not null,                  -- 'vat_quarterly' for now; extensible
  period_label    text,                             -- e.g. 'Q1 2026 (Jan–Mar)' for display
  period_start    date   not null,
  period_end      date   not null,
  due_date        date   not null,
  status          text   not null default 'pending'
                  check (status in ('pending','in_progress','completed','cancelled')),
  completed_at    date,
  submitted_at    date,
  reference       text,                             -- submission reference / receipt no.
  notes           text,
  assigned_to     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, kind, period_start)
);

create index if not exists compliance_tasks_due_idx        on public.compliance_tasks (due_date);
create index if not exists compliance_tasks_status_due_idx on public.compliance_tasks (status, due_date);
create index if not exists compliance_tasks_client_due_idx on public.compliance_tasks (client_id, due_date);

drop trigger if exists compliance_tasks_updated_at on public.compliance_tasks;
create trigger compliance_tasks_updated_at before update on public.compliance_tasks
  for each row execute function public.tg_set_updated_at();

-- -------------------------------------------------------------
-- 3. RLS — admin sees/edits all; linked-client users can read their own
-- -------------------------------------------------------------
alter table public.compliance_tasks enable row level security;

drop policy if exists "compliance_tasks read linked or admin" on public.compliance_tasks;
create policy "compliance_tasks read linked or admin" on public.compliance_tasks
  for select using (public.user_can_access_client(client_id));

drop policy if exists "compliance_tasks admin write" on public.compliance_tasks;
create policy "compliance_tasks admin write" on public.compliance_tasks
  for all using (public.is_admin()) with check (public.is_admin());
