-- 023_task_category.sql
-- Adds a category column to staff_tasks so the UI can split out "return call"
-- tasks (created from inbound call logs) from regular tasks. Existing rows
-- stay 'general' by default.

alter table public.staff_tasks
  add column if not exists category text not null default 'general';

create index if not exists staff_tasks_category_idx
  on public.staff_tasks (category)
  where category <> 'general';

comment on column public.staff_tasks.category is
  'Task category — general (default), return_call (callback from an inbound phone message), message (manual phone-message capture). Used by the Tasks UI to surface return-call tasks separately.';

-- Backfill: any existing tasks created by yesterday's "Log a message" flow
-- (title prefix "Phone message:") are conceptually return calls.
update public.staff_tasks
  set category = 'return_call'
  where category = 'general'
    and title like 'Phone message:%';
