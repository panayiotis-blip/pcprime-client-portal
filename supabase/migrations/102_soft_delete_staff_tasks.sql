-- Migration 102: soft-delete staff tasks
-- ========================================
-- The Delete button on the Tasks page used to remove rows permanently —
-- a misclick lost the work. This adds a deleted_at timestamp column so
-- "delete" becomes reversible. The UI filters deleted_at IS NULL by
-- default and offers a "Show deleted" toggle with a Restore button.

alter table public.staff_tasks
  add column if not exists deleted_at timestamptz;

-- Partial index: most queries only want live rows, and a tiny "trash"
-- view occasionally. Index just the live ones so the common case is fast.
create index if not exists staff_tasks_live_idx
  on public.staff_tasks (created_at)
  where deleted_at is null;
