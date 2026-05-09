-- =============================================================
-- Phase 2: Invoices, journal lines, invoice files, chart of accounts
-- =============================================================

-- -------------------------------------------------------------
-- Chart of Accounts (per client)
-- -------------------------------------------------------------
create table if not exists public.accounts (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  code text not null,
  description text not null,
  category text not null default 'Expense',
  unique (client_id, code)
);

create index if not exists idx_accounts_client on public.accounts(client_id);

-- -------------------------------------------------------------
-- Invoices
-- -------------------------------------------------------------
create table if not exists public.invoices (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  invoice_number text default '',
  vendor_name text default '',
  invoice_date text default '',      -- DD/MM/YYYY to match existing format
  due_date text default '',
  total_amount numeric(14,2) default 0,
  currency text default '',
  currency_rate text default '',
  raw_ocr_text text default '',
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'exported')),
  journal text default 'JV',
  reference text default '',
  batch_month text default '',       -- YYYY-MM
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_client on public.invoices(client_id);
create index if not exists idx_invoices_batch on public.invoices(client_id, batch_month);
create index if not exists idx_invoices_status on public.invoices(status);

drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.tg_set_updated_at();

-- -------------------------------------------------------------
-- Journal lines (double-entry lines for an invoice)
-- -------------------------------------------------------------
create table if not exists public.journal_lines (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  debit_account text default '',
  credit_account text default '',
  amount numeric(14,2) default 0,
  vat_code text default '',
  vat_amount numeric(14,2) default 0,
  details text default '',
  t_analysis_1 text default '',
  t_analysis_2 text default '',
  t_analysis_3 text default '',
  t_analysis_4 text default '',
  t_analysis_5 text default ''
);

create index if not exists idx_journal_lines_invoice on public.journal_lines(invoice_id);

-- -------------------------------------------------------------
-- Invoice files (pointers to files in storage)
-- -------------------------------------------------------------
create table if not exists public.invoice_files (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  storage_path text not null,        -- path within the 'invoice-files' storage bucket
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_files_invoice on public.invoice_files(invoice_id);

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.accounts       enable row level security;
alter table public.invoices       enable row level security;
alter table public.journal_lines  enable row level security;
alter table public.invoice_files  enable row level security;

-- ACCOUNTS
drop policy if exists "accounts read" on public.accounts;
create policy "accounts read" on public.accounts
  for select using (public.user_can_access_client(client_id));

drop policy if exists "accounts admin write" on public.accounts;
create policy "accounts admin write" on public.accounts
  for all using (public.is_admin()) with check (public.is_admin());

-- INVOICES
drop policy if exists "invoices read" on public.invoices;
create policy "invoices read" on public.invoices
  for select using (public.user_can_access_client(client_id));

drop policy if exists "invoices write linked" on public.invoices;
create policy "invoices write linked" on public.invoices
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

-- JOURNAL LINES: access via parent invoice
drop policy if exists "journal_lines read" on public.journal_lines;
create policy "journal_lines read" on public.journal_lines
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = journal_lines.invoice_id
        and public.user_can_access_client(i.client_id)
    )
  );

drop policy if exists "journal_lines write" on public.journal_lines;
create policy "journal_lines write" on public.journal_lines
  for all using (
    exists (
      select 1 from public.invoices i
      where i.id = journal_lines.invoice_id
        and public.user_can_access_client(i.client_id)
    )
  ) with check (
    exists (
      select 1 from public.invoices i
      where i.id = journal_lines.invoice_id
        and public.user_can_access_client(i.client_id)
    )
  );

-- INVOICE FILES
drop policy if exists "invoice_files read" on public.invoice_files;
create policy "invoice_files read" on public.invoice_files
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_files.invoice_id
        and public.user_can_access_client(i.client_id)
    )
  );

drop policy if exists "invoice_files write" on public.invoice_files;
create policy "invoice_files write" on public.invoice_files
  for all using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_files.invoice_id
        and public.user_can_access_client(i.client_id)
    )
  ) with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_files.invoice_id
        and public.user_can_access_client(i.client_id)
    )
  );

-- -------------------------------------------------------------
-- Storage bucket: invoice-files (private)
-- Files are stored under path: {client_id}/{invoice_id}/{filename}
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoice-files', 'invoice-files', false)
on conflict (id) do nothing;

-- Storage RLS: read/write if the first path segment (client_id) is accessible
drop policy if exists "invoice-files read" on storage.objects;
create policy "invoice-files read" on storage.objects
  for select using (
    bucket_id = 'invoice-files'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

drop policy if exists "invoice-files write" on storage.objects;
create policy "invoice-files write" on storage.objects
  for insert with check (
    bucket_id = 'invoice-files'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

drop policy if exists "invoice-files update" on storage.objects;
create policy "invoice-files update" on storage.objects
  for update using (
    bucket_id = 'invoice-files'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );

drop policy if exists "invoice-files delete" on storage.objects;
create policy "invoice-files delete" on storage.objects
  for delete using (
    bucket_id = 'invoice-files'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint)
  );
