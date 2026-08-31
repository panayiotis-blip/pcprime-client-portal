-- =====================================================================
-- Migration 209: the ledger row names the file that made it current
--
-- The Data import screen showed, for A&F:
--
--   Analytical journal listing | a&f journal lisitngs 2021.xls | Covers to Aug 26
--
-- Both halves were true and the row was nonsense. covers_to is derived
-- from the postings (194) and says Aug 2026. last_file said 2021,
-- because the ledger arrives one file per year and 2021 happened to be
-- loaded last.
--
-- This is the same fault 194 fixed, in the other column. 194's reasoning:
--
--   "That is a wrong statement about coverage on the very screen used to
--    decide what to load next, and the kind of wrongness nobody checks
--    because it looks like a fact rather than a claim."
--
-- last_file and uploaded_at are worse than covers_to was, because
-- uploaded_at is what "how old" is measured from and what turns a
-- monthly feed overdue past 45 days. Loading a 2021 file today made the
-- whole feed look freshly updated while the 2026 data went stale
-- unnoticed. The screen exists to catch exactly that.
--
-- So for the journal listing all four columns now describe one thing:
-- the state of the ledger. The named file is the one that supplied the
-- latest month held, and uploaded_at is when THAT file arrived.
--
-- Only the ledger needs this. Every other feed is a single current file
-- that replaces its predecessor, so last-uploaded and latest-covering
-- are the same import; they keep the meaning they have.
-- =====================================================================

set search_path to reporting, public;

create or replace function commit_ledger_import(p_import bigint, p_allow_loss boolean default false)
returns table(months_replaced integer, postings_removed integer, postings_added integer)
language plpgsql security definer set search_path to 'reporting', 'public'
as $function$
declare
  v_client bigint;
  v_months date[];
  v_old int;
  v_new int;
  v_file text;
  v_by uuid;
  v_cur_import bigint;
  v_cur_file text;
  v_cur_at timestamptz;
  v_cur_by uuid;
  v_covers date;
begin
  select client_id, months_covered, original_filename, uploaded_by
    into v_client, v_months, v_file, v_by
    from imports where id = p_import and status = 'validated';
  if v_client is null then
    raise exception 'Import % is not staged and validated', p_import;
  end if;

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

  -- How far the ledger now reaches, and which file put it there. Derived
  -- from the postings for the same reason covers_to is: it cannot drift
  -- from what is actually held, whatever order the files arrive in.
  select max(period_month) into v_covers from postings where client_id = v_client;

  select p.import_id into v_cur_import
    from postings p
   where p.client_id = v_client and p.period_month = v_covers
   limit 1;

  select i.original_filename, coalesce(i.committed_at, i.uploaded_at), i.uploaded_by
    into v_cur_file, v_cur_at, v_cur_by
    from imports i where i.id = v_cur_import;

  -- Fall back to the file just committed if the latest month somehow has
  -- no import behind it. A row naming nothing would be worse than a row
  -- naming the wrong thing.
  if v_cur_file is null then
    v_cur_file := v_file;
    v_cur_at   := now();
    v_cur_by   := v_by;
    v_cur_import := p_import;
  end if;

  insert into feed_status (client_id, feed, last_import, last_file, uploaded_at, uploaded_by, covers_to)
  values (v_client, 'journal_listing', v_cur_import, v_cur_file, v_cur_at, v_cur_by, v_covers)
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
end $function$;

-- Every ledger row already written from the last file uploaded is wrong
-- by the same reasoning. Correct them once, here — as 194 did.
update feed_status f
   set last_import = c.import_id,
       last_file   = c.original_filename,
       uploaded_at = c.arrived,
       uploaded_by = c.uploaded_by
  from (
    select p.client_id,
           i.id as import_id,
           i.original_filename,
           coalesce(i.committed_at, i.uploaded_at) as arrived,
           i.uploaded_by
      from (
        select distinct on (client_id) client_id, period_month, import_id
          from postings
         order by client_id, period_month desc
      ) p
      join imports i on i.id = p.import_id
  ) c
 where c.client_id = f.client_id
   and f.feed = 'journal_listing';
