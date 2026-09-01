-- =====================================================================
-- Migration 216: the reporting schema is reachable by service_role
--
-- Migration 190 granted the reporting schema to `authenticated` and to
-- nobody else, with the note "anon is deliberately absent: nothing here
-- is public". That was right about anon and silent about service_role,
-- which was not a decision so much as a role nobody had needed yet.
--
-- It is needed now. scripts/migrate-btms-imports.mjs moves the seventeen
-- objects still sitting in the reporting-imports bucket into each
-- client's BTMS data folder. Storage it can reach with the service key;
-- reporting.imports it cannot, and that table is where the files' real
-- names and periods are -- the objects are named by sha256 alone, so
-- without it every file would arrive in the folder called after its own
-- checksum. The script fails with
--
--     permission denied for schema reporting
--
-- BE CLEAR ABOUT WHAT THIS GIVES AWAY. service_role bypasses row-level
-- security. After this, anything holding the service key can read and
-- write every client's postings, exceptions, budgets and sign-offs with
-- no per-client check at all. That is not a new exposure in kind -- the
-- same key already has exactly that over public.clients, public.documents
-- and the rest of the portal -- but it is the reporting data joining the
-- set, and it is worth saying rather than discovering.
--
-- What it does NOT change:
--
--   * The application. It signs in with the publishable key and a user's
--     JWT, so it is `authenticated` and every reporting policy applies to
--     it exactly as before. Nothing a person can see or do changes.
--   * The rule about who may use the reporting app. staff_can_access()
--     and is_reporting_staff() are untouched -- migration 214 settled
--     those and they stay settled.
--   * anon, which remains absent, deliberately.
--
-- Functions are deliberately NOT granted. Most of them are security
-- definer and check staff_can_access() or user_can_access_client(), both
-- of which read auth.uid() -- null for the service role, so they would
-- refuse anyway. A grant that only produces "no access to client 1754"
-- is a grant that misleads whoever reads it next.
-- =====================================================================

set search_path to reporting, public;

grant usage on schema reporting to service_role;

grant select, insert, update, delete on all tables in schema reporting to service_role;
grant usage, select on all sequences in schema reporting to service_role;

-- Tables added after this migration are covered too, so a later table is
-- not a later outage in a script that has been working for months.
alter default privileges in schema reporting
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema reporting
  grant usage, select on sequences to service_role;

comment on schema reporting is
  'The client reporting platform. Readable and writable by authenticated (governed by RLS, which every table in here enables) and by service_role (which bypasses RLS -- see migration 216). Not by anon.';
