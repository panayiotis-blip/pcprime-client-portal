-- 034_partial_unique_codes.sql
-- Bug: bulk import fails with "duplicate key value violates unique constraint
-- clients_client_code_key" after a wipe, because the global UNIQUE on
-- client_code also counts soft-deleted clients. Same risk for unique_email.
--
-- Fix: drop the global UNIQUE constraints and replace each with a PARTIAL
-- unique index that only enforces uniqueness for LIVE clients (deleted_at IS NULL).
--
-- Semantics:
--   - Two live clients still can't share a code/email — uniqueness is preserved.
--   - A soft-deleted client may keep its code even after a new live client
--     is created with the same one (e.g. after a wipe + re-import).
--   - Edge case: restoring a soft-deleted client whose code now belongs to
--     someone else would fail at the unique index — that's actually correct
--     (two live clients with the same code shouldn't be allowed).

begin;

-- ---- client_code ----
alter table public.clients
  drop constraint if exists clients_client_code_key;

create unique index if not exists clients_client_code_unique_live
  on public.clients (client_code)
  where deleted_at is null and client_code is not null;

-- ---- unique_email ----
alter table public.clients
  drop constraint if exists clients_unique_email_key;

create unique index if not exists clients_unique_email_unique_live
  on public.clients (unique_email)
  where deleted_at is null and unique_email is not null;

commit;
-- =============================================================
-- Verify:
--   select conname from pg_constraint where conrelid = 'public.clients'::regclass
--     and contype = 'u';
--   -- expect: no rows containing client_code or unique_email
--
--   select indexname from pg_indexes where tablename = 'clients'
--     and indexname like '%_unique_live';
--   -- expect 2 rows: clients_client_code_unique_live, clients_unique_email_unique_live
-- =============================================================
