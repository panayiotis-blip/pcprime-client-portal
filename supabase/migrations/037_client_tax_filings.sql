-- 037_client_tax_filings.sql
-- B3 of clients-v3: historical + ongoing tax filings per client.

begin;

create table if not exists public.client_tax_filings (
  id                   bigserial primary key,
  client_id            bigint not null references public.clients(id) on delete cascade,
  tax_year             int not null,
  filing_type          text not null check (filing_type in (
    'individual_tax_return',
    'individual_tax_return_self_employed',
    'individual_tax_return_pensioner',
    'company_tax_return',
    'vat_return',
    'social_insurance_return',
    'ergani_filing',
    'other'
  )),
  status               text not null default 'pending' check (status in (
    'not_required', 'pending', 'in_progress',
    'filed', 'submitted', 'paid', 'overdue'
  )),
  due_date             date,
  filed_date           date,
  filed_by_user_id     uuid references auth.users(id) on delete set null,
  reference_number     text,
  amount               numeric(12, 2),
  notes                text,
  bulk_import_batch_id text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists client_tax_filings_client_year_idx
  on public.client_tax_filings (client_id, tax_year desc);

create index if not exists client_tax_filings_status_idx
  on public.client_tax_filings (status);

create index if not exists client_tax_filings_due_date_idx
  on public.client_tax_filings (due_date)
  where status in ('pending', 'in_progress', 'overdue');

create index if not exists client_tax_filings_batch_idx
  on public.client_tax_filings (bulk_import_batch_id)
  where bulk_import_batch_id is not null;

-- updated_at auto-bump
create or replace function public._tg_client_tax_filings_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_client_tax_filings_updated_at on public.client_tax_filings;
create trigger trg_client_tax_filings_updated_at
  before update on public.client_tax_filings
  for each row execute function public._tg_client_tax_filings_updated_at();

-- Audit (generic tg_audit from migration 007)
drop trigger if exists trg_client_tax_filings_audit on public.client_tax_filings;
create trigger trg_client_tax_filings_audit
  after insert or update or delete on public.client_tax_filings
  for each row execute function public.tg_audit();

-- RLS — same pattern as documents/emails: gated on clients.read + user_clients
alter table public.client_tax_filings enable row level security;

drop policy if exists "client_tax_filings_read"   on public.client_tax_filings;
drop policy if exists "client_tax_filings_write"  on public.client_tax_filings;

create policy "client_tax_filings_read"
  on public.client_tax_filings for select to authenticated
  using (
    public.has_permission('clients.read') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_tax_filings.client_id
          and uc.user_id = auth.uid()
      )
    )
  );

create policy "client_tax_filings_write"
  on public.client_tax_filings for all to authenticated
  using (
    public.has_permission('clients.write') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_tax_filings.client_id
          and uc.user_id = auth.uid()
      )
    )
  )
  with check (
    public.has_permission('clients.write') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_tax_filings.client_id
          and uc.user_id = auth.uid()
      )
    )
  );

comment on table public.client_tax_filings is
  'Historical and ongoing tax filings per client. Populated by bulk import (Tax Filings sheet) and by the Tax Filings management module. Status enum: pending/in_progress/filed/submitted/paid/overdue/not_required. RLS gates SELECT on clients.read + user_clients; INSERT/UPDATE/DELETE on clients.write.';

commit;
-- =============================================================
-- Verify:
--   \d public.client_tax_filings              -- table + indexes exist
--   select policyname from pg_policies
--    where tablename = 'client_tax_filings';  -- expect 2 rows
-- =============================================================
