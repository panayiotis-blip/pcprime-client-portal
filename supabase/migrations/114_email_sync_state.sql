-- 114_email_sync_state.sql
-- Cursor table for the Gmail-API inbound poller (Edge Function `poll-gmail`).
-- Holds one row per capture mailbox with the Gmail `historyId` high-watermark,
-- so each poll only fetches changes since the last successful run.
--
-- Written ONLY by the poll-gmail Edge Function via the service role (which
-- bypasses RLS). No authenticated/anon access is required or granted: RLS is
-- enabled with no policies, so the table is invisible to the app's API roles.

begin;

create table if not exists public.email_sync_state (
  mailbox     text primary key,            -- e.g. 'capture@primeandcalculate.com'
  cursor      text,                        -- Gmail historyId high-watermark
  last_run_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.email_sync_state is
  'Gmail inbound poller cursor (historyId per capture mailbox). Written only by the poll-gmail Edge Function (service_role). RLS on with no policies => no app access.';

-- Lock the table down to service_role only. Enabling RLS without any policy
-- means authenticated and anon callers get zero rows / cannot write; the
-- service role used by the Edge Function bypasses RLS entirely.
alter table public.email_sync_state enable row level security;

commit;

-- =============================================================
-- Verify:
--   select * from public.email_sync_state;            -- empty until first poll
--   select relrowsecurity from pg_class
--     where oid = 'public.email_sync_state'::regclass; -- expect: t
-- =============================================================
