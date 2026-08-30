-- =====================================================================
-- Migration 206: where a client's books actually are
--
-- Not every client is on BTMS, and of those that are, some are kept on
-- our own installation and some on the client's. Others are on something
-- else entirely, and what that something is matters to whoever picks the
-- work up next.
--
-- 205 offered only clients with postings, on the reasoning that a name
-- leading to an empty report is worse than no name. That was my
-- judgement substituting for a decision that is Pete's: he wants every
-- client he has marked as ours to be in the list, whether or not the
-- data has been loaded yet, because the list is how he sees what is
-- still to do.
--
-- So the list is driven by a stated fact rather than by what happens to
-- have been imported:
--
--   btms_local   the books are on our BTMS installation
--   btms_client  the books are on the client's own BTMS
--   other        another program, named in other_program
--   none         not reported on (the default)
--
-- The reporting application offers the two BTMS kinds. A client on
-- another program is recorded, with the program named, so nobody has to
-- ask again -- but it is not offered, because there is no feed for it.
-- =====================================================================

set search_path to reporting, public;

alter table client_settings
  add column if not exists data_source text not null default 'none',
  add column if not exists other_program text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'client_settings_data_source_check'
       and conrelid = 'reporting.client_settings'::regclass
  ) then
    alter table client_settings
      add constraint client_settings_data_source_check
      check (data_source in ('none', 'btms_local', 'btms_client', 'other'));
  end if;
end $$;

comment on column client_settings.data_source is
  'Where this client''s books are kept: btms_local (our BTMS), btms_client (the client''s BTMS), other (named in other_program), none. The reporting application offers the two BTMS kinds.';
comment on column client_settings.other_program is
  'What the books are kept in when data_source is other. Recorded so nobody has to ask again.';

-- A&F is on our own installation, and is the only client whose books
-- have actually been loaded. Everything else stays 'none' until somebody
-- says otherwise: guessing on 62 clients would be a list of claims
-- nobody made.
update client_settings s
   set data_source = 'btms_local'
  from public.clients c
 where c.id = s.client_id
   and s.data_source = 'none'
   and c.name ilike '%ΗΛΕΚΤΡΑΓΟΡΑ%';

-- ---------------------------------------------------------------------
-- What the reporting template's client list is built from. Replaces
-- clients_with_data, which asked the wrong question.
-- ---------------------------------------------------------------------
create or replace function clients_for_reporting()
returns table (client_id bigint, client_name text, data_source text, postings bigint)
language sql stable security definer set search_path = reporting, public as $$
  -- The counting is materialised so that staff_can_access is asked once
  -- per client rather than once per posting. Flattened, the planner
  -- pushes it inside the scan and the request dies on the statement
  -- timeout -- which it did, on 174.026 rows, for one client.
  with counts as materialized (
    select p.client_id, count(*) as n from postings p group by p.client_id
  )
  select s.client_id,
         coalesce(s.report_name, c.name) as client_name,
         s.data_source,
         coalesce(z.n, 0) as postings
    from client_settings s
    join public.clients c on c.id = s.client_id
    left join counts z on z.client_id = s.client_id
   where s.data_source in ('btms_local', 'btms_client')
     and c.deleted_at is null
     and staff_can_access(s.client_id)
   order by 2;
$$;

comment on function clients_for_reporting() is
  'The clients the reporting application offers: those whose books are on BTMS, ours or the client''s, whether or not anything has been imported yet. A client with no postings appears with nothing behind it, which is how the list shows what is still to do.';

revoke all on function clients_for_reporting() from public;
grant execute on function clients_for_reporting() to authenticated;
