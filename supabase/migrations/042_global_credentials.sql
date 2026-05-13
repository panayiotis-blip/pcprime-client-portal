-- 042_global_credentials.sql
-- Standalone Passwords/Credentials page support: allow credentials that
-- aren't tied to a specific client (e.g. shared firm logins for H&H,
-- accountant portals, banking sites the firm uses, etc.).
--
-- 1. platform_credentials.client_id: NOT NULL → nullable
-- 2. Add owner_label text for firm-owned (unlinked) credentials
-- 3. Refresh RLS so staff still see everything; client role users only see
--    credentials for clients they're linked to (unchanged behaviour).

begin;

-- 1 & 2 — schema
alter table public.platform_credentials
  alter column client_id drop not null;

alter table public.platform_credentials
  add column if not exists owner_label text;

comment on column public.platform_credentials.client_id is
  'Optional FK to clients. NULL means firm-owned (non-client) credential — use owner_label to describe what it is for.';

comment on column public.platform_credentials.owner_label is
  'Free-text label for firm-owned credentials (client_id IS NULL). E.g. "H&H Accountant", "Firm Banking", "JCC PSP".';

-- 3 — RLS (replace any existing policies)
drop policy if exists "platform_creds admin"  on public.platform_credentials;
drop policy if exists "platform_creds read"   on public.platform_credentials;
drop policy if exists "platform_creds write"  on public.platform_credentials;
drop policy if exists "platform_creds_read"   on public.platform_credentials;
drop policy if exists "platform_creds_write"  on public.platform_credentials;

-- Staff (owner/supervisor/admin/staff) can see all rows incl. firm-owned.
-- Client-role users can only see credentials for clients they're linked to.
create policy "platform_creds_read"
  on public.platform_credentials for select to authenticated
  using (
    public.is_admin()
    or (
      client_id is not null
      and exists (
        select 1 from public.user_clients uc
        where uc.user_id = auth.uid() and uc.client_id = platform_credentials.client_id
      )
    )
  );

-- Only staff write/delete credentials (with or without client_id).
create policy "platform_creds_write"
  on public.platform_credentials for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
-- =============================================================
-- Verify:
--   select column_name, is_nullable, data_type
--     from information_schema.columns
--    where table_name = 'platform_credentials'
--      and column_name in ('client_id', 'owner_label');
--   -- expect: client_id YES (nullable); owner_label YES + text
--
--   select policyname from pg_policies where tablename = 'platform_credentials';
--   -- expect: platform_creds_read, platform_creds_write
-- =============================================================
