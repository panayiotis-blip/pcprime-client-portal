-- =============================================================
-- Migration 084: Advisor-published reports (Item 13)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- When the firm finishes working a client's data, staff upload finished
-- reports (P&L, VAT, management accounts, etc.) for the client to view and
-- download in their portal Reports area. The mirror image of client_expense:
-- here STAFF upload and the CLIENT reads. Files live in a private
-- advisor-reports bucket.
-- =============================================================

begin;

create table if not exists public.advisor_report (
  id               bigserial primary key,
  owner_client_id  bigint not null references public.clients(id) on delete cascade,
  title            text not null,
  report_type      text,
  period_label     text,
  file_name        text,
  storage_path     text,
  mime_type        text,
  notes            text,
  uploaded_by      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists advisor_report_owner_idx on public.advisor_report (owner_client_id, created_at desc);

drop trigger if exists tg_audit_advisor_report on public.advisor_report;
create trigger tg_audit_advisor_report after insert or update or delete on public.advisor_report
  for each row execute function public.tg_audit();

alter table public.advisor_report enable row level security;
drop policy if exists "advisor_report read"         on public.advisor_report;
drop policy if exists "advisor_report staff insert" on public.advisor_report;
drop policy if exists "advisor_report staff update" on public.advisor_report;
drop policy if exists "advisor_report staff delete" on public.advisor_report;
-- Client and staff can read; only staff can write.
create policy "advisor_report read" on public.advisor_report
  for select using (public.user_can_access_client(owner_client_id));
create policy "advisor_report staff insert" on public.advisor_report
  for insert with check (public.is_admin());
create policy "advisor_report staff update" on public.advisor_report
  for update using (public.is_admin()) with check (public.is_admin());
create policy "advisor_report staff delete" on public.advisor_report
  for delete using (public.is_admin());

-- Private storage bucket for the report files.
insert into storage.buckets (id, name, public)
values ('advisor-reports', 'advisor-reports', false)
on conflict (id) do nothing;

drop policy if exists "advisor-reports read"   on storage.objects;
drop policy if exists "advisor-reports write"  on storage.objects;
drop policy if exists "advisor-reports delete" on storage.objects;
-- Client + staff read their own client's folder; only staff write/delete.
create policy "advisor-reports read" on storage.objects
  for select using (bucket_id = 'advisor-reports'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));
create policy "advisor-reports write" on storage.objects
  for insert with check (bucket_id = 'advisor-reports' and public.is_admin());
create policy "advisor-reports delete" on storage.objects
  for delete using (bucket_id = 'advisor-reports' and public.is_admin());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 084.
-- =============================================================
