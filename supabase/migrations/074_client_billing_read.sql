-- =============================================================
-- Migration 074: Client read access to their own billing
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Lets a CLIENT-role user (linked via user_clients) read ONLY their own
-- ISSUED and PAID invoices, the lines of those invoices, and their own
-- receipts — for the client "My Account" portal. Drafts and cancelled
-- invoices stay hidden from clients. Staff policies are unchanged; these
-- are additional permissive SELECT policies (Postgres OR's them).
-- =============================================================

begin;

-- ---------- client_invoices: own issued/paid, read-only ----------
drop policy if exists "client_invoices client read" on public.client_invoices;
create policy "client_invoices client read" on public.client_invoices
  for select using (
    public.user_can_access_client(client_id)
    and status in ('issued', 'paid')
  );

-- ---------- client_invoice_lines: lines of those invoices ----------
drop policy if exists "client_invoice_lines client read" on public.client_invoice_lines;
create policy "client_invoice_lines client read" on public.client_invoice_lines
  for select using (
    exists (
      select 1 from public.client_invoices ci
       where ci.id = client_invoice_lines.invoice_id
         and public.user_can_access_client(ci.client_id)
         and ci.status in ('issued', 'paid')
    )
  );

-- ---------- receipts: own receipts ----------
drop policy if exists "receipts client read" on public.receipts;
create policy "receipts client read" on public.receipts
  for select using (public.user_can_access_client(client_id));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 074.
-- =============================================================
