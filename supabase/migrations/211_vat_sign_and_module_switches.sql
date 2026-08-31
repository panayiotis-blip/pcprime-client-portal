-- =====================================================================
-- 211: two faults found on the live build
--
-- 1. vat_figures overstated input tax. On a non-sales journal it took
--    vat_amount as BTMS stores it -- always positive -- so a purchase
--    return (PRT) ADDED to box 4 instead of reducing it. On A&F Q2 2026
--    that put box 4 at 68.269,67 against a true 64.100,43, understating
--    the VAT payable by 4.169,04.
--
--    The base line already carries the direction: a purchase debits it,
--    a purchase return credits it, a sale credits it, a sales return
--    debits it. So take the magnitude of the tax and let the base decide
--    the sign, on both sides of the return. abs() also protects the one
--    A&F line where BTMS itself stored the tax negative.
--
-- 2. has_stock and has_payroll were false for a client whose stock
--    valuations and payroll had already been imported, so both screens
--    were dead with the data sitting behind them. Backfilled, and a
--    trigger keeps them true from now on -- a switch a person has to
--    remember is a switch that gets forgotten.
--
-- Applied to the live project 2026-09; box 1, 2 and 3 for A&F Q2 2026
-- still agree with the filed return to the cent (82.324,60 / 9.424,47 /
-- 91.749,07) and box 4 now reads 64.100,43.
-- =====================================================================

set search_path to reporting, public;

create or replace function vat_figures(p_client bigint)
returns jsonb
language plpgsql stable security definer set search_path = reporting, public as $function$
declare
  v_offset smallint;
  v_out jsonb;
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select coalesce(vat_quarter_offset, 0) into v_offset
    from client_settings where client_id = p_client;
  v_offset := coalesce(v_offset, 0);

  with base as (
    select p.period_month,
           p.vat_code as code,
           -- The journal decides the side, never the sign.
           (p.journal_code like 'S%') as is_output,
           p.debit - p.credit as amount,
           -- The BASE decides the direction, on both sides. Output tax is
           -- held negative, as a credit balance: a sale credits the base
           -- and the tax goes negative, a sales return debits it and the
           -- tax comes back positive. A purchase debits, a purchase return
           -- credits, and input tax follows the same rule.
           abs(p.vat_amount) * (case when p.debit - p.credit >= 0 then 1 else -1 end)
             as vat_amount
      from postings p
     where p.client_id = p_client
       and p.vat_code is not null and p.vat_code <> ''
  ),
  -- Reverse charge: no output leg exists, so raise one equal to the input.
  -- 7 lands in box 2; 9 and R land in box 1 with everything else, which is
  -- what takes A&F's Q2 2026 box 1 from 81.580,16 to its filed 82.324,60.
  with_notional as (
    select period_month, code, is_output, amount, vat_amount from base
    union all
    select period_month, code, true, 0, -vat_amount
      from base
     where not is_output and code in ('7', '9', 'R') and vat_amount <> 0
  ),
  monthly as (
    select to_char(period_month, 'YYYY-MM') as m, code,
           round(sum(vat_amount), 2) as v
      from with_notional group by 1, 2
  ),
  quartered as (
    select code, is_output, amount, vat_amount,
           extract(year from (period_month - (v_offset || ' months')::interval))::int as qy,
           floor((extract(month from (period_month - (v_offset || ' months')::interval))::int - 1) / 3)::int + 1 as qn
      from with_notional
  ),
  percode as (
    select qy, qn, code,
           round(sum(amount)     filter (where is_output), 2)     as ob,
           round(sum(vat_amount) filter (where is_output), 2)     as ov,
           round(sum(amount)     filter (where not is_output), 2) as ib,
           round(sum(vat_amount) filter (where not is_output), 2) as iv,
           count(*) filter (where is_output)     as onn,
           count(*) filter (where not is_output) as inn
      from quartered group by qy, qn, code
  ),
  boxes as (
    select qy, qn,
           round(-sum(coalesce(ov, 0)) filter (where code <> '7'), 2) as box1,
           round(-sum(coalesce(ov, 0)) filter (where code =  '7'), 2) as box2,
           round( sum(coalesce(iv, 0)), 2)                            as box4
      from percode group by qy, qn
  )
  select jsonb_build_object(
    'monthly', coalesce((
      select jsonb_object_agg(m, codes) from (
        select m, jsonb_object_agg(code, v) as codes from monthly group by m
      ) z), '{}'::jsonb),
    'quarters', coalesce((
      select jsonb_agg(q order by q->>'q')
        from (
          select jsonb_build_object(
                   'q', b.qy || ' Q' || b.qn,
                   'codes', (select jsonb_object_agg(pc.code, jsonb_build_object(
                                      'ob', coalesce(pc.ob, 0), 'ov', coalesce(pc.ov, 0),
                                      'ib', coalesce(pc.ib, 0), 'iv', coalesce(pc.iv, 0),
                                      'on', pc.onn, 'in', pc.inn))
                               from percode pc where pc.qy = b.qy and pc.qn = b.qn),
                   'box1', coalesce(b.box1, 0),
                   'box2', coalesce(b.box2, 0),
                   'box3', coalesce(b.box1, 0) + coalesce(b.box2, 0),
                   'box4', coalesce(b.box4, 0),
                   'box5', coalesce(b.box1, 0) + coalesce(b.box2, 0) - coalesce(b.box4, 0)
                 ) as q
            from boxes b
        ) z), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $function$;

-- ---------------------------------------------------------------------
-- The module switches follow the data
-- ---------------------------------------------------------------------

update client_settings s set has_stock = true, updated_at = now()
 where not s.has_stock
   and exists (select 1 from stock_valuations v where v.client_id = s.client_id);

update client_settings s set has_payroll = true, updated_at = now()
 where not s.has_payroll
   and exists (select 1 from payroll_periods p where p.client_id = s.client_id);

create or replace function _switch_on_stock() returns trigger
language plpgsql security definer set search_path = reporting, public as $$
begin
  update client_settings set has_stock = true, updated_at = now()
   where client_id = new.client_id and not has_stock;
  return new;
end $$;

create or replace function _switch_on_payroll() returns trigger
language plpgsql security definer set search_path = reporting, public as $$
begin
  update client_settings set has_payroll = true, updated_at = now()
   where client_id = new.client_id and not has_payroll;
  return new;
end $$;

drop trigger if exists stock_switches_itself_on on stock_valuations;
create trigger stock_switches_itself_on
  after insert on stock_valuations
  for each row execute function _switch_on_stock();

drop trigger if exists payroll_switches_itself_on on payroll_periods;
create trigger payroll_switches_itself_on
  after insert on payroll_periods
  for each row execute function _switch_on_payroll();
