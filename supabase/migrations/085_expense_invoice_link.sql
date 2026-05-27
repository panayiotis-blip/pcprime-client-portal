-- =============================================================
-- Migration 085: Link a client expense to the invoice it was allocated into
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- When staff "Allocate" a client-uploaded expense, they now create a real
-- scanned-document invoice from it. This column records which invoice the
-- expense became, so the two stay linked. RLS unchanged (staff update via the
-- existing is_admin() policy on client_expense).
-- =============================================================

begin;

alter table public.client_expense
  add column if not exists invoice_id bigint references public.invoices(id) on delete set null;

create index if not exists client_expense_invoice_idx
  on public.client_expense (invoice_id) where invoice_id is not null;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 085.
-- =============================================================
