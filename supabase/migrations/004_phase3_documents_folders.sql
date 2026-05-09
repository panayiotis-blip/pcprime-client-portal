-- =============================================================
-- Phase 3: Documents, Folders, Vendor Patterns, Platform Creds, Journal Types
-- =============================================================

-- -------------------------------------------------------------
-- Folders (client document folders, nested)
-- -------------------------------------------------------------
create table if not exists public.folders (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  parent_id bigint references public.folders(id) on delete cascade,
  name text not null,
  category_key text default '',
  is_system boolean not null default false
);

create index if not exists idx_folders_client on public.folders(client_id);
create index if not exists idx_folders_parent on public.folders(parent_id);

-- -------------------------------------------------------------
-- Documents (files linked to clients, organized by folder)
-- -------------------------------------------------------------
create table if not exists public.documents (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  folder_id bigint references public.folders(id) on delete set null,
  doc_type text not null default 'document',
  category text default 'other',
  year text default '',
  month text default '',
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  notes text default '',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_documents_client on public.documents(client_id);
create index if not exists idx_documents_folder on public.documents(folder_id);

-- -------------------------------------------------------------
-- Vendor patterns (learn from past invoices)
-- -------------------------------------------------------------
create table if not exists public.vendor_patterns (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  vendor_name_normalized text not null,
  vendor_name_original text default '',
  debit_account text default '',
  credit_account text default '',
  vat_code text default '',
  vat_rate numeric(6,2) default 0,
  journal_type text default '',
  details_template text default '',
  match_count integer default 1,
  last_used timestamptz default now(),
  created_at timestamptz default now(),
  unique (client_id, vendor_name_normalized)
);

create index if not exists idx_vendor_patterns_lookup
  on public.vendor_patterns(client_id, vendor_name_normalized);

-- -------------------------------------------------------------
-- Platform credentials (TAXISNET, Ergani, CY Login etc. per client)
-- -------------------------------------------------------------
create table if not exists public.platform_credentials (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  platform text not null,
  username text default '',
  password text default '',
  notes text default ''
);

create index if not exists idx_platform_creds_client on public.platform_credentials(client_id);

-- -------------------------------------------------------------
-- Journal types (global list, code + label)
-- -------------------------------------------------------------
create table if not exists public.journal_types (
  id bigserial primary key,
  client_id bigint default 0,
  code text not null,
  label text not null
);

-- Seed default journal types if empty
insert into public.journal_types (client_id, code, label)
select 0, code, label from (values
  ('INP','Purchase Invoices'),
  ('INS','Sales Invoices'),
  ('PM','Bank Payments'),
  ('DEP','Deposits'),
  ('JV','General Journal')
) as t(code, label)
where not exists (select 1 from public.journal_types);

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.folders              enable row level security;
alter table public.documents            enable row level security;
alter table public.vendor_patterns      enable row level security;
alter table public.platform_credentials enable row level security;
alter table public.journal_types        enable row level security;

-- FOLDERS
drop policy if exists "folders read"  on public.folders;
drop policy if exists "folders write" on public.folders;
create policy "folders read"  on public.folders for select using (public.user_can_access_client(client_id));
create policy "folders write" on public.folders for all    using (public.user_can_access_client(client_id)) with check (public.user_can_access_client(client_id));

-- DOCUMENTS
drop policy if exists "documents read"  on public.documents;
drop policy if exists "documents write" on public.documents;
create policy "documents read"  on public.documents for select using (public.user_can_access_client(client_id));
create policy "documents write" on public.documents for all    using (public.user_can_access_client(client_id)) with check (public.user_can_access_client(client_id));

-- VENDOR PATTERNS (admin only write; any linked user can read to auto-fill)
drop policy if exists "vendor_patterns read"  on public.vendor_patterns;
drop policy if exists "vendor_patterns write" on public.vendor_patterns;
create policy "vendor_patterns read"  on public.vendor_patterns for select using (public.user_can_access_client(client_id));
create policy "vendor_patterns write" on public.vendor_patterns for all    using (public.user_can_access_client(client_id)) with check (public.user_can_access_client(client_id));

-- PLATFORM CREDS (admin-only — sensitive)
drop policy if exists "platform_creds admin" on public.platform_credentials;
create policy "platform_creds admin" on public.platform_credentials for all using (public.is_admin()) with check (public.is_admin());

-- JOURNAL TYPES (everyone reads, admin writes)
drop policy if exists "journal_types read"  on public.journal_types;
drop policy if exists "journal_types write" on public.journal_types;
create policy "journal_types read"  on public.journal_types for select using (auth.uid() is not null);
create policy "journal_types write" on public.journal_types for all    using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------
-- Storage bucket: documents (private)
-- Paths: {client_id}/{folder_path_or_category}/{filename}
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents-bucket read"   on storage.objects;
drop policy if exists "documents-bucket write"  on storage.objects;
drop policy if exists "documents-bucket update" on storage.objects;
drop policy if exists "documents-bucket delete" on storage.objects;

create policy "documents-bucket read" on storage.objects for select using (
  bucket_id = 'documents' and public.user_can_access_client((storage.foldername(name))[1]::bigint)
);
create policy "documents-bucket write" on storage.objects for insert with check (
  bucket_id = 'documents' and public.user_can_access_client((storage.foldername(name))[1]::bigint)
);
create policy "documents-bucket update" on storage.objects for update using (
  bucket_id = 'documents' and public.user_can_access_client((storage.foldername(name))[1]::bigint)
);
create policy "documents-bucket delete" on storage.objects for delete using (
  bucket_id = 'documents' and public.user_can_access_client((storage.foldername(name))[1]::bigint)
);
