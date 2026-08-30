-- =====================================================================
-- Migration 194: feed_status describes the ledger, not the last file
--
-- covers_to was written by the application from the file it had just
-- parsed, which answers "what did this file cover" -- a different
-- question from the one the Data import screen asks, which is "how far
-- does this client's ledger actually reach".
--
-- The two part company the moment files arrive out of order. A&F's 2026
-- ledger was loaded first, then its 2025 one, and the screen then read
-- "covers to Dec 2025" while the ledger ran to Aug 2026. That is a wrong
-- statement about coverage on the very screen used to decide what to
-- load next, and the kind of wrongness nobody checks because it looks
-- like a fact rather than a claim.
--
-- So it is derived here instead, from the postings, inside the same
-- transaction that commits them. It cannot drift from what is held,
-- whatever order the files come in, and it stays right even if a future
-- import path forgets to maintain it -- there is now only one place that
-- can write it.
--
-- last_file, uploaded_at, uploaded_by keep their old meaning: they are
-- about the most recent file, and that is what the screen says they are.
-- =====================================================================

create or replace function commit_ledger_import(p_import bigint, p_allow_loss boolean default false)
returns table (months_replaced int, postings_removed int, postings_added int)
language plpgsql security definer set search_path = reporting, public as $$
declare
  v_client bigint;
  v_months date[];
  v_old int;
  v_new int;
  v_file text;
  v_by uuid;
begin
  select client_id, months_covered, original_filename, uploaded_by
    into v_client, v_months, v_file, v_by
    from imports where id = p_import and status = 'validated';
  if v_client is null then
    raise exception 'Import % is not staged and validated', p_import;
  end if;

  -- security definer bypasses RLS, so the policy on imports/postings does
  -- not protect this call. Without this check any signed-in user could pass
  -- another client's import id and have their ledger rewritten.
  if not staff_can_access(v_client) then
    raise exception 'no access to client %', v_client;
  end if;

  select count(*) into v_old
    from postings where client_id = v_client and period_month = any(v_months);
  select count(*) into v_new
    from postings_staging where import_id = p_import;

  if v_new < v_old and not p_allow_loss then
    raise exception
      'Refusing to commit: % postings held for these months, file carries only %. Override explicitly if intended.',
      v_old, v_new;
  end if;

  delete from postings where client_id = v_client and period_month = any(v_months);
  insert into postings select * from postings_staging where import_id = p_import;
  delete from postings_staging where import_id = p_import;

  delete from balances_monthly where client_id = v_client and period_month = any(v_months);
  insert into balances_monthly (client_id, period_month, account_code, debit, credit)
  select client_id, period_month, account_code, sum(debit), sum(credit)
    from postings where client_id = v_client and period_month = any(v_months)
   group by client_id, period_month, account_code;

  update imports set status = 'committed', committed_at = now(), committed_by = auth.uid()
   where id = p_import;

  insert into period_status (client_id, period_month, feed, state, import_id, updated_by)
  select v_client, m, 'ledger', 'uploaded', p_import, auth.uid() from unnest(v_months) m
  on conflict (client_id, period_month, feed)
    do update set state = 'uploaded', import_id = p_import, updated_at = now(), updated_by = auth.uid();

  -- The feed's coverage, read from what is now held rather than from the
  -- file that happened to arrive last.
  insert into feed_status (client_id, feed, last_import, last_file, uploaded_at, uploaded_by, covers_to)
  select v_client, 'journal_listing', p_import, v_file, now(), v_by,
         (select max(period_month) from postings where client_id = v_client)
  on conflict (client_id, feed) do update
     set last_import = excluded.last_import,
         last_file   = excluded.last_file,
         uploaded_at = excluded.uploaded_at,
         uploaded_by = excluded.uploaded_by,
         covers_to   = excluded.covers_to;

  months_replaced := array_length(v_months, 1);
  postings_removed := v_old;
  postings_added := v_new;
  return next;
end $$;

-- Every feed_status row already written from a file rather than from the
-- ledger is wrong by the same reasoning. Correct them once, here.
update feed_status f
   set covers_to = p.last_month
  from (select client_id, max(period_month) as last_month
          from postings group by client_id) p
 where p.client_id = f.client_id
   and f.feed = 'journal_listing'
   and f.covers_to is distinct from p.last_month;
