-- Migration 123: Client onboarding attachments
-- =================================================================
-- Lets the public, token-keyed onboarding form (migration 120) carry
-- file attachments — e.g. a scan of the client's ID, passport, or
-- proof of address. Anonymous browsers cannot write to storage
-- directly, so uploads go through the `intake-upload` edge function,
-- which validates the token with the service-role key and writes the
-- object on the caller's behalf (same trust model as inbound-email).
--
-- Metadata for each file is appended to a new `attachments` jsonb array
-- on the submission row, so staff see the list when they review it.

begin;

alter table public.client_intake_submissions
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- ---- Storage bucket: intake-attachments (private, staff read) ----
-- Files for not-yet-approved submissions. Only staff review them; on
-- approval they are copied into the client's permanent Documents.
insert into storage.buckets (id, name, public)
values ('intake-attachments', 'intake-attachments', false)
on conflict (id) do nothing;

drop policy if exists "intake-attachments staff read" on storage.objects;
drop policy if exists "intake-attachments no write"   on storage.objects;

create policy "intake-attachments staff read"
  on storage.objects for select to authenticated using (
    bucket_id = 'intake-attachments'
    and exists (select 1 from public.profiles p
                where p.id = auth.uid() and p.role in ('owner','supervisor','admin','staff'))
  );

-- INSERT/UPDATE/DELETE blocked for authenticated; only service_role writes
-- (the edge function), and only service_role / staff cleanup deletes.
create policy "intake-attachments no write"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'intake-attachments' and false
  );

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select id, name, public from storage.buckets where id = 'intake-attachments';
--   select attachments from public.client_intake_submissions limit 1;  -- []
-- =============================================================
