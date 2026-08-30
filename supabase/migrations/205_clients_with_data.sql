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
-- staff_can_access is applied per client rather than once, because this
-- one function answers for all of them at once and must not hand back a
-- client the caller could not otherwise see.
-- =====================================================================

set search_path to reporting, public;

create or replace function clients_with_data()
returns table (client_id bigint, client_name text, postings bigint)
language sql stable security definer set search_path = reporting, public as $$
  select p.client_id,
         coalesce(s.report_name, c.name) as client_name,
         count(*) as postings
    from postings p
    join public.clients c on c.id = p.client_id
    left join client_settings s on s.client_id = p.client_id
   where staff_can_access(p.client_id)
   group by p.client_id, coalesce(s.report_name, c.name)
   order by 2;
$$;

comment on function clients_with_data() is
  'The clients with postings, for the reporting template''s own client list. A client with nothing loaded is not offered: a name leading to an empty report is worse than no name.';

revoke all on function clients_with_data() from public;
grant execute on function clients_with_data() to authenticated;
