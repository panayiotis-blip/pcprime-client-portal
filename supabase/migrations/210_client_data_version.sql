-- =====================================================================
-- Migration 210: has this client's data moved?
--
-- Pete, on signing in for the second time:
--
--   "the first time we load the client and the data i can understand,
--    but then when i log in why does it need to recheck the data, only
--    if i upload new data and then the delay is understandable."
--
-- He is right. Building A&F's report reads 174.026 postings and rebuilds
-- every statement from them, and that was being paid on every sign-in --
-- in truth on every TAB, because the built result was held in a module
-- variable that dies with the page. Reloading paid it again. Opening a
-- second tab paid it again. For data that had not changed by a single
-- row.
--
-- What was missing is a cheap way to ask "is what I have still current?".
-- This is that: a short string that changes when the client's data
-- changes and does not when it has not. The application keeps the built
-- report against this stamp and rebuilds only when it differs.
--
-- What it is built from, and why not simply counting rows: count(*) over
-- 174.026 postings is itself slow enough to be part of the problem --
-- the first attempt at this timed out. Every change to a client's
-- figures arrives through an import, and reporting.imports holds a few
-- dozen rows, so the imports are the signal. The mapping is included
-- separately because it can be changed in the application without any
-- import, and changing it changes every report.
--
-- 13ms for A&F against roughly ninety seconds of rebuilding.
-- =====================================================================

set search_path to reporting, public;

create or replace function client_data_version(p_client bigint)
returns text
language plpgsql stable security definer set search_path = reporting, public as $$
declare
  v text;
begin
  if not staff_can_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select md5(concat_ws('|',
    -- Every import, with its status and when it was committed. Covers the
    -- ledger, the trial balances, the chart, stock and payroll: a new file,
    -- a withdrawn one or a re-commit all move this.
    (select coalesce(md5(string_agg(
              id::text || ':' || status::text || ':' || coalesce(committed_at::text, ''),
              ',' order by id)), '')
       from imports where client_id = p_client),

    -- The mapping can be changed by hand, with no import behind it, and it
    -- decides which line every account lands on.
    (select coalesce(md5(string_agg(
              account_code || '>' || coalesce(line_id, ''), ',' order by account_code)), '')
       from mappings where client_id = p_client),
    (select coalesce(md5(string_agg(
              account_code || '>' || coalesce(line_id, ''), ',' order by account_code)), '')
       from mapping_defaults where client_id = p_client),

    -- Belt and braces: the feed rows move whenever anything is loaded.
    (select coalesce(max(uploaded_at)::text, '') from feed_status where client_id = p_client)
  )) into v;

  return v;
end $$;

comment on function client_data_version(bigint) is
  'A short stamp that changes when this client''s reportable data changes. The application holds the built report against it and rebuilds only when it differs, so signing in a second time is instant. Built from the imports and the mapping rather than from row counts: counting 174.026 postings is itself slow enough to be part of the problem.';

revoke all on function client_data_version(bigint) from public;
grant execute on function client_data_version(bigint) to authenticated;
