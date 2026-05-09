-- =============================================================
-- Migration 009: Compliance phase 2
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Updates compliance_tasks.status to the new four-state workflow:
--   not_started → in_preparation → filed → completed
--
-- Existing values are migrated:
--   pending      → not_started
--   in_progress  → in_preparation
--   cancelled    → not_started   (no equivalent in new set)
--   completed    → completed     (unchanged)
--
-- The audit trigger from migration 007 will record one row per
-- updated task. That's expected and confirms the trigger works.
--
-- Wrapped in a transaction; rolls back atomically on failure.
-- =============================================================

begin;

-- Drop the old CHECK so we can rewrite values without violating it
alter table public.compliance_tasks
  drop constraint if exists compliance_tasks_status_check;

-- Migrate existing values to the new vocabulary
update public.compliance_tasks set status = 'not_started'    where status in ('pending', 'cancelled');
update public.compliance_tasks set status = 'in_preparation' where status = 'in_progress';
-- 'completed' rows stay as 'completed'.

-- Belt-and-braces: catch any value that wasn't in the old set
update public.compliance_tasks set status = 'not_started'
  where status not in ('not_started', 'in_preparation', 'filed', 'completed');

-- Add the new CHECK
alter table public.compliance_tasks
  add constraint compliance_tasks_status_check
  check (status in ('not_started', 'in_preparation', 'filed', 'completed'));

-- New default for freshly-inserted rows
alter table public.compliance_tasks
  alter column status set default 'not_started';

commit;
-- =============================================================
-- End of migration 009.
--
-- Verify in SQL Editor:
--   select status, count(*) from public.compliance_tasks group by status order by status;
--   -- expect rows only for: not_started, in_preparation, filed, completed
-- =============================================================
