-- =============================================================
-- Migration 152: Drop the obsolete 1-arg scheduler overload
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 100 created run_due_service_schedules(p_run_date date). Migration
-- 101 added a 3-arg version (p_run_date, p_service_id, p_client_ids) with
-- CREATE OR REPLACE — but a different argument list makes a NEW overload, so
-- both functions coexisted. A call with defaults (e.g. from the cron or the
-- 'Generate now' button) is then ambiguous:
--   "Could not choose the best candidate function ..."
-- Drop the old 1-arg version; the 3-arg version (migration 151) remains.
-- =============================================================

begin;

drop function if exists public.run_due_service_schedules(date);

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 152.
-- =============================================================
