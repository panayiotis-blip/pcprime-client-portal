-- Migration 111: Client notes feed
-- =================================
-- The single big notes textarea on clients is replaced (in the UI) by a
-- timestamped feed: each note its own row with author, time, and
-- optional 'needs attention' flag. A note can be promoted to a staff
-- task; the task remembers which note it came from via source_note_id.
--
-- The legacy clients.notes column stays put so older data and other
-- views that read it (smart import, list exports) keep working.

create table if not exists public.client_notes (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  body text not null,
  -- Flags for the feed UI
  pinned boolean not null default false,
  needs_attention boolean not null default false,
  -- Audit metadata
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  -- Soft delete so accidental removes are recoverable (supervisor-only).
  deleted_at timestamptz
);

create index if not exists client_notes_client_idx
  on public.client_notes (client_id, created_at desc)
  where deleted_at is null;

create index if not exists client_notes_attention_idx
  on public.client_notes (client_id)
  where needs_attention = true and deleted_at is null;

-- updated_at trigger
drop trigger if exists client_notes_updated_at on public.client_notes;
create trigger client_notes_updated_at before update on public.client_notes
  for each row execute function public.tg_set_updated_at();

-- Audit trigger (same pattern as other audited tables)
drop trigger if exists tg_audit_client_notes on public.client_notes;
create trigger tg_audit_client_notes
  after insert or update or delete on public.client_notes
  for each row execute function public.tg_audit();

alter table public.client_notes enable row level security;

drop policy if exists "client_notes read" on public.client_notes;
create policy "client_notes read" on public.client_notes
  for select using (public.is_admin());

drop policy if exists "client_notes write" on public.client_notes;
create policy "client_notes write" on public.client_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- Link a task back to the note it was born from. NULL for tasks that
-- were created normally (most of them).
alter table public.staff_tasks
  add column if not exists source_note_id bigint
    references public.client_notes(id) on delete set null;

create index if not exists staff_tasks_source_note_idx
  on public.staff_tasks (source_note_id)
  where source_note_id is not null;
