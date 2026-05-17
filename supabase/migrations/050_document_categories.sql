-- =============================================================
-- Migration 050: Document Categories (UI Polish v2 — Part 3 / 4)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Creates the editable master list of document categories used by the
-- Scan Document flow (Part 3) and managed in Company Settings (Part 4).
--
-- Each category either:
--   * ocr_enabled = true  → routes to the Edit Invoice / journal flow
--                           (Branch A). journal_code links it to the
--                           existing journal_types accounting backbone.
--   * ocr_enabled = false → uploads straight to target_folder as a plain
--                           document, no OCR / no invoice (Branch B).
--
-- target_folder holds a system-folder category_key (e.g. 'scanned_INP',
-- 'kyc', 'agreements', 'company_records', 'other').
-- show_due_date is consumed later by Part 5B (Edit Invoice fixes).
-- =============================================================

begin;

create table if not exists public.document_categories (
  id            bigserial primary key,
  name          text    not null unique,
  code          text,
  target_folder text    not null,
  ocr_enabled   boolean not null default false,
  show_due_date boolean not null default false,
  journal_code  text,                 -- links OCR categories to journal_types.code
  is_active     boolean not null default true,
  display_order int     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.document_categories is
  'Editable master list of Scan Document categories. ocr_enabled routes to the invoice editor (Branch A); otherwise the file is filed straight into target_folder (Branch B).';

drop trigger if exists document_categories_updated_at on public.document_categories;
create trigger document_categories_updated_at before update on public.document_categories
  for each row execute function public.tg_set_updated_at();

alter table public.document_categories enable row level security;

drop policy if exists "document_categories read"  on public.document_categories;
drop policy if exists "document_categories write" on public.document_categories;

-- Every authenticated user needs to read the list for the Scan Document dropdown.
create policy "document_categories read" on public.document_categories
  for select using (auth.uid() is not null);

-- Only the Owner can add / edit / delete categories (managed in Part 4 admin).
create policy "document_categories write" on public.document_categories
  for all using (public.is_owner()) with check (public.is_owner());

-- Seed the 11 default categories. Idempotent — skips any whose name already exists.
insert into public.document_categories
  (name, code, target_folder, ocr_enabled, show_due_date, journal_code, display_order)
values
  ('Purchase Invoice', 'INP', 'scanned_INP',     true,  false, 'INP', 1),
  ('Sales Invoice',    'INS', 'scanned_INS',     true,  true,  'INS', 2),
  ('Bank Deposit',     'DEP', 'scanned_DEP',     true,  false, 'DEP', 3),
  ('Bank Payment',     'PM',  'scanned_PM',      true,  false, 'PM',  4),
  ('Bank Statement',   null,  'company_records', false, false, null,  5),
  ('Journal Voucher',  'JV',  'scanned_JV',      true,  false, 'JV',  6),
  ('Agreement',        null,  'agreements',      false, false, null,  7),
  ('KYC Document',     null,  'kyc',             false, false, null,  8),
  ('Tax Document',     null,  'company_records', false, false, null,  9),
  ('Company Document', null,  'company_records', false, false, null, 10),
  ('Other',            null,  'other',           false, false, null, 11)
on conflict (name) do nothing;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 050.
-- =============================================================
