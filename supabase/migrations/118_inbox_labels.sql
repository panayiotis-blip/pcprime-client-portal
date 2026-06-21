-- 118_inbox_labels.sql
-- The shared inbox now mirrors the WHOLE info@ mailbox (Inbox, Sent, Spam,
-- Trash, …), not just received mail. Record each message's Gmail labels so the
-- UI can show and filter by folder.
alter table public.inbox_emails
  add column if not exists label_ids text[] default '{}'::text[];
