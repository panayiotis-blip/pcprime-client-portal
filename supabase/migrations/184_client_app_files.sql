-- =============================================================
-- Migration 184: files for embedded client apps
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- WHY. The rentals app kept every uploaded contract as a base64 dataUrl inside its
-- own JSON document (client_app_data.data). Fifteen agreements took Greson Easy
-- Loo's document to 23 MB, and because the app re-posts the whole document on
-- every save, both writes AND reads began returning 500 from PostgREST — the
-- database was fine, the REST layer could not marshal 23 MB. Saving stopped
-- working entirely on 2026-08-21 at 04:44 UTC.
--
-- A document is a document, not a filing cabinet. Files now live in Storage and
-- the app keeps only a reference: { name, path, size, uploaded }. That takes the
-- document back to ~200 kB and removes the ceiling rather than raising it.
--
-- LAYOUT. <client_id>/<app_key>/<uuid>.<ext> — the first folder is the client,
-- so one client's contracts can never be addressed by another. The edge function
-- app-files re-checks that prefix on every operation; this policy is the second
-- lock, not the only one.
--
-- WHO REACHES WHAT. Reads are gated by user_can_access_client, which covers firm
-- staff and the client's own portal users. There is deliberately NO write or
-- delete policy: app-only client users hold an opaque HMAC session, not a
-- Supabase JWT, so RLS cannot see them at all — every mutation is brokered by
-- app-files with the service role after it has verified that session. Adding a
-- write policy here would authorise a second, weaker path to the same objects.
-- =============================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('client-app-files', 'client-app-files', false, 26214400)  -- 25 MB/file
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "client-app-files read" on storage.objects;
create policy "client-app-files read" on storage.objects
  for select using (
    bucket_id = 'client-app-files'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

commit;

-- =============================================================
-- Verify:
--   select id, public, file_size_limit from storage.buckets where id = 'client-app-files';
--   select policyname from pg_policies
--    where tablename = 'objects' and policyname like 'client-app-files%';
-- =============================================================
-- End of migration 184.
-- =============================================================
