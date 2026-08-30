-- =====================================================================
-- Migration 199: the review engine
--
-- 191 left regenerate_exceptions as a stub, deliberately, so the twelve
-- checks of BUILD.md 9 would be written against real posting tables
-- rather than copied from a prototype and never run. This writes them.
--
-- Nine of the twelve run from what is stored today. The other three, and
-- why not:
--
--   9  Balances over 90 days needs an allocations export linking
--      receipts to invoices. BUILD.md 13 records that it does not exist
--      yet, so ageing would be oldest-first guesswork.
--   11 An unposted journal inside a reported month. The parser reads the
--      posted flag -- it found 9 unposted journals in A&F 2026 -- but
--      postings has no column to keep it in. Adding one here would sit
--      empty until every file is imported again, which is a decision
--      about the ledger, not about the checks.
--   3  Unclassified or unmapped cash needs the bank statement feed
--      (camt.053), which has never been imported.
--
-- Saying which checks did NOT run is part of the job. A review screen
-- that shows nine green ticks and stays quiet about the three it could
-- not perform is worse than no screen: it reads as assurance.
--
-- ex_key is what makes a corrected item disappear. It is built from the
-- check, month, account and reference, so re-running after a fix simply
-- does not produce the row again -- the requirement in 11 that "a
-- corrected item drops off at the next import".
-- =====================================================================

set search_path to reporting, public;

create or replace function regenerate_exceptions(p_client bigint, p_import bigint default null)
returns integer
language plpgsql security definer set search_path = reporting, public as $$
declare
  n integer;
  v_last_month date;
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  delete from exceptions where client_id = p_client;

  select max(period_month) into v_last_month from postings where client_id = p_client;
  if v_last_month is null then
    return 0;
  end if;

  -- ---- 1. Trial balance does not agree to the ledger for the month ----
  -- Only for months where a trial balance has actually been imported;
  -- absence of one is check 2's business, not this one's.
  insert into exceptions (client_id, ex_key, check_name, sev, month, account, report_line,
                          amount, description, detail, generated_by)
  select p_client,
         'tb_vs_ledger|' || to_char(t.period_month, 'YYYY-MM') || '|' || t.account_code,
         'Trial balance does not agree to the ledger',
         case when abs(t.diff) >= 100 then 'high' else 'medium' end::severity,
         t.period_month, t.account_code,
         (select coalesce(m.line_id, d.line_id) from mapping_defaults d
            left join mappings m on m.client_id = d.client_id and m.account_code = d.account_code
           where d.client_id = p_client and d.account_code = t.account_code),
         t.diff,
         'The trial balance and the ledger disagree on this account by ' ||
           to_char(t.diff, 'FM9999999990.00') || ' for ' || to_char(t.period_month, 'Mon YYYY') || '.',
         'trial balance ' || to_char(t.tb_net, 'FM9999999990.00') ||
           ' against ledger ' || to_char(t.jl_net, 'FM9999999990.00'),
         p_import
    from (
      select coalesce(tb.period_month, jl.period_month) as period_month,
             coalesce(tb.account_code, jl.account_code) as account_code,
             coalesce(tb.net, 0) as tb_net, coalesce(jl.net, 0) as jl_net,
             coalesce(tb.net, 0) - coalesce(jl.net, 0) as diff
        from (select period_month, account_code, sum(debit - credit) as net
                from trial_balance
               where client_id = p_client and not is_annual and not detailed
               group by period_month, account_code) tb
        full outer join (
              select p.period_month,
                     coalesce(nullif(a.control_code, ''), p.account_code) as account_code,
                     sum(p.debit - p.credit) as net
                from postings p
                left join coa_accounts a on a.client_id = p_client and a.code = p.account_code
               where p.client_id = p_client
                 and p.period_month in (select distinct period_month from trial_balance
                                         where client_id = p_client and not is_annual and not detailed)
               group by 1, 2) jl
          on jl.period_month = tb.period_month and jl.account_code = tb.account_code
    ) t
   where abs(t.diff) >= 0.005;

  -- ---- 2. A month is missing from a feed that is due ------------------
  -- A month inside the span held that carries no postings at all.
  insert into exceptions (client_id, ex_key, check_name, sev, month, description, generated_by)
  select p_client,
         'missing_month|' || to_char(m.month, 'YYYY-MM'),
         'A month is missing from a feed that is due', 'high', m.month,
         'No postings at all for ' || to_char(m.month, 'Mon YYYY') ||
           ', which falls inside the span the ledger covers.',
         p_import
    from generate_series((select min(period_month) from postings where client_id = p_client),
                         v_last_month, interval '1 month') as m(month)
   where not exists (select 1 from postings p
                      where p.client_id = p_client and p.period_month = m.month::date);

  -- A month that is present but carries no expense at all is the same
  -- failure wearing a disguise: A&F's August 2026 holds 1.820 postings,
  -- sales and purchases among them, and not one overhead.
  insert into exceptions (client_id, ex_key, check_name, sev, month, description, detail, generated_by)
  select p_client,
         'part_month|' || to_char(p.period_month, 'YYYY-MM'),
         'A month is missing from a feed that is due', 'high', p.period_month,
         to_char(p.period_month, 'Mon YYYY') || ' carries ' || count(*) ||
           ' postings but nothing on any overhead line. Reporting a period that ends here ' ||
           'would show its income against someone else''s costs.',
         'no postings mapped to administration, selling or finance costs',
         p_import
    from postings p
   where p.client_id = p_client
   group by p.period_month
  having not exists (
      select 1 from postings q
        join coa_accounts a on a.client_id = p_client and a.code = q.account_code
        join mapping_defaults d on d.client_id = p_client
             and d.account_code = coalesce(nullif(a.control_code, ''), q.account_code)
        join report_lines rl on rl.line_id = d.line_id
        join templates t on t.id = rl.template_id and t.client_id is null
       where q.client_id = p_client and q.period_month = p.period_month
         and rl.section in ('Administration', 'Selling and distribution', 'Finance costs'));

  -- ---- 4. A balance on the suspense account ---------------------------
  insert into exceptions (client_id, ex_key, check_name, sev, month, account, report_line,
                          amount, description, generated_by)
  select p_client,
         'suspense|' || to_char(v_last_month, 'YYYY-MM') || '|' || p.account_code,
         'A balance on the suspense account',
         case when abs(sum(p.debit - p.credit)) >= 100 then 'high' else 'medium' end::severity,
         v_last_month, p.account_code, 'B-170', sum(p.debit - p.credit),
         'Suspense account ' || p.account_code || ' carries ' ||
           to_char(sum(p.debit - p.credit), 'FM9999999990.00') ||
           '. Nothing should be left in suspense at a reporting date.',
         p_import
    from postings p
    join coa_accounts a on a.client_id = p_client and a.code = p.account_code
   where p.client_id = p_client and a.name ilike '%suspense%'
   group by p.account_code
  having abs(sum(p.debit - p.credit)) >= 0.005;

  -- ---- 5. Revenue posted outside the sales module ---------------------
  insert into exceptions (client_id, ex_key, check_name, sev, month, txn_date, account, report_line,
                          journal, journal_no, batch, reference, amount, description, generated_by)
  select p_client,
         'revenue_outside_sales|' || to_char(p.period_month, 'YYYY-MM') || '|' ||
           p.account_code || '|' || coalesce(p.reference, '') || '|' || (p.credit - p.debit),
         'Revenue posted outside the sales module', 'medium',
         p.period_month, p.posted_on, p.account_code, d.line_id,
         p.journal_code, p.journal_no::text, p.batch_no::text, p.reference,
         p.credit - p.debit,
         'Revenue on ' || p.account_code || ' posted through journal ' ||
           coalesce(p.journal_code, '(none)') || ' rather than the sales module.',
         p_import
    from postings p
    join coa_accounts a on a.client_id = p_client and a.code = p.account_code
    join mapping_defaults d on d.client_id = p_client
         and d.account_code = coalesce(nullif(a.control_code, ''), p.account_code)
    join report_lines rl on rl.line_id = d.line_id
    join templates t on t.id = rl.template_id and t.client_id is null
   where p.client_id = p_client and rl.section = 'Revenue'
     and coalesce(p.journal_code, '') not in ('SIN', 'SRT', 'CAP')
     and abs(p.credit - p.debit) >= 0.005;

  -- ---- 6. A debtor or creditor balance on the wrong side --------------
  insert into exceptions (client_id, ex_key, check_name, sev, month, account, amount,
                          description, detail, generated_by)
  select p_client,
         'wrong_side|' || to_char(v_last_month, 'YYYY-MM') || '|' || p.account_code,
         'A debtor or creditor balance on the wrong side',
         case when abs(sum(p.debit - p.credit)) >= 1000 then 'high' else 'low' end::severity,
         v_last_month, p.account_code, sum(p.debit - p.credit),
         a.account_type || ' account ' || p.account_code || ' (' || coalesce(a.name, '') ||
           ') carries ' || to_char(sum(p.debit - p.credit), 'FM9999999990.00') ||
           ', which is the wrong side for its type.',
         'a credit balance on a debtor, or a debit balance on a creditor',
         p_import
    from postings p
    join coa_accounts a on a.client_id = p_client and a.code = p.account_code
   where p.client_id = p_client and a.account_type in ('Debtor', 'Creditor')
   group by p.account_code, a.account_type, a.name
  having (a.account_type = 'Debtor'  and sum(p.debit - p.credit) <= -0.005)
      or (a.account_type = 'Creditor' and sum(p.debit - p.credit) >=  0.005);

  -- ---- 7. An unmapped trading account ---------------------------------
  insert into exceptions (client_id, ex_key, check_name, sev, month, account, amount,
                          description, generated_by)
  select p_client,
         'unmapped|' || coalesce(nullif(a.control_code, ''), p.account_code),
         'An unmapped trading account', 'high', v_last_month,
         coalesce(nullif(a.control_code, ''), p.account_code), sum(p.debit - p.credit),
         'Account ' || coalesce(nullif(a.control_code, ''), p.account_code) ||
           ' has been posted to but maps to no report line, so its ' ||
           to_char(sum(p.debit - p.credit), 'FM9999999990.00') || ' appears in no statement.',
         p_import
    from postings p
    left join coa_accounts a on a.client_id = p_client and a.code = p.account_code
   where p.client_id = p_client
     and not exists (
       select 1 from mapping_defaults d
        where d.client_id = p_client
          and d.account_code = coalesce(nullif(a.control_code, ''), p.account_code)
          and d.line_id is not null)
   -- Grouped by the expression, not by position: position 1 is p_client, a
   -- parameter, which groups everything into one row and then fails on the
   -- ungrouped column rather than quietly returning the wrong thing.
   group by coalesce(nullif(a.control_code, ''), p.account_code)
  having abs(sum(p.debit - p.credit)) >= 0.005;

  -- ---- 8. Duplicate postings ------------------------------------------
  -- Collapsed by (date, reference, amount) so the two legs of one entry
  -- are not counted twice, then tested for an existing reversal: a
  -- duplicate that has already been reversed is not a finding, and on
  -- real data that demoted 38 of 58 events to low severity.
  insert into exceptions (client_id, ex_key, check_name, sev, month, txn_date, account,
                          journal, reference, amount, description, detail, generated_by)
  select p_client,
         'duplicate|' || to_char(d.posted_on, 'YYYY-MM-DD') || '|' || d.account_code || '|' ||
           d.reference || '|' || d.amount,
         'Duplicate postings',
         case when d.reversed then 'low' else 'high' end::severity,
         date_trunc('month', d.posted_on)::date, d.posted_on, d.account_code,
         d.journal_code, d.reference, d.amount,
         d.n || ' postings of ' || to_char(d.amount, 'FM9999999990.00') || ' on ' ||
           to_char(d.posted_on, 'DD Mon YYYY') || ' to ' || d.account_code ||
           ' with reference ' || d.reference || '.',
         case when d.reversed then 'a reversal of the same amount exists; demoted'
              else 'no reversal found' end,
         p_import
    from (
      -- The reversal test sits OUTSIDE the aggregation. Inside it, the
      -- subquery would reference p.debit and p.credit individually while
      -- only their difference is grouped, which Postgres rejects.
      select g.*, rv.reversed
        from (
          select p.posted_on, p.account_code, p.reference, p.journal_code,
                 (p.debit - p.credit) as amount, count(*) as n
            from postings p
           where p.client_id = p_client and p.reference is not null and p.reference <> ''
             and abs(p.debit - p.credit) >= 0.005
           group by p.posted_on, p.account_code, p.reference, p.journal_code, (p.debit - p.credit)
          having count(*) > 1
        ) g
        cross join lateral (
          select exists (
            select 1 from postings r
             where r.client_id = p_client and r.account_code = g.account_code
               and r.reference = g.reference
               and abs((r.debit - r.credit) + g.amount) < 0.005) as reversed
        ) rv
    ) d;

  -- ---- 10. A posting with no VAT code on a VAT-bearing account --------
  -- One exception per account and month, not per posting. Written per posting
  -- this produced 6.278 findings across 24 accounts on A&F, which is not a
  -- review list -- it is a way of hiding the other checks. The count, the
  -- total and one reference to start from are what a person needs; the rest
  -- is in the ledger.
  --
  -- The VAT-bearing accounts are gathered ONCE. As a correlated subquery this
  -- ran per posting over 174.026 rows and never returned at all.
  insert into exceptions (client_id, ex_key, check_name, sev, month, account,
                          journal, reference, amount, description, detail, generated_by)
  select p_client,
         'no_vat_code|' || to_char(p.period_month, 'YYYY-MM') || '|' || p.account_code,
         'A posting with no VAT code on a VAT-bearing account', 'medium',
         p.period_month, p.account_code,
         min(p.journal_code), min(p.reference), sum(p.debit - p.credit),
         count(*) || ' postings to ' || p.account_code ||
           ' carry no VAT code in ' || to_char(p.period_month, 'Mon YYYY') ||
           ', on an account whose other postings do.',
         'total ' || to_char(sum(p.debit - p.credit), 'FM9999999990.00') ||
           ', first reference ' || coalesce(min(p.reference), '(none)'),
         p_import
    from postings p
    join (select distinct account_code from postings
           where client_id = p_client and vat_code is not null and vat_code <> '') v
      on v.account_code = p.account_code
   where p.client_id = p_client
     and (p.vat_code is null or p.vat_code = '')
     and abs(p.debit - p.credit) >= 0.005
     and p.period_month >= v_last_month - interval '11 months'
   group by p.period_month, p.account_code;

  -- ---- 12. A journal whose own debits and credits do not agree --------
  insert into exceptions (client_id, ex_key, check_name, sev, month, journal, journal_no,
                          amount, description, generated_by)
  select p_client,
         'journal_unbalanced|' || to_char(p.period_month, 'YYYY-MM') || '|' ||
           coalesce(p.journal_code, '') || '|' || coalesce(p.journal_no::text, ''),
         'A journal whose own debits and credits do not agree', 'high',
         p.period_month, p.journal_code, p.journal_no::text,
         sum(p.debit) - sum(p.credit),
         'Journal ' || coalesce(p.journal_code, '(none)') || ' ' ||
           coalesce(p.journal_no::text, '') || ' in ' || to_char(p.period_month, 'Mon YYYY') ||
           ' is out by ' || to_char(sum(p.debit) - sum(p.credit), 'FM9999999990.00') || '.',
         p_import
    from postings p
   where p.client_id = p_client and p.journal_no is not null
   group by p.period_month, p.journal_code, p.journal_no
  having abs(sum(p.debit) - sum(p.credit)) >= 0.005;

  select count(*) into n from exceptions where client_id = p_client;
  return n;
end $$;

comment on function regenerate_exceptions(bigint, bigint) is
  'Runs the review checks of BUILD.md 9 that the stored data supports. Checks 3, 9 and 11 do not run: they need the bank statement feed, an allocations export, and a posted flag that postings does not keep.';

revoke all on function regenerate_exceptions(bigint, bigint) from public;
grant execute on function regenerate_exceptions(bigint, bigint) to authenticated;
