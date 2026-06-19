-- =============================================================
-- Migration 116: Shared team inbox (info@primeandcalculate.com)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A staff-wide view of the firm's general mailbox. The poll-inbox Edge
-- Function reads info@ via the Gmail API (read-only) and writes every INBOX
-- message here so the whole team can see incoming mail inside the portal
-- (replies still happen in Outlook). Service role writes; staff read.
--
-- Cursor/high-watermark lives in public.email_sync_state (migration 114),
-- keyed by mailbox = 'info@primeandcalculate.com'. No change needed here.
-- =============================================================

begin;

-- ---- 1. Messages ----
create table if not exists public.inbox_emails (
  id                bigserial primary key,
  gmail_message_id  text not null unique,          -- Gmail message id (dedup)
  gmail_thread_id   text,
  from_email        text,
  from_name         text,
  to_emails         text[] default '{}'::text[],
  cc_emails         text[] default '{}'::text[],
  subject           text,
  snippet           text,                          -- short preview (Gmail snippet)
  body_html         text,
  body_plain        text,
  received_at       timestamptz not null default now(),
  has_attachments   boolean not null default false,
  is_read           boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists inbox_emails_received_idx
  on public.inbox_emails (received_at desc);

comment on table public.inbox_emails is
  'Shared firm inbox (info@). Written only by the poll-inbox Edge Function (service_role). Staff read; replies happen in Outlook, not here.';

-- ---- 2. Attachments ----
create table if not exists public.inbox_email_attachments (
  id           bigserial primary key,
  email_id     bigint not null references public.inbox_emails(id) on delete cascade,
  filename     text not null,
  mime_type    text,
  size_bytes   int,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create index if not exists inbox_email_attachments_email_idx
  on public.inbox_email_attachments (email_id);

-- ---- 3. RLS — staff read; only is_read is updatable by staff; no insert/delete ----
alter table public.inbox_emails enable row level security;
alter table public.inbox_email_attachments enable row level security;

-- Reusable staff predicate (inlined, matching the project's existing pattern).
drop policy if exists "inbox_emails staff read" on public.inbox_emails;
create policy "inbox_emails staff read" on public.inbox_emails
  for select to authenticated using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('owner','supervisor','admin','staff'))
  );

-- Staff may flag messages read/unread (the app only ever toggles is_read).
drop policy if exists "inbox_emails staff update" on public.inbox_emails;
create policy "inbox_emails staff update" on public.inbox_emails
  for update to authenticated using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('owner','supervisor','admin','staff'))
  ) with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('owner','supervisor','admin','staff'))
  );

-- No INSERT/DELETE for authenticated; service_role bypasses RLS.
drop policy if exists "inbox_emails no insert" on public.inbox_emails;
create policy "inbox_emails no insert" on public.inbox_emails
  for insert to authenticated with check (false);

drop policy if exists "inbox_email_attachments staff read" on public.inbox_email_attachments;
create policy "inbox_email_attachments staff read" on public.inbox_email_attachments
  for select to authenticated using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('owner','supervisor','admin','staff'))
  );

drop policy if exists "inbox_email_attachments no insert" on public.inbox_email_attachments;
create policy "inbox_email_attachments no insert" on public.inbox_email_attachments
  for insert to authenticated with check (false);

-- ---- 4. Storage bucket: inbox-attachments (private, staff read) ----
insert into storage.buckets (id, name, public)
values ('inbox-attachments', 'inbox-attachments', false)
on conflict (id) do nothing;

drop policy if exists "inbox-attachments staff read"  on storage.objects;
drop policy if exists "inbox-attachments no write"    on storage.objects;

create policy "inbox-attachments staff read"
  on storage.objects for select to authenticated using (
    bucket_id = 'inbox-attachments'
    and exists (select 1 from public.profiles p
                where p.id = auth.uid() and p.role in ('owner','supervisor','admin','staff'))
  );

-- INSERT/UPDATE/DELETE blocked for authenticated; only service_role writes.
create policy "inbox-attachments no write"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'inbox-attachments' and false
  );

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select count(*) from public.inbox_emails;                 -- 0 until first poll
--   select id, name, public from storage.buckets where id = 'inbox-attachments';
-- =============================================================
