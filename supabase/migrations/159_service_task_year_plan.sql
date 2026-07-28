-- =============================================================
-- Migration 159: Year plan — expected service-task periods (read-only)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The yearly completion grid used to show only staff_tasks that had
-- already been generated, so past/future periods were blank until someone
-- ran a backfill. This function COMPUTES every period a client's enabled
-- services are expected to fire in a given year — using the SAME fire
-- logic as run_due_service_schedules (migration 156) — and LEFT JOINs any
-- task that already exists for that period. Nothing is written.
--
-- Each row = one expected (client, service, stage, period):
--   * task_id / status / completion_data are NULL when the task hasn't
--     been generated yet (the grid shows it as "not generated").
--   * fire_month + service_id let the grid generate that one period on
--     demand (calls run_due_service_schedules scoped to that client/month).
-- =============================================================

begin;

create or replace function public.service_task_year_plan(p_year int)
returns table(
  client_id bigint, client_name text, client_code text,
  service_id bigint, service_key text, service_label text,
  stage_id bigint, stage_label text,
  fire_month int, scheduled_date date, period_label text,
  task_id bigint, status text, completion_data jsonb
)
language plpgsql security definer set search_path = public
as $$
declare
  rec record;
  m int;
  v_active int[];
  v_duefirst date; v_dy int; v_dm int;
  v_sched date;
  v_pend date; v_pstart date;
begin
  -- pg_cron / service role (auth.uid() null) allowed; block ordinary users.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not authorized';
  end if;

  for rec in
    select cs.id as client_service_id, cs.client_id as c_id,
           c.name as c_name, c.client_code as c_code,
           sd.id as s_id, sd.key as s_key, sd.label as s_label,
           st.id as st_id, st.label as st_label,
           st.cadence, st.due_month_offset,
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
      and st.creates_task = true
  loop
    if rec.skip then continue; end if;
    v_active := rec.active_months;

    for m in 1..12 loop
      -- Same fire gate as the scheduler.
      if v_active is not null then
        if not (m = any(v_active)) then continue; end if;
      elsif rec.cadence <> 'monthly' then
        continue;
      end if;

      -- Due date = day-of-month of (fire month + offset).
      v_duefirst := (make_date(p_year, m, 1) + (rec.due_month_offset || ' months')::interval)::date;
      v_dy := extract(year  from v_duefirst)::int;
      v_dm := extract(month from v_duefirst)::int;
      v_sched := public.next_stage_date_in_month(v_dy, v_dm, rec.day_of_month::int, rec.use_last_day);
      if v_sched is null then continue; end if;

      -- Period label (identical to the scheduler).
      if rec.cadence = 'quarterly' then
        v_pend   := (make_date(p_year, m, 1) - interval '1 month')::date;
        v_pstart := (v_pend - interval '2 months')::date;
        period_label := trim(to_char(v_pstart, 'Mon')) || '-' || trim(to_char(v_pend, 'Mon YYYY'));
      elsif rec.cadence = 'annual' then
        period_label := to_char((make_date(p_year, m, 1) - interval '1 month'), 'YYYY');
      else
        period_label := trim(to_char(make_date(p_year, m, 1), 'Mon YYYY'));
      end if;

      client_id := rec.c_id; client_name := rec.c_name; client_code := rec.c_code;
      service_id := rec.s_id; service_key := rec.s_key; service_label := rec.s_label;
      stage_id := rec.st_id; stage_label := rec.st_label;
      fire_month := m; scheduled_date := v_sched;

      -- Existing task for this period (via the service_runs occurrence).
      task_id := null; status := null; completion_data := null;
      select sr.task_id into task_id
        from public.service_runs sr
        where sr.client_service_id = rec.client_service_id
          and sr.service_stage_id  = rec.st_id
          and sr.scheduled_date    = v_sched
        limit 1;
      if task_id is not null then
        select stk.status, stk.completion_data into status, completion_data
          from public.staff_tasks stk where stk.id = task_id and stk.deleted_at is null;
        -- Task row was deleted → treat as not generated.
        if status is null then task_id := null; end if;
      end if;

      return next;
    end loop;
  end loop;
end$$;

revoke all on function public.service_task_year_plan(int) from public;
grant execute on function public.service_task_year_plan(int) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify (expected periods for 2026, first 20):
--   select client_name, service_label, stage_label, period_label,
--          scheduled_date, task_id, status
--   from public.service_task_year_plan(2026)
--   order by scheduled_date limit 20;
-- =============================================================
-- End of migration 159.
-- =============================================================
