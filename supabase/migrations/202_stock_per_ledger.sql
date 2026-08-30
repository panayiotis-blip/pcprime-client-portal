-- =====================================================================
-- Migration 202: what the ledger says stock is worth, at a date
--
-- §6.6 wants the valuation compared with the stock account, and the
-- comparison is worthless if the ledger side is wrong. It was.
--
-- The ledger holds no opening balances -- 3999 TAKE ON BALANCES has no
-- postings and the first posting is 1 January 2021 -- so summing the
-- postings gives MOVEMENT SINCE 2021, not a position. On A&F that made
-- stock at 31 January 2026 read 163.302,62 against a counted 483.448,63:
-- a difference of 320.146,01 that was nothing but the missing opening.
-- The real difference is -19.628,19.
--
-- The opening is derivable, and the balance sheet already derives it the
-- same way:
--
--     opening  = trial balance closing - movement up to that month
--     position = opening + movement up to the date asked for
--
-- It lives here, in one place, rather than in each caller that needs it.
-- The payload builder had this derivation and the stock import did not,
-- which is precisely how one of the two came to be wrong.
--
-- Without a trial balance there is no opening to derive and the answer is
-- movement, not position. has_opening says which, so a screen can state
-- it rather than imply a position it does not have.
-- =====================================================================

set search_path to reporting, public;

-- Which accounts are on the stock line. The drafted default, then any
-- override -- and an override can move an account ONTO the line or off
-- it, so both directions matter. Reading only the defaults values stock
-- at whatever it used to be mapped to.
--
-- One definition, used by the function below and by the backfill at the
-- end of this file, because two of them would eventually disagree.
create or replace function stock_line_codes(p_client bigint)
returns setof text
language sql stable as $$
  select d.account_code
    from mapping_defaults d
    left join mappings m on m.client_id = d.client_id and m.account_code = d.account_code
   where d.client_id = p_client
     and coalesce(m.line_id, d.line_id) = 'B-110'
  union
  select m.account_code
    from mappings m
   where m.client_id = p_client and m.line_id = 'B-110';
$$;

comment on function stock_line_codes(bigint) is
  'The account codes reported on the stock line for one client, defaults with overrides applied in both directions.';

create or replace function stock_per_ledger(p_client bigint, p_at date)
returns table (value numeric, has_opening boolean, opening numeric, movement numeric)
language plpgsql stable security definer set search_path = reporting, public as $$
declare
  v_month     date := date_trunc('month', p_at)::date;
  v_tb_month  date;
  v_opening   numeric := 0;
  v_has       boolean := false;
  v_movement  numeric := 0;
  v_codes     text[];
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select coalesce(array_agg(code), '{}') into v_codes from stock_line_codes(p_client) as code;

  select max(t.period_month) into v_tb_month
    from trial_balance t
   where t.client_id = p_client and not t.is_annual and not t.detailed;

  if v_tb_month is not null then
    v_has := true;
    select coalesce(sum(t.closing), 0) into v_opening
      from trial_balance t
     where t.client_id = p_client and t.period_month = v_tb_month
       and not t.is_annual and not t.detailed
       and t.account_code = any(v_codes);

    v_opening := v_opening - coalesce((
      select sum(p.debit - p.credit) from postings p
       where p.client_id = p_client and p.period_month <= v_tb_month
         and p.account_code = any(v_codes)), 0);
  end if;

  select coalesce(sum(p.debit - p.credit), 0) into v_movement
    from postings p
   where p.client_id = p_client and p.period_month <= v_month
     and p.account_code = any(v_codes);

  value := round(v_opening + v_movement, 2);
  has_opening := v_has;
  opening := round(v_opening, 2);
  movement := round(v_movement, 2);
  return next;
end $$;

comment on function stock_per_ledger(bigint, date) is
  'What the ledger carries on the stock line at a date: the opening derived from the trial balance plus the movement to that date. has_opening is false when no trial balance exists, in which case the figure is movement, not position.';

revoke all on function stock_per_ledger(bigint, date) from public;
grant execute on function stock_per_ledger(bigint, date) to authenticated;
grant execute on function stock_line_codes(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- The valuations already imported were stored against movement alone.
-- Correct them, so the difference on record is the real one.
--
-- Written out rather than calling stock_per_ledger, for two reasons: an
-- UPDATE cannot reference its own target from a LATERAL, and that
-- function checks staff_can_access, which has no answer when a migration
-- runs from a SQL editor with nobody signed in.
-- ---------------------------------------------------------------------
update stock_valuations s
   set ledger_value = round(
     coalesce((select coalesce(sum(t.closing), 0)
                 from trial_balance t
                where t.client_id = s.client_id
                  and not t.is_annual and not t.detailed
                  and t.period_month = (select max(period_month) from trial_balance
                                         where client_id = s.client_id
                                           and not is_annual and not detailed)
                  and t.account_code in (select stock_line_codes(s.client_id))), 0)
   - coalesce((select sum(p.debit - p.credit) from postings p
                where p.client_id = s.client_id
                  and p.period_month <= (select max(period_month) from trial_balance
                                          where client_id = s.client_id
                                            and not is_annual and not detailed)
                  and p.account_code in (select stock_line_codes(s.client_id))), 0)
   + coalesce((select sum(p.debit - p.credit) from postings p
                where p.client_id = s.client_id
                  and p.period_month <= date_trunc('month', s.valued_at)::date
                  and p.account_code in (select stock_line_codes(s.client_id))), 0), 2)
 where exists (select 1 from trial_balance t
                where t.client_id = s.client_id and not t.is_annual and not t.detailed);
