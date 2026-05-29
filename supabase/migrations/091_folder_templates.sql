-- =============================================================
-- Migration 091: Master list of storage-folder names (rename-only)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Today the names of every client's system folders ("KYC Documents",
-- "Scanned Invoices", "INP — Purchase Invoices", …) are seeded from
-- hardcoded arrays in api.ts. This migration moves the names into a
-- single editable table. Renaming a template propagates to every existing
-- client's folder row in one step.
-- The internal `category_key` is FIXED — it's used in storage paths and
-- code lookups — so this v1 supports rename + reorder + active toggle only.
-- =============================================================

begin;

create table if not exists public.folder_template (
  id              bigserial primary key,
  category_key    text not null unique,
  name            text not null,
  parent_key      text references public.folder_template(category_key) on delete set null,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);
create index if not exists folder_template_parent_idx on public.folder_template (parent_key, sort_order);

-- Seed with the current SYSTEM_FOLDERS + JOURNAL_SUBFOLDERS from api.ts.
-- Safe to re-run via on conflict do nothing.
insert into public.folder_template (category_key, name, parent_key, sort_order) values
  ('kyc',              'KYC Documents',                 null, 10),
  ('contracts',        'Contracts',                     null, 20),
  ('agreements',       'Agreements',                    null, 30),
  ('company_records',  'Company Records',               null, 40),
  ('audited_accounts', 'Audited Accounts',              null, 50),
  ('scanned',          'Scanned Invoices',              null, 60),
  ('issued_invoices',  'Issued Invoices (to Client)',   null, 70),
  ('other',            'Other',                         null, 80),
  ('scanned_INP',      'INP — Purchase Invoices',       'scanned', 10),
  ('scanned_INS',      'INS — Sales Invoices',          'scanned', 20),
  ('scanned_PM',       'PM — Bank Payments',            'scanned', 30),
  ('scanned_DEP',      'DEP — Deposits',                'scanned', 40),
  ('scanned_JV',       'JV — Journals',                 'scanned', 50)
on conflict (category_key) do nothing;

-- RLS: leadership can read; only the rename RPC writes.
alter table public.folder_template enable row level security;
drop policy if exists "folder_template read" on public.folder_template;
create policy "folder_template read" on public.folder_template
  for select to authenticated using (public.is_admin());

-- Rename + propagate to every existing client's folder row in one go.
create or replace function public.rename_folder_template(p_id bigint, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role in ('owner', 'supervisor')
       and active
  ) then raise exception 'Owner or supervisor only'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name is empty'; end if;
  select category_key into v_key from public.folder_template where id = p_id;
  if v_key is null then raise exception 'Folder template not found'; end if;
  update public.folder_template
     set name = btrim(p_name), updated_at = now()
   where id = p_id;
  update public.folders
     set name = btrim(p_name)
   where category_key = v_key and is_system = true;
end $$;
revoke all on function public.rename_folder_template(bigint, text) from public;
grant   execute on function public.rename_folder_template(bigint, text) to authenticated;

-- Set is_active for a template (no folder rows affected; only future-client seeding).
create or replace function public.set_folder_template_active(p_id bigint, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role in ('owner', 'supervisor')
       and active
  ) then raise exception 'Owner or supervisor only'; end if;
  update public.folder_template
     set is_active = p_active, updated_at = now()
   where id = p_id;
end $$;
revoke all on function public.set_folder_template_active(bigint, boolean) from public;
grant   execute on function public.set_folder_template_active(bigint, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 091.
-- =============================================================
