-- =============================================================
-- Migration 019: KYC documents in a dedicated, more-restricted bucket
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- What this does:
--   1. New private storage bucket `kyc-documents` for new KYC uploads.
--      (Existing KYC files in `documents` bucket stay there — RLS below
--       gates them via the documents-table category instead.)
--   2. New documents.storage_bucket column so the app knows which
--      bucket to read from per row.
--   3. Two new permissions: kyc.read and kyc.write.
--      Defaults:
--        Owner / Supervisor: read + write
--        Client:             read only (sees own client's KYC if linked)
--        Admin / Staff:      none (must be granted per-user)
--   4. Restrictive RLS on documents-table rows where category='kyc' —
--      gated by has_permission('kyc.read') / has_permission('kyc.write').
--   5. Storage RLS on kyc-documents bucket — same permission gates.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Create the bucket (private)
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do nothing;

-- -------------------------------------------------------------
-- 2. documents.storage_bucket column
-- -------------------------------------------------------------
alter table public.documents
  add column if not exists storage_bucket text not null default 'documents';

-- -------------------------------------------------------------
-- 3. New permissions in the defaults catalog
-- -------------------------------------------------------------
insert into public.role_permission_defaults (role, permission) values
  ('owner',      'kyc.read'),
  ('owner',      'kyc.write'),
  ('supervisor', 'kyc.read'),
  ('supervisor', 'kyc.write'),
  ('client',     'kyc.read')
on conflict (role, permission) do nothing;

-- -------------------------------------------------------------
-- 4. Restrictive RLS on documents-table rows where category='kyc'
--    Restrictive policies are AND-combined with permissive ones, so
--    these AND on top of the existing 'documents select' / 'documents
--    insert' / 'documents update' policies.
-- -------------------------------------------------------------
drop policy if exists "documents kyc select restrict" on public.documents;
create policy "documents kyc select restrict" on public.documents
  as restrictive
  for select
  using (category != 'kyc' or public.has_permission('kyc.read'));

drop policy if exists "documents kyc insert restrict" on public.documents;
create policy "documents kyc insert restrict" on public.documents
  as restrictive
  for insert
  with check (category != 'kyc' or public.has_permission('kyc.write'));

drop policy if exists "documents kyc update restrict" on public.documents;
create policy "documents kyc update restrict" on public.documents
  as restrictive
  for update
  using       (category != 'kyc' or public.has_permission('kyc.write'))
  with check  (category != 'kyc' or public.has_permission('kyc.write'));

-- -------------------------------------------------------------
-- 5. Storage RLS on the kyc-documents bucket
--    Path format mirrors documents bucket: {client_id}/{...}/{filename}
--    so we still use first-segment-as-client-id for the linked-client
--    check. PLUS the kyc.read / kyc.write permission gate.
-- -------------------------------------------------------------
drop policy if exists "kyc-documents-bucket read"   on storage.objects;
drop policy if exists "kyc-documents-bucket write"  on storage.objects;
drop policy if exists "kyc-documents-bucket update" on storage.objects;
drop policy if exists "kyc-documents-bucket delete" on storage.objects;

create policy "kyc-documents-bucket read" on storage.objects
  for select using (
    bucket_id = 'kyc-documents'
    and public.has_permission('kyc.read')
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

create policy "kyc-documents-bucket write" on storage.objects
  for insert with check (
    bucket_id = 'kyc-documents'
    and public.has_permission('kyc.write')
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

create policy "kyc-documents-bucket update" on storage.objects
  for update using (
    bucket_id = 'kyc-documents'
    and public.has_permission('kyc.write')
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

create policy "kyc-documents-bucket delete" on storage.objects
  for delete using (
    bucket_id = 'kyc-documents'
    and public.has_permission('kyc.write')
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

commit;
-- =============================================================
-- End of migration 019.
--
-- Verify in SQL Editor:
--   select role, permission from role_permission_defaults
--    where permission like 'kyc%' order by role, permission;
--   -- expect 5 rows (owner×2, supervisor×2, client×1).
-- =============================================================
