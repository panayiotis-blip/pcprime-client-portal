-- =============================================================
-- Migration 180: a supervisor alongside the account manager
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Every client already names an account manager (migration 156) — the person
-- new scheduled tasks are assigned to, the person who does the work. What no
-- client named was who is answerable for it.
--
-- Today that is two people and everybody knows which is which. It stops being
-- obvious at the third member of staff, and the escalation added in migration
-- 153 has nowhere to escalate TO without it.
--
--   clients.supervisor_id — who oversees this client's work.
--
-- Deliberately a second column rather than a roles table. A client has exactly
-- one manager and one supervisor; the many-to-many — which staff may work on
-- which clients — is a different question and gets its own table when it is
-- needed. Two columns now beats a join nobody can read.
--
-- Nulls are fine and are the starting state: unassigned means unassigned, not
-- broken. Both columns are set in bulk from Compliance & Tax → Services.
--
-- on delete set null, like account_manager: a staff member leaving must not
-- take the client record with them.
-- =============================================================

begin;

alter table public.clients
  add column if not exists supervisor_id uuid references auth.users(id) on delete set null;

comment on column public.clients.supervisor_id is
  'Staff member accountable for this client''s work; the escalation target above the account manager.';

-- Answering "what am I supervising?" should not read 246 rows.
create index if not exists clients_supervisor_idx
  on public.clients (supervisor_id) where supervisor_id is not null;

notify pgrst, 'reload schema';

commit;

-- =============================================================
-- Verify:
--   select count(*) filter (where account_manager is not null) as with_manager,
--          count(*) filter (where supervisor_id  is not null) as with_supervisor
--     from public.clients where deleted_at is null;
-- =============================================================
