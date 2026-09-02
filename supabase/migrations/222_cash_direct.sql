-- =====================================================================
-- Migration 222: money in and money out, by where it actually went
--
-- FIX-3 §7. The indirect cash flow statement stays as it is -- it is
-- right and it proves out. What is missing is the direct one: money in
-- and money out, by bank account, month by month, showing who was paid
-- and what for. No new import: every posting on a bank or cash account
-- has another side, and that other side says what the money was for.
--
-- WHAT COUNTS AS ONE TRANSACTION. journal_code, journal_no and batch_no
-- alone do NOT identify one: on A&F they give 27.415 groups averaging
-- 6,3 lines and running to 861, which is a batch, not an entry. Adding
-- posted_on and reference gives 31.028 groups touching a bank account,
-- of which 31.020 balance -- 99,97 per cent -- with at most eight lines
-- on the other side. That is the key used here.
--
-- HOW THE OTHER SIDE IS ALLOCATED. For a bank line worth bv in a
-- transaction whose non-bank lines are ov(1..n) summing to S, the amount
-- attributed to line i is bv * ov(i) / S. Where there is one bank line
-- and one contra -- 5.559 of A&F's -- that is exactly the contra. Where
-- a payment covers several invoices it splits in proportion, which is
-- the only division the ledger supports.
--
-- TRANSFERS ARE NOT MOVEMENT. 4.449 of A&F's bank transactions have no
-- non-bank line at all: they are money moved between the client's own
-- accounts -- Cash Account to Bank of Cyprus and back. They are marked
-- as transfers and carry no contra. They move one account and not the
-- business, and the screen has to be able to tell the difference, so
-- they are returned rather than dropped.
--
-- WHAT A BANK ACCOUNT IS. Whatever this client's mapping puts on B-160
-- (Cash and bank) or B-270 (Bank overdraft), with the client's own
-- overrides applied over the defaults. Nothing here hardcodes an account
-- code, and a client who maps a new bank account gets it here at once.
--
-- Read-only and derived. This writes nothing and stores nothing.
-- =====================================================================

set search_path to reporting, public;

-- The self-join below matches a transaction to itself five columns wide.
-- Without this it is a hash join over every posting the client has, which
-- is survivable at 174.026 rows and would not be at ten times that.
create index if not exists postings_tx_key
  on reporting.postings (client_id, journal_code, journal_no, batch_no, posted_on, reference);

create or replace function reporting.cash_direct(p_client bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'reporting', 'public'
as $function$
declare
  v_ep date;
  v_out jsonb;
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select min(period_month) into v_ep from postings where client_id = p_client;
  if v_ep is null then
    return jsonb_build_object('ep', null, 'acc', '[]'::jsonb, 'rd', '[]'::jsonb,
                              'td', '[]'::jsonb, 'jr', '[]'::jsonb, 'd', '[]'::jsonb,
                              'b', '[]'::jsonb, 'c', '[]'::jsonb, 'v', '[]'::jsonb,
                              'r', '[]'::jsonb, 't', '[]'::jsonb, 'j', '[]'::jsonb,
                              'x', '[]'::jsonb);
  end if;

  with mapped as (
    select d.account_code,
           coalesce(o.line_id, d.line_id) as line_id
      from mapping_defaults d
      left join mappings o
        on o.client_id = d.client_id and o.account_code = d.account_code
     where d.client_id = p_client
  ),
  bankacc as (
    select account_code from mapped where line_id in ('B-160', 'B-270')
  ),
  p as (
    select p.id, p.posted_on, p.account_code, p.account_name,
           coalesce(p.reference, '') as ref, coalesce(p.details, '') as det,
           coalesce(p.journal_code, '') as jrn, p.journal_no, p.batch_no,
           round(coalesce(p.debit, 0) - coalesce(p.credit, 0), 2) as v,
           (p.account_code in (select account_code from bankacc)) as is_bank
      from postings p
     where p.client_id = p_client
  ),
  tx as (
    select jrn, journal_no, batch_no, posted_on, ref,
           sum(v) filter (where not is_bank) as other_sum,
           count(*) filter (where not is_bank) as other_n
      from p
     group by 1, 2, 3, 4, 5
  ),
  -- A bank line against each of the other sides of its own transaction,
  -- in proportion to them.
  spread as (
    select b.posted_on,
           b.account_code as bank_code, b.account_name as bank_name,
           o.account_code as contra_code, o.account_name as contra_name,
           round(b.v * o.v / t.other_sum, 2) as v,
           b.ref, b.det, b.jrn, 0 as is_transfer
      from p b
      join tx t
        on t.jrn = b.jrn and t.journal_no is not distinct from b.journal_no
       and t.batch_no is not distinct from b.batch_no
       and t.posted_on = b.posted_on and t.ref = b.ref
      join p o
        on o.jrn = b.jrn and o.journal_no is not distinct from b.journal_no
       and o.batch_no is not distinct from b.batch_no
       and o.posted_on = b.posted_on and o.ref = b.ref
       and not o.is_bank
     where b.is_bank and t.other_n > 0 and t.other_sum <> 0
  ),
  -- and the transactions that never leave the bank accounts.
  moved as (
    select b.posted_on,
           b.account_code as bank_code, b.account_name as bank_name,
           null::text as contra_code, null::text as contra_name,
           b.v, b.ref, b.det, b.jrn, 1 as is_transfer
      from p b
      join tx t
        on t.jrn = b.jrn and t.journal_no is not distinct from b.journal_no
       and t.batch_no is not distinct from b.batch_no
       and t.posted_on = b.posted_on and t.ref = b.ref
     where b.is_bank and (t.other_n = 0 or t.other_sum = 0)
  ),
  all_rows as (select * from spread union all select * from moved),
  acc as (
    select code, min(nm) as nm, (row_number() over (order by code)) - 1 as ix
      from (
        select bank_code as code, coalesce(bank_name, '') as nm from all_rows
        union all
        select contra_code, coalesce(contra_name, '') from all_rows where contra_code is not null
      ) z
     group by code
  ),
  rd as (select k, (row_number() over (order by k)) - 1 as ix
           from (select distinct ref as k from all_rows) z),
  td as (select k, (row_number() over (order by k)) - 1 as ix
           from (select distinct det as k from all_rows) z),
  jr as (select k, (row_number() over (order by k)) - 1 as ix
           from (select distinct jrn as k from all_rows) z),
  ordered as materialized (
    select (row_number() over (order by a.posted_on, a.bank_code, a.contra_code)) as rn,
           (a.posted_on - v_ep) as d,
           ab.ix as bi,
           coalesce(ac.ix, -1) as ci,
           a.v,
           r.ix as ri, t.ix as ti, j.ix as ji,
           a.is_transfer as x
      from all_rows a
      join acc ab on ab.code = a.bank_code
      left join acc ac on ac.code = a.contra_code
      join rd r on r.k = a.ref
      join td t on t.k = a.det
      join jr j on j.k = a.jrn
     where abs(a.v) >= 0.005
  )
  select jsonb_build_object(
    'ep',  to_char(v_ep, 'YYYY-MM-DD'),
    'acc', (select coalesce(jsonb_agg(jsonb_build_array(code, nm) order by ix), '[]') from acc),
    'rd',  (select coalesce(jsonb_agg(k order by ix), '[]') from rd),
    'td',  (select coalesce(jsonb_agg(k order by ix), '[]') from td),
    'jr',  (select coalesce(jsonb_agg(k order by ix), '[]') from jr),
    'd',   (select coalesce(jsonb_agg(d  order by rn), '[]') from ordered),
    'b',   (select coalesce(jsonb_agg(bi order by rn), '[]') from ordered),
    'c',   (select coalesce(jsonb_agg(ci order by rn), '[]') from ordered),
    'v',   (select coalesce(jsonb_agg(v  order by rn), '[]') from ordered),
    'r',   (select coalesce(jsonb_agg(ri order by rn), '[]') from ordered),
    't',   (select coalesce(jsonb_agg(ti order by rn), '[]') from ordered),
    'j',   (select coalesce(jsonb_agg(ji order by rn), '[]') from ordered),
    'x',   (select coalesce(jsonb_agg(x  order by rn), '[]') from ordered)
  ) into v_out;

  return v_out;
end $function$;

comment on function reporting.cash_direct(bigint) is
  'Money in and money out by bank account, each bank posting attributed to the other side of its own transaction (FIX-3 §7). Derived, read-only. See migration 222 for what counts as one transaction and how a split is allocated.';

grant execute on function reporting.cash_direct(bigint) to authenticated;
