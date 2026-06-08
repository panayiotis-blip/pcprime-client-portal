-- Migration 101: scheduler filters + preview RPC
-- ================================================
-- The original run_due_service_schedules fires every due stage for every
-- enabled client — too broad for day-to-day use. This migration:
--   • Adds optional service_id and client_ids[] filters to the run RPC so
--     the user can scope a run to e.g. "Payroll only" or "just one client".
--   • Adds preview_due_service_schedules that returns the rows that WOULD
--     fire without inserting anything — drives a confirm step in the UI.

-- -----------------------------------------------------------------
-- Extended run RPC (replaces 100's version)
-- -----------------------------------------------------------------
-- NULL filter values mean "all". When p_client_ids is provided as an
-- array, only those client_ids fire; everything else is skipped.
create or replace function public.run_due_service_schedules(
  p_run_date    date    default current_date,
  p_service_id  bigint  default null,
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
  v_year int := extract(year from p_run_date)::int;
  v_month int := extract(month from p_run_date)::int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  for rec in
    select cs.id as client_service_id, cs.client_id, c.name as client_name,
           st.id as stage_id, st.label as stage_label, st.task_priority,
           st.sends_email, st.creates_task, st.cadence, st.active_months,
           coalesce(o.day_of_month,  st.default_day_of_month)  as day_of_month,
           coalesce(o.use_last_day, st.default_use_last_day) as use_last_day,
           coalesce(o.skip, false) as skip
    from public.client_services cs
    join public.clients c on c.id = cs.client_id
    join public.service_definitions sd on sd.id = cs.service_id
    join public.service_stages st on st.service_id = sd.id
    left join public.client_service_stage_overrides o
      on o.client_service_id = cs.id and o.service_stage_id = st.id
    where cs.enabled = true
      and sd.enabled = true
      and c.deleted_at is null
      and (p_service_id is null or sd.id = p_service_id)
      and (p_client_ids is null or c.id = any(p_client_ids))
  loop
    if rec.skip then continue; end if;
    if rec.active_months is not null and not (v_month = any(rec.active_months)) then
      continue;
    end if;
    if rec.cadence <> 'monthly' and rec.active_months is null then
      continue;
    end if;

    v_sched := public.next_stage_date_in_month(v_year, v_month, rec.day_of_month::int, rec.use_last_day);
    if v_sched is null or v_sched > p_run_date then continue; end if;

    if exists (
      select 1 from public.service_runs
      where client_service_id = rec.client_service_id
        and service_stage_id  = rec.stage_id
        and scheduled_date    = v_sched
    ) then continue; end if;

    v_task_id := null;
    if rec.creates_task then
      insert into public.staff_tasks (title, client_id, due_date, priority, status, description)
      values (
        rec.stage_label || ' — ' || rec.client_name,
        rec.client_id, v_sched, rec.task_priority, 'open',
        'Auto-created by client services scheduler.'
      )
      returning id into v_task_id;
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
grant execute on function public.run_due_service_schedules(date, bigint, bigint[]) to authenticated;

-- -----------------------------------------------------------------
-- preview_due_service_schedules — same logic, returns rows instead
-- of inserting. The UI uses this to show "here's what will fire".
-- -----------------------------------------------------------------
create or replace function public.preview_due_service_schedules(
  p_run_date    date    default current_date,
  p_service_id  bigint  default null,
  p_client_ids  bigint[] default null
) returns table(
  client_id bigint,
  client_name text,
  service_label text,
  stage_label text,
  scheduled_date date,
  would_send_email boolean,
  would_create_task boolean,
  already_fired boolean
)
language plpgsql security definer set search_path = public
stable
as $$
declare
  rec record;
  v_sched date;
  v_year int := extract(year from p_run_date)::int;
  v_month int := extract(month from p_run_date)::int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  for rec in
    select cs.id as client_service_id, cs.client_id, c.name as cname,
           sd.label as service_label_,
           st.id as stage_id, st.label as stage_label_,
           st.sends_email, st.creates_task, st.cadence, st.active_months,
           coalesce(o.day_of_month,  st.default_day_of_month)  as day_of_month,
           coalesce(o.use_last_day, st.default_use_last_day) as use_last_day,
           coalesce(o.skip, false) as skip
    from public.client_services cs
    join public.clients c on c.id = cs.client_id
    join public.service_definitions sd on sd.id = cs.service_id
    join public.service_stages st on st.service_id = sd.id
    left join public.client_service_stage_overrides o
      on o.client_service_id = cs.id and o.service_stage_id = st.id
    where cs.enabled = true
      and sd.enabled = true
      and c.deleted_at is null
      and (p_service_id is null or sd.id = p_service_id)
      and (p_client_ids is null or c.id = any(p_client_ids))
    order by sd.ordinal, st.ordinal, c.name
  loop
    if rec.skip then continue; end if;
    if rec.active_months is not null and not (v_month = any(rec.active_months)) then
      continue;
    end if;
    if rec.cadence <> 'monthly' and rec.active_months is null then
      continue;
    end if;

    v_sched := public.next_stage_date_in_month(v_year, v_month, rec.day_of_month::int, rec.use_last_day);
    if v_sched is null or v_sched > p_run_date then continue; end if;

    client_id := rec.client_id;
    client_name := rec.cname;
    service_label := rec.service_label_;
    stage_label := rec.stage_label_;
    scheduled_date := v_sched;
    would_send_email := rec.sends_email;
    would_create_task := rec.creates_task;
    already_fired := exists (
      select 1 from public.service_runs
      where client_service_id = rec.client_service_id
        and service_stage_id  = rec.stage_id
        and scheduled_date    = v_sched
    );
    return next;
  end loop;
end$$;

revoke all on function public.preview_due_service_schedules(date, bigint, bigint[]) from public;
grant execute on function public.preview_due_service_schedules(date, bigint, bigint[]) to authenticated;
