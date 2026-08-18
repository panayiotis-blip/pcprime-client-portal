-- =============================================================
-- Migration 183: weekly supervisor digest
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The daily 07:00 job (migration 157) emails each person THEIR tasks. This
-- adds a second schedule against the same Edge Function, in supervisor mode:
-- everything overdue on the clients you supervise, whoever it is assigned to,
-- from staff_tasks.escalated_to (migration 182).
--
-- Monday 07:30, weekly. Weekly because a supervisor's job is to notice a
-- pattern, not to be told daily about the same late VAT return — a digest
-- nobody can bear to open supervises nothing. Half an hour after the daily
-- run so the two do not arrive together, and after the 05:00 escalation job
-- so the week's new arrivals are already stamped.
--
-- Reuses the task_reminders_url / task_reminders_cron_secret Vault entries
-- from 157: same function, same secret, different body.
--
-- ⚠ Redeploy the function first — the mode parameter is new:
--     supabase functions deploy task-reminders --no-verify-jwt
-- =============================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 157 created these. Fail loudly rather than scheduling a job that posts to
-- nowhere every Monday for a year.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'task_reminders_url') then
    raise exception 'Vault secret task_reminders_url is missing — run migration 157 first.';
  end if;
  if not exists (select 1 from vault.secrets where name = 'task_reminders_cron_secret') then
    raise exception 'Vault secret task_reminders_cron_secret is missing — run migration 157 first.';
  end if;
end$$;

do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'task-reminders-supervisor' loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule(
  'task-reminders-supervisor',
  '30 7 * * 1',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'task_reminders_url'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'task_reminders_cron_secret')
      ),
      body := '{"mode":"supervisor"}'::jsonb
    );
  $cron$
);

commit;

-- =============================================================
-- Verify:
--   select jobname, schedule, active from cron.job
--    where jobname in ('task-reminders','task-reminders-supervisor');
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'task-reminders-supervisor')
--    order by start_time desc limit 5;
--
-- Nothing will be sent until clients have a supervisor and overdue tasks
-- carry escalated_to (migration 182). Check there is something to send:
--   select count(*) from public.staff_tasks
--    where deleted_at is null and escalated_to is not null
--      and status in ('open','in_progress','blocked') and due_date < current_date;
-- =============================================================
