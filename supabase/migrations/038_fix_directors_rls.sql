-- 038_fix_directors_rls.sql
-- The RLS policies on client_directors (migration 031) and
-- client_tax_filings (migration 037) referenced a non-existent permission
-- 'clients.read_all'. has_permission() returns false for it, so for any
-- user not directly linked via user_clients (i.e. all staff users), the
-- INSERT/UPDATE was rejected.
--
-- Fix: reuse the existing SECURITY DEFINER helper user_can_access_client()
-- which already encodes the right model — staff see everything, client
-- role only sees their linked rows. Same pattern as documents / vendor_patterns.

begin;

-- ---- client_directors ----
drop policy if exists "client_directors_read"  on public.client_directors;
drop policy if exists "client_directors_write" on public.client_directors;

create policy "client_directors_read"
  on public.client_directors for select to authenticated
  using (public.user_can_access_client(client_id));

create policy "client_directors_write"
  on public.client_directors for all to authenticated
  using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

-- ---- client_tax_filings ----
drop policy if exists "client_tax_filings_read"  on public.client_tax_filings;
drop policy if exists "client_tax_filings_write" on public.client_tax_filings;

create policy "client_tax_filings_read"
  on public.client_tax_filings for select to authenticated
  using (public.user_can_access_client(client_id));

create policy "client_tax_filings_write"
  on public.client_tax_filings for all to authenticated
  using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

commit;
