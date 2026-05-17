-- =============================================================
-- Migration 053: Smart Import — new client fields + import_mappings
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Phase 1 of the Smart Import feature (Excel field-mapping import).
--
-- Adds eight new columns to `clients` and the `import_mappings` table
-- that stores reusable column-mapping presets.
--
-- NOTE: the Greek/English name split from the original task spec is
-- intentionally NOT done. The clients table already has `name` (primary
-- name) and `name_tax_office` (Greek tax-office name) — Smart Import maps
-- onto those existing columns. No name migration, no app-wide changes.
-- =============================================================

begin;

-- ---- New client fields ----
alter table public.clients
  add column if not exists bank_iban                text,
  add column if not exists year_of_incorporation    int,
  add column if not exists industry_sector          text,
  add column if not exists engagement_letter_date   date,
  add column if not exists annual_fee_agreed        numeric(10,2),
  add column if not exists auditor_name             text,
  add column if not exists beneficial_owner_names   text[] not null default array[]::text[],
  add column if not exists beneficial_owner_details jsonb  not null default '{}'::jsonb;

comment on column public.clients.year_of_incorporation is
  'Searchable year-only field; complements the full incorporation_date.';
comment on column public.clients.beneficial_owner_details is
  'UBO detail keyed by name: { "<name>": { shareholding, id, nationality } }.';

-- ---- import_mappings — reusable column-mapping presets ----
create table if not exists public.import_mappings (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  user_id        uuid not null references auth.users(id) on delete cascade,
  column_mapping jsonb not null,                 -- { "<sheet header>": "<client field>" }
  options        jsonb not null default '{}'::jsonb,
  is_shared      boolean not null default false, -- firm-wide visibility
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists import_mappings_user_idx on public.import_mappings (user_id);

drop trigger if exists import_mappings_updated_at on public.import_mappings;
create trigger import_mappings_updated_at before update on public.import_mappings
  for each row execute function public.tg_set_updated_at();

alter table public.import_mappings enable row level security;

drop policy if exists "import_mappings read"  on public.import_mappings;
drop policy if exists "import_mappings write" on public.import_mappings;

-- Read: your own mappings, plus any shared firm-wide.
create policy "import_mappings read" on public.import_mappings
  for select using (user_id = auth.uid() or is_shared = true);

-- Write: only your own mappings (a user shares by setting is_shared on theirs).
create policy "import_mappings write" on public.import_mappings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 053.
-- =============================================================
