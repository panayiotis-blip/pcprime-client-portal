-- =============================================================
-- Migration 047: Timesheet — non-billable services, approval, billing
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Three threads of changes, all on time_entries:
--
-- 1. Non-billable / internal services
--    Expand the service CHECK constraint to include internal categories
--    (Internal Admin, Training, Annual Leave, Sick Leave, Public Holiday,
--    Other Internal). When a non-billable service is picked, billable is
--    forced false and rate_snapshot is cleared by a BEFORE trigger.
--
-- 2. Supervisor approval lock
--    Adds approval_status ('draft' | 'approved'), approved_by, approved_at.
--    RLS UPDATE/DELETE policy is replaced: regular admin can modify draft
--    rows; once approved, only the approver or an owner can modify.
--    approve_time_entries() / unlock_time_entries() RPCs (owner+supervisor).
--
-- 3. Billing decisions
--    Adds billing_status ('unbilled' | 'written_off' | 'deferred' | 'invoiced'),
--    write_off_reason, invoice_id (nullable, FK added in phase-2 migration).
--    set_billing_status() RPC for bulk actions from the client Time tab.
-- =============================================================

begin;

-- ---------- 1. Expand the service picklist ----------
-- The CHECK constraints on time_entries.service and active_timers.service
-- were declared inline so Postgres named them automatically. We look the
-- names up dynamically before dropping.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.time_entries'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%service%in%bookkeeping%'
  loop
    execute 'alter table public.time_entries drop constraint ' || quote_ident(v_name);
  end loop;

  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.active_timers'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%service%in%bookkeeping%'
  loop
    execute 'alter table public.active_timers drop constraint ' || quote_ident(v_name);
  end loop;
end $$;

alter table public.time_entries
  add constraint time_entries_service_check check (service in (
    -- Billable
    'Bookkeeping','VAT','Payroll','Audit','Tax Returns','Company Admin','Meetings','Other',
    -- Non-billable / internal
    'Internal Admin','Training','Annual Leave','Sick Leave','Public Holiday','Other Internal'
  ));

alter table public.active_timers
  add constraint active_timers_service_check check (service is null or service in (
    'Bookkeeping','VAT','Payroll','Audit','Tax Returns','Company Admin','Meetings','Other',
    'Internal Admin','Training','Annual Leave','Sick Leave','Public Holiday','Other Internal'
  ));

-- Helper used by triggers + UI logic (kept simple and inlinable)
create or replace function public.is_billable_service(p_service text)
returns boolean
language sql
immutable
as $$
  select p_service in (
    'Bookkeeping','VAT','Payroll','Audit','Tax Returns','Company Admin','Meetings','Other'
  );
$$;

-- ---------- 2. New columns on time_entries ----------
alter table public.time_entries
  add column if not exists approval_status  text        not null default 'draft'
    check (approval_status in ('draft','approved')),
  add column if not exists approved_by      uuid        references auth.users(id) on delete set null,
  add column if not exists approved_at      timestamptz,
  add column if not exists billing_status   text        not null default 'unbilled'
    check (billing_status in ('unbilled','written_off','deferred','invoiced')),
  add column if not exists write_off_reason text,
  add column if not exists invoice_id       bigint;  -- FK added in migration 048 once client_invoices exists

create index if not exists time_entries_approval_idx
  on public.time_entries (approval_status, user_id);
create index if not exists time_entries_billing_idx
  on public.time_entries (client_id, billing_status)
  where client_id is not null;

-- ---------- 3. Force billable=false for non-billable services ----------
-- Replaces the migration-045/046 rate-snapshot trigger function. Same
-- name + binding so the existing trigger still fires; we just enrich its
-- behaviour to also normalise billable/rate for non-billable services.
create or replace function public.tg_time_entries_snapshot_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate    numeric(10,2);
  v_default jsonb;
begin
  -- Non-billable services: force billable=false and skip rate lookup
  if not public.is_billable_service(new.service) then
    new.billable      := false;
    new.rate_snapshot := null;
    return new;
  end if;

  if new.rate_snapshot is not null then
    return new;
  end if;

  -- 1. staff-specific override for this service
  select rate into v_rate
    from public.staff_service_rates
   where user_id = new.user_id and service = new.service;

  -- 2. company default for this service
  if v_rate is null then
    select default_service_rates into v_default
      from public.company_settings where id = 1;
    if v_default is not null and v_default ? new.service then
      v_rate := nullif(v_default->>new.service, '')::numeric(10,2);
    end if;
  end if;

  -- 3. staff flat rate
  if v_rate is null then
    select hourly_rate into v_rate
      from public.profiles where id = new.user_id;
  end if;

  new.rate_snapshot := v_rate;
  return new;
end $$;

-- ---------- 4. RLS — approval lock ----------
-- Drop the catch-all write policy and split into INSERT / UPDATE / DELETE
-- so we can gate UPDATE+DELETE on the approval_status.
drop policy if exists "time_entries write"  on public.time_entries;
drop policy if exists "time_entries insert" on public.time_entries;
drop policy if exists "time_entries update" on public.time_entries;
drop policy if exists "time_entries delete" on public.time_entries;

create policy "time_entries insert" on public.time_entries
  for insert with check (public.is_admin());

-- UPDATE: any internal-firm user can modify a DRAFT row. Once approved,
-- only the approver themselves, or an owner, can modify.
create policy "time_entries update" on public.time_entries
  for update using (
    public.is_admin() and (
      approval_status = 'draft'
      or approved_by = auth.uid()
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')
    )
  )
  with check (
    public.is_admin() and (
      approval_status = 'draft'
      or approved_by = auth.uid()
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')
    )
  );

-- DELETE: same gate as UPDATE
create policy "time_entries delete" on public.time_entries
  for delete using (
    public.is_admin() and (
      approval_status = 'draft'
      or approved_by = auth.uid()
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')
    )
  );

-- ---------- 5. Approval RPCs (owner + supervisor only) ----------
create or replace function public.approve_time_entries(p_ids bigint[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role    text;
  v_count   int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user_id;
  if v_role not in ('owner','supervisor') then
    raise exception 'Only owners and supervisors can approve timesheets';
  end if;

  update public.time_entries
     set approval_status = 'approved',
         approved_by     = v_user_id,
         approved_at     = now()
   where id = any(p_ids)
     and approval_status = 'draft';
  get diagnostics v_count = row_count;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_user_id, 'time_entries.approve', 'time_entries', null,
          jsonb_build_object('approved', v_count, 'requested', array_length(p_ids, 1)));

  return v_count;
end $$;

revoke all on function public.approve_time_entries(bigint[]) from public;
grant   execute on function public.approve_time_entries(bigint[]) to authenticated;

create or replace function public.unlock_time_entries(p_ids bigint[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role    text;
  v_count   int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_user_id;
  if v_role not in ('owner','supervisor') then
    raise exception 'Only owners and supervisors can unlock timesheets';
  end if;

  update public.time_entries
     set approval_status = 'draft',
         approved_by     = null,
         approved_at     = null
   where id = any(p_ids)
     and approval_status = 'approved';
  get diagnostics v_count = row_count;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_user_id, 'time_entries.unlock', 'time_entries', null,
          jsonb_build_object('unlocked', v_count, 'requested', array_length(p_ids, 1)));

  return v_count;
end $$;

revoke all on function public.unlock_time_entries(bigint[]) from public;
grant   execute on function public.unlock_time_entries(bigint[]) to authenticated;

-- ---------- 6. Billing-status RPC (bulk write-off / defer / ready) ----------
create or replace function public.set_time_entries_billing_status(
  p_ids    bigint[],
  p_status text,
  p_reason text default null
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count   int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  -- Only allow staff-level users to change billing decisions
  if not exists (select 1 from public.profiles
                  where id = v_user_id
                    and role in ('owner','supervisor','admin','staff')) then
    raise exception 'Staff only';
  end if;
  if p_status not in ('unbilled','written_off','deferred','invoiced') then
    raise exception 'Invalid billing status: %', p_status;
  end if;
  -- 'invoiced' is set by the invoicing flow, not manually
  if p_status = 'invoiced' then
    raise exception 'Use the invoicing flow to mark entries as invoiced';
  end if;

  update public.time_entries
     set billing_status   = p_status,
         write_off_reason = case when p_status = 'written_off' then p_reason else write_off_reason end
   where id = any(p_ids)
     -- Don't touch entries already pinned to an invoice
     and billing_status <> 'invoiced'
     and invoice_id is null;
  get diagnostics v_count = row_count;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_user_id, 'time_entries.set_billing_status', 'time_entries', null,
          jsonb_build_object('status', p_status, 'updated', v_count,
                             'requested', array_length(p_ids, 1)));

  return v_count;
end $$;

revoke all on function public.set_time_entries_billing_status(bigint[], text, text) from public;
grant   execute on function public.set_time_entries_billing_status(bigint[], text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 047.
-- =============================================================
