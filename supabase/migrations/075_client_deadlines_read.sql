-- =============================================================
-- Migration 075: Client read access to their own tax-filing deadlines
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The existing client_tax_filings read policy (migration 037) gates on
-- has_permission('clients.read'), which CLIENT-role users don't have. This
-- adds a permissive SELECT policy so a client (linked via user_clients) can
-- read THEIR OWN filing rows for the client "Deadlines" view. Read-only;
-- staff policies and all write policies unchanged.
-- =============================================================

begin;

drop policy if exists "client_tax_filings client read" on public.client_tax_filings;
create policy "client_tax_filings client read"
  on public.client_tax_filings for select to authenticated
  using (public.user_can_access_client(client_id));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 075.
-- =============================================================
