-- =============================================================
-- Migration 083: Let clients edit their own SUBMITTED expenses
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A client may edit an expense they submitted until the firm acts on it.
-- They can only update their own rows while status = 'submitted', and the
-- row must STAY 'submitted' (the WITH CHECK blocks self-allocation). Staff
-- keep their existing update policy (allocate/reject any).
-- =============================================================

begin;

drop policy if exists "client_expense client update" on public.client_expense;
create policy "client_expense client update" on public.client_expense
  for update
  using (public.user_can_access_client(owner_client_id) and status = 'submitted')
  with check (public.user_can_access_client(owner_client_id) and status = 'submitted');

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 083.
-- =============================================================
