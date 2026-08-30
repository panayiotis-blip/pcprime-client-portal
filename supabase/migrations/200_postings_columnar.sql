-- =====================================================================
-- Migration 200: the postings, packed the way the template reads them
--
-- The template carries every posting so its transactions, statements and
-- account screens can work offline, and it stores them dictionary-
-- compressed: acc, jrn, td and rd are dictionaries, and a, d, r, t, v and
-- j are one index per posting into them. That is how 84.725 postings fit
-- in a 3,3MB file rather than sixty.
--
-- Building that in the browser meant reading the postings through
-- PostgREST, which applies the policy on postings ONCE PER ROW --
-- 174.026 evaluations of staff_can_access per page, 175 pages -- and the
-- request died on the statement timeout. The same trap the month
-- checklist hit in 195.
--
-- So the packing happens here: the access check runs once, the
-- dictionaries are built by the database, and one call returns the whole
-- structure. Everything else the template needs -- the monthly series per
-- line and per account -- can be rebuilt from this, because the account,
-- the date and the value of every posting are all in it.
--
-- Ordering is fixed by (posted_on, id) and applied once, in the ordinal
-- below. Six aggregates that each sorted for themselves could disagree,
-- and a value landing against another posting's account is precisely the
-- kind of error nothing downstream would catch.
-- =====================================================================

set search_path to reporting, public;

create or replace function postings_columnar(p_client bigint)
returns jsonb
language plpgsql stable security definer set search_path = reporting, public as $$
declare
  v_ep date;
  v_out jsonb;
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select min(period_month) into v_ep from postings where client_id = p_client;
  if v_ep is null then
    return jsonb_build_object('ep', null, 'acc', '[]'::jsonb, 'jrn', '[]'::jsonb,
                              'td', '[]'::jsonb, 'rd', '[]'::jsonb, 'a', '[]'::jsonb,
                              'd', '[]'::jsonb, 'r', '[]'::jsonb, 't', '[]'::jsonb,
                              'v', '[]'::jsonb, 'j', '[]'::jsonb);
  end if;

  with acc as (
    select account_code,
           min(coalesce(account_name, '')) as nm,
           (row_number() over (order by account_code)) - 1 as ix
      from postings where client_id = p_client group by account_code
  ),
  jrn as (
    select coalesce(journal_code, '') as k,
           (row_number() over (order by coalesce(journal_code, ''))) - 1 as ix
      from postings where client_id = p_client group by coalesce(journal_code, '')
  ),
  rd as (
    select coalesce(reference, '') as k,
           (row_number() over (order by coalesce(reference, ''))) - 1 as ix
      from postings where client_id = p_client group by coalesce(reference, '')
  ),
  td as (
    select coalesce(details, '') as k,
           (row_number() over (order by coalesce(details, ''))) - 1 as ix
      from postings where client_id = p_client group by coalesce(details, '')
  ),
  rows_ordered as materialized (
    select (row_number() over (order by p.posted_on, p.id)) as rn,
           a.ix  as ai,
           (p.posted_on - v_ep) as d,
           r.ix  as ri,
           t.ix  as ti,
           round(p.debit - p.credit, 2) as v,
           j.ix  as ji
      from postings p
      join acc a on a.account_code = p.account_code
      join jrn j on j.k = coalesce(p.journal_code, '')
      join rd  r on r.k = coalesce(p.reference, '')
      join td  t on t.k = coalesce(p.details, '')
     where p.client_id = p_client
  )
  select jsonb_build_object(
    'ep',  to_char(v_ep, 'YYYY-MM-DD'),
    'acc', (select coalesce(jsonb_agg(jsonb_build_array(account_code, nm) order by ix), '[]') from acc),
    'jrn', (select coalesce(jsonb_agg(k order by ix), '[]') from jrn),
    'rd',  (select coalesce(jsonb_agg(k order by ix), '[]') from rd),
    'td',  (select coalesce(jsonb_agg(k order by ix), '[]') from td),
    'a',   (select coalesce(jsonb_agg(ai order by rn), '[]') from rows_ordered),
    'd',   (select coalesce(jsonb_agg(d  order by rn), '[]') from rows_ordered),
    'r',   (select coalesce(jsonb_agg(ri order by rn), '[]') from rows_ordered),
    't',   (select coalesce(jsonb_agg(ti order by rn), '[]') from rows_ordered),
    'v',   (select coalesce(jsonb_agg(v  order by rn), '[]') from rows_ordered),
    'j',   (select coalesce(jsonb_agg(ji order by rn), '[]') from rows_ordered)
  ) into v_out;

  return v_out;
end $$;

comment on function postings_columnar(bigint) is
  'Every posting for one client, dictionary-compressed the way the reporting template stores them. Checks staff_can_access once rather than once per posting.';

revoke all on function postings_columnar(bigint) from public;
grant execute on function postings_columnar(bigint) to authenticated;
