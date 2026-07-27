-- =============================================================
-- Migration 156: Account manager per client + scheduler auto-assign
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Each client gets a single responsible staff member (the "account
-- manager"). The service scheduler then stamps every task it generates
-- for that client with assigned_to = the account manager, so scheduled
-- compliance work lands in the right person's queue automatically
-- instead of arriving unassigned. Manual reassignment in the task list
-- still overrides it afterwards.
--
--   * clients.account_manager — uuid → auth.users(id).
--   * run_due_service_schedules rewritten to set assigned_to.
-- =============================================================

begin;

alter table public.clients
  add column if not exists account_manager uuid references auth.users(id) on delete set null;

create index if not exists clients_account_manager_idx
  on public.clients (account_manager)
  where account_manager is not null;

-- Rewrite the scheduler so generated tasks are assigned to the client's
-- account manager. Same signature + return type as migration 151, so a
-- plain CREATE OR REPLACE is safe (no DROP needed).
create or replace function public.run_due_service_schedules(
  p_run_date    date     default current_date,
  p_service_id  bigint   default null,
  p_client_ids  bigint[] default null
) returns table(created_runs int, created_tasks int)
language plpgsql security definer set search_path = public
as $$
declare
  v_runs int := 0;
  v_tasks int := 0;
  rec record;
  v_sched date;
  v_task_id bigint;
  v_year  int := extract(year  from p_run_date)::int;
  v_month int := extract(month from p_run_date)::int;
  v_active int[];
  v_duefirst date;
  v_dy int; v_dm int;
  v_pend date; v_pstart date;
  v_period text;
  v_title text;
begin
  -- pg_cron / service role (auth.uid() null) allowed; block ordinary users.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized';
  end if;

  for rec in
    select cs.id as client_service_id, cs.client_id, c.name as client_name,
           c.account_manager,
           sd.label as service_label,
           st.id as stage_id, st.label as stage_label, st.task_priority,
           st.creates_task, st.cadence, st.due_month_offset,
           coalesce(o.active_months, st.active_months) as active_months,
           coalesce(o.day_of_month,  st.default_day_of_month) as day_of_month,
           coalesce(o.use_last_day,  st.default_use_last_day) as use_last_day,
           coalesce(o.skip, false) as skip
    from public.client_services cs
    join public.clients c on c.id = cs.client_id
    join public.service_definitions sd on sd.id = cs.service_id
    join public.service_stages st on st.service_id = sd.id
    left join public.client_service_stage_overrides o
      on o.client_service_id = cs.id and o.service_stage_id = st.id
    where cs.enabled = true and sd.enabled = true and c.deleted_at is null
      and (p_service_id is null or sd.id = p_service_id)
      and (p_client_ids is null or c.id = any(p_client_ids))
  loop
    if rec.skip then continue; end if;

    v_active := rec.active_months;
    -- Fire only in an active month; monthly stages with no month list fire
    -- every month; quarterly/annual with no months configured never fire.
    if v_active is not null then
      if not (v_month = any(v_active)) then continue; end if;
    elsif rec.cadence <> 'monthly' then
      continue;
    end if;

    -- Due date = day-of-month of (fire month + due_month_offset).
    v_duefirst := (make_date(v_year, v_month, 1) + (rec.due_month_offset || ' months')::interval)::date;
    v_dy := extract(year  from v_duefirst)::int;
    v_dm := extract(month from v_duefirst)::int;
    v_sched := public.next_stage_date_in_month(v_dy, v_dm, rec.day_of_month::int, rec.use_last_day);
    if v_sched is null then continue; end if;

    -- One per period (scheduled_date is unique per stage occurrence).
    if exists (
      select 1 from public.service_runs
      where client_service_id = rec.client_service_id
        and service_stage_id  = rec.stage_id
        and scheduled_date    = v_sched
    ) then continue; end if;

    -- Human period label.
    if rec.cadence = 'quarterly' then
      v_pend   := (make_date(v_year, v_month, 1) - interval '1 month')::date;
      v_pstart := (v_pend - interval '2 months')::date;
      v_period := trim(to_char(v_pstart, 'Mon')) || '-' || trim(to_char(v_pend, 'Mon YYYY'));
    elsif rec.cadence = 'annual' then
      v_period := to_char((make_date(v_year, v_month, 1) - interval '1 month'), 'YYYY');
    else
      v_period := trim(to_char(make_date(v_year, v_month, 1), 'Mon YYYY'));
    end if;

    v_title := rec.stage_label || ' (' || v_period || ') - ' || rec.client_name;

    v_task_id := null;
    if rec.creates_task then
      insert into public.staff_tasks (
        title, client_id, assigned_to, due_date, priority, status, description, service_stage_id
      ) values (
        v_title, rec.client_id, rec.account_manager, v_sched, rec.task_priority, 'open',
        'Auto-created by the client-services scheduler for ' || v_period || '.',
        rec.stage_id
      ) returning id into v_task_id;
      v_tasks := v_tasks + 1;
    end if;

    insert into public.service_runs (
      client_service_id, service_stage_id, scheduled_date, fired_at, email_sent, task_id
    ) values (
      rec.client_service_id, rec.stage_id, v_sched, now(), false, v_task_id
    );
    v_runs := v_runs + 1;
  end loop;

  created_runs := v_runs;
  created_tasks := v_tasks;
  return next;
end$$;

revoke all on function public.run_due_service_schedules(date, bigint, bigint[]) from public;
grant execute on function public.run_due_service_schedules(date, bigint, bigint[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 156.
-- =============================================================
