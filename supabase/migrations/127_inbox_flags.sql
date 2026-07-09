-- =============================================================
-- Migration 127: Inbox flag / urgent markers
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Two local status flags on shared-inbox messages, managed in the portal
-- (NOT synced from Gmail): a follow-up flag and an urgent marker. poll-inbox
-- only inserts new rows (never updates existing ones) and inbox-action only
-- touches label_ids/is_read, so these columns are safe across re-syncs.
-- Staff already have UPDATE on inbox_emails (that's how read/unread works).
-- =============================================================

begin;

alter table public.inbox_emails
  add column if not exists flagged   boolean not null default false,
  add column if not exists is_urgent boolean not null default false;

create index if not exists inbox_emails_flagged_idx on public.inbox_emails (flagged)   where flagged;
create index if not exists inbox_emails_urgent_idx  on public.inbox_emails (is_urgent) where is_urgent;

notify pgrst, 'reload schema';

commit;
