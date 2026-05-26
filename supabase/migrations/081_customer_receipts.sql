-- =============================================================
-- Migration 081: Client's own billing — receipts (Phase C)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- When a client marks one of their customer invoices paid, a numbered
-- receipt is created in the same step (per-client per-year R-numbering).
-- Mirrors the firm's receipts. RLS via user_can_access_client(owner).
-- =============================================================

begin;

create table if not exists public.customer_receipt_sequences (
  owner_client_id bigint not null references public.clients(id) on delete cascade,
  year            int not null,
  next_number     int not null default 1,
  primary key (owner_client_id, year)
);
alter table public.customer_receipt_sequences enable row level security;
-- No policy: only the security-definer RPC touches it.

create or replace function public.next_customer_receipt_number(p_owner bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare v_year int := extract(year from current_date)::int; v_num int;
begin
  insert into public.customer_receipt_sequences (owner_client_id, year, next_number) values (p_owner, v_year, 2)
  on conflict (owner_client_id, year) do update
    set next_number = public.customer_receipt_sequences.next_number + 1
  returning public.customer_receipt_sequences.next_number - 1 into v_num;
  return 'R' || v_year::text || '-' || lpad(v_num::text, 3, '0');
end $$;
revoke all on function public.next_customer_receipt_number(bigint) from public;
grant   execute on function public.next_customer_receipt_number(bigint) to authenticated;

create table if not exists public.customer_receipt (
  id              bigserial primary key,
  owner_client_id bigint not null references public.clients(id) on delete cascade,
  customer_id     bigint references public.customer(id) on delete set null,
  invoice_id      bigint references public.customer_invoice(id) on delete set null,
  receipt_number  text not null,
  receipt_date    date not null default current_date,
  amount          numeric(12,2) not null default 0,
  payment_method  text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists customer_receipt_owner_idx on public.customer_receipt (owner_client_id, receipt_date desc);
create index if not exists customer_receipt_invoice_idx on public.customer_receipt (invoice_id) where invoice_id is not null;

drop trigger if exists tg_audit_customer_receipt on public.customer_receipt;
create trigger tg_audit_customer_receipt after insert or update or delete on public.customer_receipt
  for each row execute function public.tg_audit();

alter table public.customer_receipt enable row level security;
drop policy if exists "customer_receipt rw" on public.customer_receipt;
create policy "customer_receipt rw" on public.customer_receipt
  for all using (public.user_can_access_client(owner_client_id))
  with check (public.user_can_access_client(owner_client_id));

-- Replace mark-paid: now also issues a receipt + captures payment method.
drop function if exists public.mark_customer_invoice_paid(bigint, date);
create or replace function public.mark_customer_invoice_paid(p_id bigint, p_paid_date date default null, p_method text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_inv public.customer_invoice%rowtype; v_date date; v_rnum text;
begin
  select * into v_inv from public.customer_invoice where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.user_can_access_client(v_inv.owner_client_id) then raise exception 'Not allowed'; end if;
  if v_inv.status <> 'issued' then raise exception 'Only issued invoices can be marked paid'; end if;
  v_date := coalesce(p_paid_date, current_date);
  update public.customer_invoice set status = 'paid', paid_date = v_date where id = p_id;
  v_rnum := public.next_customer_receipt_number(v_inv.owner_client_id);
  insert into public.customer_receipt
    (owner_client_id, customer_id, invoice_id, receipt_number, receipt_date, amount, payment_method, created_by)
  values
    (v_inv.owner_client_id, v_inv.customer_id, p_id, v_rnum, v_date, v_inv.total_amount, p_method, auth.uid());
  return v_rnum;
end $$;
revoke all on function public.mark_customer_invoice_paid(bigint, date, text) from public;
grant   execute on function public.mark_customer_invoice_paid(bigint, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 081.
-- =============================================================
