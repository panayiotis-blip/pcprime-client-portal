-- =====================================================================
-- Migration 205: which clients have something to report on
--
-- The template opens on its own sign-in with a client dropdown, and that
-- is the design: 4 says its layout and wording are the specification,
-- and a chooser of mine in front of it was a second front door to the
-- same building. This is what fills the template's own list.
--
-- Only clients with postings. A client marked as reported but with
-- nothing loaded would be a name in a dropdown leading to an empty
-- report, which is worse than not being offered at all -- 63 clients are
-- marked as reported today and one has data.
--
-- staff_can_access is applied per client, and AFTER the grouping. Inside
-- the scan it is evaluated once per posting -- 174.026 times for a single
-- client -- and the request dies on the statement timeout. That is the
-- fourth time in this build that a policy function has been called per row
-- when it needed calling per client: 195, 200, the review engine, and this.
-- =====================================================================

set search_path to reporting, public;

create or replace function clients_with_data()
returns table (client_id bigint, client_name text, postings bigint)
language sql stable security definer set search_path = reporting, public as $$
  -- Count first, THEN ask who may see what. Filtering inside the scan called
  -- staff_can_access once per posting -- 174.026 times for one client -- and
  -- died on the statement timeout. Grouped first it is asked once per client,
  -- which is a handful.
  select z.client_id,
         coalesce(s.report_name, c.name) as client_name,
         z.n as postings
    from (select p.client_id, count(*) as n from postings p group by p.client_id) z
    join public.clients c on c.id = z.client_id
    left join client_settings s on s.client_id = z.client_id
   where staff_can_access(z.client_id)
   order by 2;
$$;

comment on function clients_with_data() is
  'The clients with postings, for the reporting template''s own client list. A client with nothing loaded is not offered: a name leading to an empty report is worse than no name.';

revoke all on function clients_with_data() from public;
grant execute on function clients_with_data() to authenticated;
