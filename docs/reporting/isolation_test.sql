-- ---------------------------------------------------------------------
-- P0 acceptance test — client isolation on the reporting schema.
--
-- SAFE TO RUN AGAINST THE LIVE PROJECT. Read this before changing it.
--
-- The first version of this file was written for `psql -f` against a
-- throwaway database: it created roles, redefined auth.uid() and inserted
-- into auth.users and public.clients, relying on a closing `rollback`. Run
-- through the SQL editor or the API against the portal's own project, a
-- redefinition of auth.uid() that did not get rolled back would make every
-- RLS check in the portal answer as one fixed user. This version therefore:
--
--   * performs NO DDL — no roles, no functions, nothing redefined;
--   * writes NOTHING to auth.* or public.* — it uses the real users and
--     real clients already there, and touches only reporting.*;
--   * runs inside one DO block that ends by RAISING, so the fixtures it
--     inserts are rolled back whether it passes or fails.
--
-- Because it ends by raising, A PASS IS REPORTED AS AN ERROR whose message
-- begins "ISOLATION TEST PASSED". That is the intended output. Any message
-- beginning "FAIL" is a real failure.
--
-- Impersonation is done the way Supabase does it: `set local role
-- authenticated` plus a request.jwt.claims sub, which is what auth.uid()
-- reads. No role is left set at the end.
--
-- Asserted for a signed-in NON-STAFF user who IS linked to a client in
-- public.user_clients — the account that would have had access before the
-- staff-only gate went in:
--
--   1. an unfiltered select on reporting.postings returns ZERO rows;
--   2. asking for client B explicitly returns ZERO ROWS, not an error;
--   3. the same holds on trial_balance;
--   4. an insert against client B is refused.
--
-- and for a member of STAFF:
--
--   5. both clients are visible;
--   6. a write is accepted.
--
-- Re-run after any change to a policy, and extend it as new tables arrive.
-- ---------------------------------------------------------------------

do $$
declare
  v_a        bigint;
  v_b        bigint;
  v_staff    uuid;
  v_nonstaff uuid;
  v_imp_a    bigint;
  v_imp_b    bigint;
  n          int;
  refused    boolean := false;
  results    text := '';
begin
  -- ---- who and what to test with -----------------------------------
  select uc.client_id, uc.user_id into v_a, v_nonstaff
  from public.user_clients uc
  join public.profiles p on p.id = uc.user_id
  where p.active and p.role not in ('owner','supervisor','admin','staff')
  limit 1;

  if v_nonstaff is null then
    raise exception 'FAIL: no non-staff linked user exists to test with — '
      'the staff-only gate cannot be proved without one';
  end if;

  select id into v_b from public.clients where id <> v_a order by id limit 1;
  select id into v_staff from public.profiles
   where active and role in ('owner','supervisor','admin','staff') limit 1;

  if v_b is null or v_staff is null then
    raise exception 'FAIL: need two clients and one member of staff to test with';
  end if;

  -- ---- fixtures, in reporting only, rolled back at the end ---------
  insert into reporting.imports (client_id, feed, status, storage_path,
                                 original_filename, checksum, uploaded_by)
  values (v_a, 'ledger', 'committed', 'isolation-test', 'a.xls', 'ck-a', v_staff)
  returning id into v_imp_a;

  insert into reporting.imports (client_id, feed, status, storage_path,
                                 original_filename, checksum, uploaded_by)
  values (v_b, 'ledger', 'committed', 'isolation-test', 'b.xls', 'ck-b', v_staff)
  returning id into v_imp_b;

  insert into reporting.postings (client_id, import_id, posted_on, period_month,
                                  account_code, debit, credit)
  values (v_a, v_imp_a, date '2026-07-01', date '2026-07-01', '5111', 100, 0),
         (v_b, v_imp_b, date '2026-07-01', date '2026-07-01', '5111', 100, 0);

  insert into reporting.trial_balance (client_id, import_id, period_month,
                                       account_code, opening, debit, credit, closing)
  values (v_a, v_imp_a, date '2026-07-01', '5111', 0, 100, 0, 100),
         (v_b, v_imp_b, date '2026-07-01', '5111', 0, 100, 0, 100);

  -- ================= as the NON-STAFF linked user ===================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_nonstaff, 'role', 'authenticated')::text,
                     true);

  -- 1. an unfiltered select
  select count(*) into n from reporting.postings;
  if n <> 0 then
    execute 'reset role';
    raise exception 'FAIL: a non-staff user saw % posting rows, expected 0', n;
  end if;

  -- 2. asking for another client is empty, not an error
  begin
    select count(*) into n from reporting.postings where client_id = v_b;
  exception when others then
    execute 'reset role';
    raise exception 'FAIL: reading another client raised "%" instead of returning zero rows', sqlerrm;
  end;
  if n <> 0 then
    execute 'reset role';
    raise exception 'FAIL: reading another client returned % rows', n;
  end if;

  -- 3. and the same on the trial balance
  select count(*) into n from reporting.trial_balance;
  if n <> 0 then
    execute 'reset role';
    raise exception 'FAIL: a non-staff user saw % trial balance rows, expected 0', n;
  end if;

  -- 4. nor may they write
  begin
    insert into reporting.postings (client_id, import_id, posted_on, period_month,
                                    account_code, debit, credit)
    values (v_b, v_imp_b, date '2026-07-01', date '2026-07-01', '5111', 1, 0);
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    execute 'reset role';
    raise exception 'FAIL: a non-staff user wrote a posting to another client';
  end if;

  results := 'non-staff: 0 unfiltered, 0 for another client, 0 trial balance, write refused';

  -- ===================== as a member of STAFF =======================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_staff, 'role', 'authenticated')::text,
                     true);

  select count(distinct client_id) into n from reporting.postings
   where client_id in (v_a, v_b);
  if n <> 2 then
    execute 'reset role';
    raise exception 'FAIL: staff saw % of the 2 clients — the gate is too tight', n;
  end if;

  insert into reporting.postings (client_id, import_id, posted_on, period_month,
                                  account_code, debit, credit)
  values (v_a, v_imp_a, date '2026-07-01', date '2026-07-01', '5112', 1, 0);

  results := results || ' | staff: both clients visible, write accepted';

  execute 'reset role';

  -- This is what rolls the fixtures back. It is the only way to be certain
  -- none of them reach the live tables.
  raise exception 'ISOLATION TEST PASSED (all fixtures rolled back) — %', results;
end $$;
