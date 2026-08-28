-- =====================================================================
-- Migration 192: storage for the reporting platform's evidence copies
--
-- BUILD.md §7: upload -> storage -> parse -> fingerprint -> stage ->
-- commit. The file itself is kept because the PDF is the only export
-- carrying the client's name (§6) and because an import that is ever
-- questioned has to be answerable from the file that produced it.
--
-- Objects are keyed  <client_id>/<feed>/<sha256>.<ext>  so the client a
-- file belongs to is part of its path and can be checked by policy,
-- rather than being implied by whoever uploaded it.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('reporting-imports', 'reporting-imports', false, 52428800)   -- 50 MB
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- The client id is the first path segment. A name that does not start with
-- digits belongs to no client and is reachable by nobody: fail closed.
create or replace function reporting.object_client(name text) returns bigint
language sql immutable as $$
  select case when split_part(name, '/', 1) ~ '^[0-9]+$'
              then split_part(name, '/', 1)::bigint end;
$$;

drop policy if exists reporting_imports_read   on storage.objects;
drop policy if exists reporting_imports_write  on storage.objects;
drop policy if exists reporting_imports_update on storage.objects;
drop policy if exists reporting_imports_delete on storage.objects;

-- Staff only, and only for a client they may see -- the same gate as every
-- reporting table, so a file cannot be reached by a route the tables refuse.
create policy reporting_imports_read on storage.objects
  for select to authenticated
  using (bucket_id = 'reporting-imports'
         and reporting.staff_can_access(reporting.object_client(name)));

create policy reporting_imports_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reporting-imports'
              and reporting.staff_can_access(reporting.object_client(name)));

create policy reporting_imports_update on storage.objects
  for update to authenticated
  using (bucket_id = 'reporting-imports'
         and reporting.staff_can_access(reporting.object_client(name)))
  with check (bucket_id = 'reporting-imports'
              and reporting.staff_can_access(reporting.object_client(name)));

-- Deleting an evidence copy is deliberately allowed only to an owner, since
-- a committed import points at it. Withdrawing an import does not delete it.
create policy reporting_imports_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'reporting-imports'
         and public.is_owner()
         and reporting.staff_can_access(reporting.object_client(name)));

comment on function reporting.object_client is
  'The client id encoded in a reporting-imports object name, or null when the path does not carry one.';
