-- =====================================================================
-- Migration 195: what the ledger holds, month by month
--
-- The Data import screen showed the last file loaded and nothing else,
-- so six years of imports looked exactly like one. A person who had just
-- loaded 2021 could not tell from the screen whether it had landed --
-- and asked, reasonably, whether it had read at all. The answer was in
-- the database the whole time.
--
-- BUILD.md 8 asks this screen for a month-by-month checklist. The
-- figures are an aggregate over 174.000 postings, which is a question
-- for the database rather than the browser: the alternative is reading
-- balances_monthly a page at a time -- 17.639 rows for one client --
-- and adding it up on the client.
--
-- Why this is a function and not a view
--
-- It was a view first, with security_invoker so that RLS decided its
-- rows. That is the right instinct and the wrong result: the policy on
-- postings is staff_can_access(client_id), so asking for one client's
-- 68 months evaluated that function 174.026 times, once per row, and
-- the request died on the statement timeout. The aggregate itself takes
-- 264ms.
--
-- So the access check happens ONCE, here, exactly as commit_ledger_import
-- does it, and for the same reason. This is not a second register of who
-- may see what: it defers to reporting.staff_can_access, the same
-- function every policy in 190 defers to. Security definer without that
-- line would hand any signed-in user any client's ledger, which is why
-- the guard is the first thing in the body.
-- =====================================================================

set search_path to reporting, public;

drop view if exists ledger_months;

create or replace function ledger_months(p_client bigint)
returns table (
  period_month  date,
  postings      bigint,
  accounts      bigint,
  debit         numeric,
  credit        numeric,
  difference    numeric,
  last_import   bigint
)
language plpgsql stable security definer set search_path = reporting, public as $$
begin
  -- security definer bypasses RLS, so the policy on postings does not
  -- protect this call. Without this check any signed-in user could pass
  -- another client's id and read their ledger back a month at a time.
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  return query
    select p.period_month,
           count(*)                        as postings,
           count(distinct p.account_code)  as accounts,
           sum(p.debit)                    as debit,
           sum(p.credit)                   as credit,
           sum(p.debit) - sum(p.credit)    as difference,
           max(p.import_id)                as last_import
      from postings p
     where p.client_id = p_client
     group by p.period_month
     order by p.period_month;
end $$;

comment on function ledger_months(bigint) is
  'What the ledger actually holds for each month of one client: postings, accounts, both sides and the difference. Checks reporting.staff_can_access once rather than once per posting.';

revoke all on function ledger_months(bigint) from public;
grant execute on function ledger_months(bigint) to authenticated;
