-- =============================================================
-- Migration 082: Client expense capture (Item 10)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Clients upload/scan their purchase invoices/expenses (AI-prefilled), tag an
-- expense type + project code, and submit. The firm reviews/allocates them in
-- a back-office queue. RLS: a client reads/submits their own; only staff can
-- allocate/reject. Files live in a private client-expenses bucket.
-- =============================================================

begin;

create table if not exists public.client_expense (
  id               bigserial primary key,
  owner_client_id  bigint not null references public.clients(id) on delete cascade,
  file_name        text,
  storage_path     text,
  mime_type        text,
  expense_type     text,
  project_code     text,
  vendor_name      text,
  expense_date     date,
  amount           numeric(12,2),
  vat_amount       numeric(12,2),
  currency         text,
  notes            text,
  status           text not null default 'submitted' check (status in ('submitted', 'allocated', 'rejected')),
  allocation_notes text,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists client_expense_owner_idx  on public.client_expense (owner_client_id, created_at desc);
create index if not exists client_expense_status_idx on public.client_expense (status, created_at desc);

drop trigger if exists tg_audit_client_expense on public.client_expense;
create trigger tg_audit_client_expense after insert or update or delete on public.client_expense
  for each row execute function public.tg_audit();

alter table public.client_expense enable row level security;
drop policy if exists "client_expense read"   on public.client_expense;
drop policy if exists "client_expense insert" on public.client_expense;
drop policy if exists "client_expense staff update" on public.client_expense;
drop policy if exists "client_expense staff delete" on public.client_expense;
create policy "client_expense read" on public.client_expense
  for select using (public.user_can_access_client(owner_client_id));
create policy "client_expense insert" on public.client_expense
  for insert with check (public.user_can_access_client(owner_client_id));
create policy "client_expense staff update" on public.client_expense
  for update using (public.is_admin()) with check (public.is_admin());
create policy "client_expense staff delete" on public.client_expense
  for delete using (public.is_admin());

-- Private storage bucket for the expense files.
insert into storage.buckets (id, name, public)
values ('client-expenses', 'client-expenses', false)
on conflict (id) do nothing;

drop policy if exists "client-expenses read"   on storage.objects;
drop policy if exists "client-expenses write"  on storage.objects;
drop policy if exists "client-expenses delete" on storage.objects;
create policy "client-expenses read" on storage.objects
  for select using (bucket_id = 'client-expenses'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));
create policy "client-expenses write" on storage.objects
  for insert with check (bucket_id = 'client-expenses'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));
create policy "client-expenses delete" on storage.objects
  for delete using (bucket_id = 'client-expenses'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 082.
-- =============================================================
