-- =============================================================
-- Migration 178: the push outbox and what fills it
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 177 recorded where to reach a device. This decides what to say
-- and makes sure it actually gets said.
--
--   * push_outbox — one row per notification owed to one person. Written by
--                   triggers and by the nightly sweep; drained by the
--                   send-push Edge Function.
--
-- WHY A QUEUE, and not a trigger that posts straight to Expo. A trigger firing
-- an HTTP call inside the transaction ties someone's message being saved to a
-- third party being up, and when the call fails the notification is simply
-- gone — no record, no retry, nothing to look at afterwards. A row in a table
-- survives all of that: it can be retried, counted, and read back when someone
-- asks why they were not told.
--
-- WHAT SENDS ONE. The handoff names three moments, and they are the only three
-- here — a notification nobody asked for is worse than none:
--   * the firm replies to your message
--   * the firm files a document to your account
--   * a filing deadline is a week out, then a day out
--
-- NEVER TWICE. dedupe_key is unique, so the nightly sweep can run every night
-- and re-enqueue nothing. A key names the event, not the moment it ran:
-- 'deadline:412:7' is the seven-day warning for task 412, whenever it fires.
--
-- WHO SEES IT. Nobody. RLS is on with no policy, so only the service role —
-- which the Edge Function uses and no user holds — can read or write it. The
-- rows contain message previews and are none of a client's business, let alone
-- another client's.
-- =============================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.push_outbox (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,

  title        text not null,
  body         text not null,
  -- Where tapping it should land, e.g. {"url": "/messages"}.
  data         jsonb not null default '{}'::jsonb,

  -- Names the event. Null means "always send" (nothing to collide with).
  dedupe_key   text unique,

  status       text not null default 'pending'
               check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts     integer not null default 0,
  last_error   text,

  -- [{ "token": "ExponentPushToken[…]", "id": "…" }] — filled at send time so
  -- the receipts pass knows which device each ticket belongs to.
  tickets      jsonb not null default '[]'::jsonb,
  receipts_checked_at timestamptz,

  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index if not exists push_outbox_pending_idx
  on public.push_outbox (created_at) where status = 'pending';
create index if not exists push_outbox_receipts_idx
  on public.push_outbox (sent_at) where status = 'sent' and receipts_checked_at is null;

alter table public.push_outbox enable row level security;
-- Deliberately no policies: service role only.

-- -------------------------------------------------------------
-- Claim a batch
-- -------------------------------------------------------------
-- SKIP LOCKED so two overlapping drains never send the same row twice — the
-- schedule is every minute and a slow run must not double up.
create or replace function public.claim_push_outbox(p_limit integer default 200)
returns setof public.push_outbox
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claimed as (
    select id from public.push_outbox
     where status = 'pending'
       -- Four failures is enough; something is wrong with the row, not the run.
       and attempts < 4
     order by created_at
     limit greatest(least(p_limit, 500), 1)
     for update skip locked
  )
  update public.push_outbox o
     set status = 'sending', attempts = o.attempts + 1
    from claimed c
   where o.id = c.id
  returning o.*;
end $$;
-- Revoking from PUBLIC takes it away from service_role too, so grant it back
-- explicitly. The Edge Function is the only caller.
revoke all on function public.claim_push_outbox(integer) from public, authenticated, anon;
grant   execute on function public.claim_push_outbox(integer) to service_role;

-- -------------------------------------------------------------
-- The firm replied to you
-- -------------------------------------------------------------
create or replace function public.tg_push_on_client_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_client_name text;
begin
  -- Only the firm's side of the conversation. A client does not need telling
  -- about their own message, and staff notifications are not built yet.
  if not new.author_is_staff then return new; end if;

  select name into v_client_name from public.clients where id = new.client_id;

  insert into public.push_outbox (user_id, title, body, data, dedupe_key)
  select uc.user_id,
         'Message from ' || coalesce(v_client_name, 'your accountant'),
         -- A preview, not the message: it lands on a lock screen.
         left(regexp_replace(new.body, '\s+', ' ', 'g'), 140),
         jsonb_build_object('url', '/messages', 'thread_id', new.thread_id),
         'msg:' || new.id || ':' || uc.user_id
    from public.user_clients uc
   where uc.client_id = new.client_id
     and uc.user_id is distinct from new.author_id
  on conflict (dedupe_key) do nothing;

  return new;
end $$;

drop trigger if exists push_on_client_message on public.client_messages;
create trigger push_on_client_message after insert on public.client_messages
  for each row execute function public.tg_push_on_client_message();

-- -------------------------------------------------------------
-- We filed something to your account
-- -------------------------------------------------------------
create or replace function public.tg_push_on_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if new.uploaded_by is null then return new; end if;

  -- Only when the firm added it. A client who just uploaded a receipt does
  -- not need a notification about their own upload.
  select role into v_role from public.profiles where id = new.uploaded_by;
  if v_role is null or v_role not in ('owner', 'supervisor', 'admin', 'staff') then
    return new;
  end if;

  -- Filing a quarter's paperwork is one action to the accountant doing it and
  -- would be twelve buzzes to the client receiving it. The key buckets by the
  -- hour, so a batch upload lands as one notification naming the first file;
  -- opening Documents shows the rest.
  insert into public.push_outbox (user_id, title, body, data, dedupe_key)
  select uc.user_id,
         'Document added to your file',
         new.file_name,
         jsonb_build_object('url', '/documents', 'document_id', new.id),
         'doc:' || uc.user_id || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24')
    from public.user_clients uc
   where uc.client_id = new.client_id
  on conflict (dedupe_key) do nothing;

  return new;
end $$;

drop trigger if exists push_on_document on public.documents;
create trigger push_on_document after insert on public.documents
  for each row execute function public.tg_push_on_document();

-- -------------------------------------------------------------
-- A deadline is coming
-- -------------------------------------------------------------
-- Two warnings: a week out, when there is still time to gather papers, and
-- the day before. Anything more is nagging.
create or replace function public.enqueue_deadline_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Europe/Nicosia')::date;
        v_count integer;
begin
  -- Cyprus deadlines cluster: VAT, payroll and social insurance often fall on
  -- the same date, and three separate buzzes at eight in the morning is how an
  -- app gets its notifications turned off. One per client per lead time, which
  -- names the filing when there is only one and counts them when there are
  -- more. Same lead means the same due date, so grouping on it is safe.
  with due as (
    select t.id, t.client_id, t.due_date,
           (t.due_date - v_today) as lead,
           coalesce(nullif(btrim(replace(t.kind, '_', ' ')), ''), 'A filing')
             || coalesce(' ' || t.period_label, '') as description
      from public.compliance_tasks t
     where t.status in ('pending', 'in_progress')
       and t.due_date - v_today in (7, 1)
  )
  insert into public.push_outbox (user_id, title, body, data, dedupe_key)
  select uc.user_id,
         case when d.lead = 1 then 'Due tomorrow' else 'Due in a week' end,
         case
           when count(*) > 1
             then count(*) || ' filings are due on ' || to_char(min(d.due_date), 'DD Mon')
           else initcap(min(d.description)) || ' is due on ' || to_char(min(d.due_date), 'DD Mon')
         end,
         jsonb_build_object('url', '/filings', 'lead_days', d.lead),
         'deadline:' || uc.user_id || ':' || d.lead || ':' || min(d.due_date)
    from due d
    join public.user_clients uc on uc.client_id = d.client_id
   group by uc.user_id, d.lead
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.enqueue_deadline_reminders() from public, authenticated, anon;
-- pg_cron runs it as the scheduling superuser; service_role is for running it
-- by hand to check what a night would produce.
grant   execute on function public.enqueue_deadline_reminders() to service_role;

-- -------------------------------------------------------------
-- Schedules
-- -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'send_push_url') then
    perform vault.create_secret(
      'https://ddwdrjhnfwpbtqzqgdsl.functions.supabase.co/send-push',
      'send_push_url',
      'Full URL of the send-push Edge Function (used by the pg_cron drain).'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'send_push_cron_secret') then
    perform vault.create_secret(
      'CHANGE_ME',
      'send_push_cron_secret',
      'Must equal the CRON_SECRET Edge Function secret. Update before relying on the schedule.'
    );
  end if;
end$$;

do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname in ('send-push', 'push-deadline-reminders') loop
    perform cron.unschedule(jid);
  end loop;
end$$;

-- Drain every minute. A reply that takes a minute to buzz is fine; one that
-- never arrives is not.
select cron.schedule(
  'send-push',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_url'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cron$
);

-- 08:00 Cyprus time. Runs in UTC, so 06:00 in summer — close enough for a
-- reminder, and not worth a timezone-aware scheduler to get exact.
select cron.schedule('push-deadline-reminders', '0 6 * * *', $cron$
  select public.enqueue_deadline_reminders();
$cron$);

commit;

-- =============================================================
-- ONE-TIME after deploying the function:
--
--   supabase functions deploy send-push --no-verify-jwt
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'send_push_cron_secret'),
--     'PASTE_THE_REAL_CRON_SECRET_HERE'
--   );
--
-- Verify:
--   select jobname, schedule, active from cron.job
--    where jobname in ('send-push', 'push-deadline-reminders');
--
--   select status, count(*) from public.push_outbox group by status;
--
--   select id, title, status, attempts, last_error, created_at
--     from public.push_outbox order by created_at desc limit 20;
--
-- To stop everything without un-deploying:
--   update cron.job set active = false where jobname = 'send-push';
-- =============================================================
