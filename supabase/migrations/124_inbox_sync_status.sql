-- =============================================================
-- Migration 124: Inbox sync health probe
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- email_sync_state (migration 114) is service-role-only (RLS on, no policies),
-- so staff can't read the poller's last-run / last-error directly. This
-- SECURITY DEFINER function exposes just those health fields (plus message
-- counts) to internal staff, so the Inbox page can show "last synced / last
-- error" and surface WHY mail isn't arriving — without granting table access.
--
-- Pairs with the in-app "Sync now" button, which invokes the poll-inbox Edge
-- Function directly (staff-JWT path) and then re-reads this status.
-- =============================================================

begin;

create or replace function public.get_inbox_sync_status(
  p_mailbox text default 'info@primeandcalculate.com'
)
returns table (
  mailbox            text,
  last_run_at        timestamptz,
  last_error         text,
  has_cursor         boolean,
  message_count      bigint,
  unread_count       bigint,
  latest_received_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  -- One row even when the poller has never run (left join from a 1-row anchor).
  -- Gated to internal staff: the WHERE yields zero rows for everyone else.
  select
    p_mailbox,
    s.last_run_at,
    s.last_error,
    (s.cursor is not null)                                            as has_cursor,
    (select count(*) from public.inbox_emails)                       as message_count,
    (select count(*) from public.inbox_emails where is_read = false) as unread_count,
    (select max(received_at) from public.inbox_emails)               as latest_received_at
  from (select 1) anchor
  left join public.email_sync_state s on s.mailbox = p_mailbox
  where public.is_admin();
$$;

revoke all on function public.get_inbox_sync_status(text) from public, anon;
grant   execute on function public.get_inbox_sync_status(text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- =============================================================
-- Verify (as a staff user, or via the dashboard which runs as service role):
--   select * from public.get_inbox_sync_status();
--   -- expect one row; last_run_at/last_error null until poll-inbox first runs.
-- =============================================================
