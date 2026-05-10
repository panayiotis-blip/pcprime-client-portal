-- =============================================================
-- Migration 022: Link call_logs to staff_tasks
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A call log entry can optionally reference the staff_task it was
-- made about (e.g. "phone message → call them back" → the eventual
-- callback gets logged with task_id pointing back to the original
-- message task).
--
-- ON DELETE SET NULL so deleting a task doesn't lose the call record.
-- =============================================================

begin;

alter table public.call_logs
  add column if not exists task_id bigint references public.staff_tasks(id) on delete set null;

create index if not exists call_logs_task_idx
  on public.call_logs (task_id) where task_id is not null;

commit;
-- =============================================================
-- End of migration 022.
-- =============================================================
