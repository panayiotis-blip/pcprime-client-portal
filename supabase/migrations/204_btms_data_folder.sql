-- =====================================================================
-- Migration 204: a BTMS data folder, in the portal, per client
--
-- The exports have to live somewhere, and the portal already knows how to
-- hold a client's files: public.folders, public.documents, and a private
-- documents bucket, all client-scoped by the same access model as
-- everything else.
--
-- Putting the BTMS exports there rather than in a folder on one machine
-- settles several things at once:
--
--   * The folder IS the client. Nothing is typed, so nothing is
--     mistyped, and one client's ledger cannot land under another's --
--     which is what the BTMS company code was for, and what no BTMS
--     export actually carries.
--   * It works from any machine, and it is backed up with everything
--     else, rather than living on whichever laptop did the import.
--   * documents.year and documents.month already exist, which is exactly
--     where the two dates no BTMS file contains -- the trial balance
--     period and the stock count date -- can be asked for at upload and
--     kept with the file.
--
-- The folder is created on demand rather than for all 249 clients: a
-- client with no BTMS data has no use for an empty folder, and 63 are
-- marked as reported today.
-- =====================================================================

set search_path to public;

create or replace function btms_data_folder(p_client bigint)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_id bigint;
begin
  -- The portal's own access model decides whether this client may be
  -- touched at all; this function adds nothing to it and defers entirely.
  if not user_can_access_client(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select id into v_id
    from folders
   where client_id = p_client and category_key = 'btms'
   order by id
   limit 1;

  if v_id is null then
    insert into folders (client_id, parent_id, name, category_key, is_system)
    values (p_client, null, 'BTMS data', 'btms', true)
    returning id into v_id;
  end if;

  return v_id;
end $$;

comment on function btms_data_folder(bigint) is
  'The client''s BTMS data folder, created the first time it is asked for. Where the BTMS exports live, so that the folder identifies the client and nothing has to be typed into a file name.';

grant execute on function btms_data_folder(bigint) to authenticated;
