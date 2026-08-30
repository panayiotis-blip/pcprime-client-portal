-- =====================================================================
-- Migration 201: VAT, from the ledger
--
-- The VAT section needs no new feed. Every posting already carries its
-- vat_code, vat_rate and vat_amount, and BUILD.md 6.3 says the ledger is
-- what a return should be compared against -- "compare the ledger
-- against the return's period figures", not the other way about. So this
-- computes the boxes from the postings, and the filed return, when one
-- is imported, becomes the thing checked against it.
--
-- The rules, from 6.3, and each is a decision that has been got wrong
-- before:
--
--  * OUTPUT tax is tax on journals whose code begins with S -- SIN, SRT.
--    INPUT tax is everything else. NOT the debit/credit sign: a sales
--    return is a debit on a sales journal and still belongs on the
--    output side, and classifying by sign gets both totals wrong.
--  * The SIDE is decided by the journal; the SIGN within that side is
--    decided by the base. BTMS stores vat_amount positive on both SIN
--    and SRT, so a return taken at face value ADDS to output tax. The
--    base is what distinguishes them -- a sale credits it, a return
--    debits it -- and on A&F's Q2 2026 that is the difference between
--    85.936,28 and the correct 81.580,16.
--  * Reverse-charge codes 7, 9 and R have NO output leg in the journal.
--    The notional output is raised equal to the input tax, which is why
--    a reverse charge nets to nothing and must still appear on both
--    sides rather than being quietly dropped.
--  * Box 1 is output tax on every code EXCEPT 7. Box 2 is output tax on
--    code 7 alone. Box 3 is 1 + 2, box 4 is all input tax, box 5 is
--    3 - 4.
--
-- Quarters follow client_settings.vat_quarter_offset: 0 puts them on
-- Mar/Jun/Sep/Dec, 1 on Jan/Apr/Jul/Oct, 2 on Feb/May/Aug/Nov. A client
-- on a different cycle reported on calendar quarters is a return that
-- covers the wrong three months.
--
-- Output VAT is held negative throughout, as BTMS signs it, and the
-- boxes flip it once at the end. BTMS signs vat_amount itself and it is
-- never re-signed here -- 6.1.
-- =====================================================================

set search_path to reporting, public;

create or replace function vat_figures(p_client bigint)
returns jsonb
language plpgsql stable security definer set search_path = reporting, public as $$
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
           -- Output tax is held negative, as a credit balance. The base
           -- carries the direction: a sale credits it, a return debits it,
           -- and BTMS stores the tax positive on both.
           case when p.journal_code like 'S%'
                then p.vat_amount * (case when p.debit - p.credit > 0 then 1 else -1 end)
                else p.vat_amount
           end as vat_amount
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
           -- The offset shifts the year's quarter boundaries.
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
end $$;

comment on function vat_figures(bigint) is
  'VAT by code by month, and by quarter with the five boxes, computed from the ledger per BUILD.md 6.3. Output tax is decided by the journal code, never by the sign; reverse-charge codes carry a notional output equal to their input.';

revoke all on function vat_figures(bigint) from public;
grant execute on function vat_figures(bigint) to authenticated;
