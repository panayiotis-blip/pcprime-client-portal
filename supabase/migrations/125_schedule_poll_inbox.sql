-- =============================================================
-- Migration 125: Schedule the shared-inbox poller (poll-inbox)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Runs the poll-inbox Edge Function every 5 minutes via pg_cron + pg_net, so
-- info@ mail lands in the portal automatically (the "Sync now" button stays as
-- a manual nudge). poll-inbox authenticates the call with the CRON_SECRET it
-- already expects as the `x-cron-secret` header.
--
-- The function URL and the cron secret are kept in Vault (NOT in this file /
-- git). The cron job reads them at run time. After running this migration,
-- set the two real values once (see the two update statements at the bottom).
--
-- ⚠ ONE poller per mailbox: poll-inbox and the dormant per-client poll-gmail
--   share the email_sync_state cursor + GOOGLE_*/GMAIL_ADDRESS secrets. This
--   migration unschedules any prior poll-gmail / poll-inbox jobs first, then
--   schedules ONLY poll-inbox. Do not also schedule poll-gmail for info@.
-- =============================================================

begin;

-- 1. Extensions (pg_cron is already used by earlier migrations; pg_net = HTTP).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Vault placeholders for the URL + cron secret (created once; values set
--    below). Using Vault keeps real secrets out of the committed SQL.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'poll_inbox_url') then
    perform vault.create_secret(
      'https://ddwdrjhnfwpbtqzqgdsl.functions.supabase.co/poll-inbox',
      'poll_inbox_url',
      'Full URL of the poll-inbox Edge Function (used by the pg_cron schedule).'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'poll_inbox_cron_secret') then
    perform vault.create_secret(
      'CHANGE_ME',
      'poll_inbox_cron_secret',
      'Must equal the CRON_SECRET Edge Function secret. Update before relying on the schedule.'
    );
  end if;
end$$;

-- 3. Remove any existing inbox-poller jobs (idempotent re-run + cursor-conflict guard).
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname in ('poll-inbox', 'poll-gmail') loop
    perform cron.unschedule(jid);
  end loop;
end$$;

-- 4. Schedule poll-inbox every 5 minutes. URL + secret are read from Vault at
--    run time, so rotating either only needs a vault.update_secret (no reschedule).
select cron.schedule(
  'poll-inbox',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'poll_inbox_url'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'poll_inbox_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cron$
);

commit;

-- =============================================================
-- ONE-TIME: set the real secret value (the URL default above already points at
-- project ddwdrjhnfwpbtqzqgdsl — change it too if that ever differs).
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'poll_inbox_cron_secret'),
--     'PASTE_THE_REAL_CRON_SECRET_HERE'
--   );
--
-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'poll-inbox';
--   -- recent run outcomes:
--   select status, return_message, start_time
--     from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'poll-inbox')
--     order by start_time desc limit 5;
--   -- then in the app: Inbox → "Last synced …" should advance every ~5 min.
-- =============================================================
