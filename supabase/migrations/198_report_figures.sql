-- =====================================================================
-- Migration 198: the report engine
--
-- Turns postings into the 87 lines of the master report, for a period and
-- for whatever is compared against it. P3 rests on this; so does the
-- reconciliation in P5.
--
-- Four things happen, in this order, and each is a decision worth stating:
--
-- 1. ROLL UP. A posting lands on 22104226, a customer. It is reported on
--    221, the debtor control. coa_accounts.control_code carries that, put
--    there by the chart import from the account TYPE -- never from the
--    code, because 31100034 is a supplier and so is 31100.
--
-- 2. MAP. The line is the override if a person set one, otherwise the
--    default. Same rule the Account mapping screen shows, in one place.
--
-- 3. SIGN. Everything is held debit-positive. A report shows sales and
--    creditors as positive numbers, so the sign flips for the sections
--    that are credit-natured by nature -- revenue, other income, and
--    every liability and equity section. Within a section the sign does
--    NOT flip per account: accumulated depreciation stays negative
--    inside non-current assets, and an overdrawn bank stays negative
--    inside current assets, which is how they are meant to read.
--
-- 4. PERIOD. A profit and loss line is the movement between two dates.
--    A balance sheet line is the position at the later of them -- every
--    posting up to and including it. Treating both the same way is the
--    classic way to produce a balance sheet that does not balance.
--
-- B-640 is a plug and is written down as one
--
-- 'Prior year results not yet transferred' is not summed from accounts.
-- It is whatever makes net assets equal total equity. That is why the
-- draft's net-assets check comes out at nil: it cannot do anything else.
-- The check is worth showing because it proves the arithmetic above it,
-- but it is NOT evidence that the books balance -- A&F's trial balance
-- is out by 64.155,94 at FY2025 and 145.679,88 at 07/2026, and this line
-- is where that residual is parked, visibly, instead of being spread
-- silently across the statement. The review engine in P5 is what has to
-- challenge it.
--
-- Security definer with the access check as the first statement, the
-- same as commit_ledger_import and ledger_months: the policy on postings
-- would otherwise be evaluated once per posting, and there are 174.026
-- of them.
-- =====================================================================

set search_path to reporting, public;

create or replace function report_figures(p_client bigint, p_from date, p_to date)
returns table (
  line_id     text,
  statement   text,
  section     text,
  line_name   text,
  sort_order  integer,
  is_subtotal boolean,
  amount      numeric
)
language plpgsql stable security definer set search_path = reporting, public as $$
declare
  v_amount  jsonb := '{}'::jsonb;
  v_line    record;
  a         numeric;
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  -- ---- the detail lines -------------------------------------------
  -- Credit-natured sections are flipped so the report reads the way a
  -- reader expects. Everything else stays debit-positive.
  with acct as (
    select c.code, coalesce(nullif(c.control_code, ''), c.code) as report_code
      from coa_accounts c where c.client_id = p_client
  ),
  eff as (
    select d.account_code, coalesce(m.line_id, d.line_id) as line_id
      from mapping_defaults d
      left join mappings m
        on m.client_id = d.client_id and m.account_code = d.account_code
     where d.client_id = p_client
  ),
  lines as (
    select rl.line_id, rl.statement, rl.section
      from report_lines rl
      join templates t on t.id = rl.template_id
     where t.client_id is null and t.kind = 'report_lines'
  ),
  movement as (
    select e.line_id, sum(p.debit - p.credit) as net
      from postings p
      join acct a on a.code = p.account_code
      join eff  e on e.account_code = a.report_code
      join lines l on l.line_id = e.line_id
     where p.client_id = p_client
       and (
         -- profit and loss: the movement in the period
         (l.statement = 'pl' and p.period_month between p_from and p_to)
         -- balance sheet: the position at the end of it
         or (l.statement = 'bs' and p.period_month <= p_to)
       )
     group by e.line_id
  )
  select jsonb_object_agg(
           m.line_id,
           case when (l.statement = 'pl' and l.section in ('Revenue', 'Other income'))
                  or (l.statement = 'bs' and l.section in ('Current liabilities',
                                                           'Non-current liabilities', 'Equity'))
                then -m.net else m.net end)
    into v_amount
    from movement m join lines l on l.line_id = m.line_id;

  v_amount := coalesce(v_amount, '{}'::jsonb);

  -- ---- section subtotals ------------------------------------------
  for v_line in
    select rl.section, rl.statement, rl.line_id as total_line
      from report_lines rl join templates t on t.id = rl.template_id
     where t.client_id is null and rl.is_subtotal
       and rl.line_id in ('P-099','P-199','P-399','P-499','P-699','P-799',
                          'B-099','B-199','B-299','B-499')
  loop
    select coalesce(sum((v_amount ->> rl.line_id)::numeric), 0) into a
      from report_lines rl join templates t on t.id = rl.template_id
     where t.client_id is null and rl.section = v_line.section
       and rl.statement = v_line.statement
       and not rl.is_subtotal and not rl.is_derived
       and v_amount ? rl.line_id;
    v_amount := jsonb_set(v_amount, array[v_line.total_line], to_jsonb(a));
  end loop;

  -- ---- the figures that are arithmetic, not sums -------------------
  a := coalesce((v_amount ->> 'P-099')::numeric, 0) - coalesce((v_amount ->> 'P-199')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{P-200}', to_jsonb(a));

  a := coalesce((v_amount ->> 'P-200')::numeric, 0)
     + coalesce((v_amount ->> 'P-399')::numeric, 0)
     - coalesce((v_amount ->> 'P-499')::numeric, 0)
     - coalesce((v_amount ->> 'P-699')::numeric, 0)
     - coalesce((v_amount ->> 'P-799')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{P-800}', to_jsonb(a));

  a := coalesce((v_amount ->> 'P-800')::numeric, 0)
     - coalesce((v_amount ->> 'P-810')::numeric, 0)
     - coalesce((v_amount ->> 'P-820')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{P-900}', to_jsonb(a));

  a := coalesce((v_amount ->> 'B-199')::numeric, 0) - coalesce((v_amount ->> 'B-299')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{B-300}', to_jsonb(a));

  a := coalesce((v_amount ->> 'B-099')::numeric, 0)
     + coalesce((v_amount ->> 'B-300')::numeric, 0)
     - coalesce((v_amount ->> 'B-499')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{B-500}', to_jsonb(a));

  -- The period's result, carried onto the balance sheet.
  v_amount := jsonb_set(v_amount, '{B-650}', to_jsonb(coalesce((v_amount ->> 'P-900')::numeric, 0)));

  -- The plug. See the note at the head of this file: this is what makes
  -- the net-assets check nil, so the check proves the arithmetic and not
  -- the books.
  a := coalesce((v_amount ->> 'B-500')::numeric, 0)
     - coalesce((v_amount ->> 'B-610')::numeric, 0)
     - coalesce((v_amount ->> 'B-620')::numeric, 0)
     - coalesce((v_amount ->> 'B-630')::numeric, 0)
     - coalesce((v_amount ->> 'B-650')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{B-640}', to_jsonb(a));

  a := coalesce((v_amount ->> 'B-610')::numeric, 0)
     + coalesce((v_amount ->> 'B-620')::numeric, 0)
     + coalesce((v_amount ->> 'B-630')::numeric, 0)
     + coalesce((v_amount ->> 'B-640')::numeric, 0)
     + coalesce((v_amount ->> 'B-650')::numeric, 0);
  v_amount := jsonb_set(v_amount, '{B-699}', to_jsonb(a));

  -- Every line, in order, including the ones that came to nothing.
  return query
    select rl.line_id, rl.statement, rl.section, rl.line_name, rl.sort_order, rl.is_subtotal,
           round(coalesce((v_amount ->> rl.line_id)::numeric, 0), 2)
      from report_lines rl
      join templates t on t.id = rl.template_id
     where t.client_id is null and t.kind = 'report_lines'
     order by rl.sort_order;
end $$;

comment on function report_figures(bigint, date, date) is
  'The master report lines valued for one client: P&L as the movement between two months, balance sheet as the position at the later one. Checks staff_can_access once rather than once per posting.';

revoke all on function report_figures(bigint, date, date) from public;
grant execute on function report_figures(bigint, date, date) to authenticated;
