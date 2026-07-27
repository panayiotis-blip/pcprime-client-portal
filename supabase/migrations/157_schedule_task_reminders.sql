-- =============================================================
-- Migration 157: Schedule the daily task-reminder digests
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Runs the task-reminders Edge Function once a day (07:00) via pg_cron +
-- pg_net. It emails each staff member a digest of THEIR overdue + due-soon
-- tasks (recipients are staff only, never clients). The function
-- authenticates the call with the CRON_SECRET it expects as x-cron-secret.
--
-- The function URL + cron secret live in Vault (NOT in git). Set the real
-- secret once (see the bottom) after deploying the function.
--
-- ⚠ Deploy the function first, with gateway "Verify JWT" OFF:
--     supabase functions deploy task-reminders --no-verify-jwt
--   and make sure the CRON_SECRET function secret matches the value set below.
-- =============================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Vault placeholders (created once; values set below).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'task_reminders_url') then
    perform vault.create_secret(
      'https://ddwdrjhnfwpbtqzqgdsl.functions.supabase.co/task-reminders',
      'task_reminders_url',
      'Full URL of the task-reminders Edge Function (used by the pg_cron schedule).'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'task_reminders_cron_secret') then
    perform vault.create_secret(
      'CHANGE_ME',
      'task_reminders_cron_secret',
      'Must equal the CRON_SECRET Edge Function secret. Update before relying on the schedule.'
    );
  end if;
end$$;

-- Idempotent: drop any prior job.
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'task-reminders' loop
    perform cron.unschedule(jid);
  end loop;
end$$;

-- Daily at 07:00. URL + secret read from Vault at run time.
select cron.schedule(
  'task-reminders',
  '0 7 * * *',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'task_reminders_url'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'task_reminders_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cron$
);

commit;

-- =============================================================
-- ONE-TIME: set the real cron secret (same value as the function's CRON_SECRET).
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'task_reminders_cron_secret'),
--     'PASTE_THE_REAL_CRON_SECRET_HERE'
--   );
--
-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'task-reminders';
--   select status, return_message, start_time
--     from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'task-reminders')
--     order by start_time desc limit 5;
-- =============================================================
