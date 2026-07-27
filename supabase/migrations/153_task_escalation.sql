-- =============================================================
-- Migration 153: Overdue-task escalation
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- When an allocated task passes its due date without being done, it is
-- flagged as escalated so supervisors are alerted (the assignee keeps it —
-- no auto-reassign, no auto-priority bump, per the firm's choice).
--
--   * staff_tasks.escalated_at — set once, when a still-open task first
--     goes past due.
--   * escalate_overdue_tasks() — daily pg_cron job that sets it.
-- =============================================================

begin;

alter table public.staff_tasks
  add column if not exists escalated_at timestamptz;

create or replace function public.escalate_overdue_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.staff_tasks
     set escalated_at = now()
   where escalated_at is null
     and deleted_at is null
     and status in ('open', 'in_progress', 'blocked')
     and due_date is not null
     and due_date < current_date;
  get diagnostics n = row_count;
  return n;
end$$;

revoke all on function public.escalate_overdue_tasks() from public;
grant execute on function public.escalate_overdue_tasks() to authenticated, service_role;

do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'escalate-overdue-tasks' loop
    perform cron.unschedule(jid);
  end loop;
end$$;
select cron.schedule('escalate-overdue-tasks', '0 5 * * *',
  $cron$ select public.escalate_overdue_tasks(); $cron$);

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 153.
-- =============================================================
