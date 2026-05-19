-- =============================================================
-- Migration 069: Receipts (Accounting — billing module, Phase B)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- When an issued invoice is marked paid, a numbered receipt is created in
-- the same step (amount = the invoice total). Receipts have their own
-- per-year number sequence (R2026-001, …) and a printable template.
-- =============================================================

begin;

-- ---------- 1. Per-year receipt counter ----------
create table if not exists public.receipt_sequences (
  year         int primary key,
  next_number  int not null default 1
);

create or replace function public.next_receipt_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_num  int;
begin
  insert into public.receipt_sequences (year, next_number)
       values (v_year, 2)
  on conflict (year) do update
       set next_number = public.receipt_sequences.next_number + 1
  returning public.receipt_sequences.next_number - 1 into v_num;
  return 'R' || v_year::text || '-' || lpad(v_num::text, 3, '0');
end $$;

revoke all on function public.next_receipt_number() from public;
grant   execute on function public.next_receipt_number() to authenticated;

-- ---------- 2. receipts ----------
create table if not exists public.receipts (
  id              bigserial primary key,
  receipt_number  text   not null unique,
  client_id       bigint not null references public.clients(id) on delete restrict,
  invoice_id      bigint references public.client_invoices(id) on delete set null,
  receipt_date    date   not null default current_date,
  amount          numeric(12,2) not null default 0,
  payment_method  text,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists receipts_client_idx  on public.receipts (client_id, receipt_date desc);
create index if not exists receipts_invoice_idx on public.receipts (invoice_id) where invoice_id is not null;

drop trigger if exists tg_audit_receipts on public.receipts;
create trigger tg_audit_receipts
  after insert or update or delete on public.receipts
  for each row execute function public.tg_audit();

alter table public.receipts enable row level security;
drop policy if exists "receipts read"  on public.receipts;
drop policy if exists "receipts write" on public.receipts;
create policy "receipts read" on public.receipts
  for select using (public.is_admin());
create policy "receipts write" on public.receipts
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 3. mark_client_invoice_paid — now also issues a receipt ----------
-- The previous 2-argument version is dropped and replaced with one that
-- takes a payment method and creates the receipt in the same transaction.
drop function if exists public.mark_client_invoice_paid(bigint, date);

create or replace function public.mark_client_invoice_paid(
  p_id        bigint,
  p_paid_date date default null,
  p_method    text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_inv  public.client_invoices%rowtype;
  v_date date;
  v_rnum text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles
                  where id = v_uid and role in ('owner','supervisor','admin','staff')) then
    raise exception 'Staff only';
  end if;

  select * into v_inv from public.client_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'issued' then
    raise exception 'Only issued invoices can be marked paid (current: %)', v_inv.status;
  end if;

  v_date := coalesce(p_paid_date, current_date);

  update public.client_invoices
     set status    = 'paid',
         paid_date = v_date
   where id = p_id;

  v_rnum := public.next_receipt_number();
  insert into public.receipts
    (receipt_number, client_id, invoice_id, receipt_date, amount, payment_method, created_by)
  values
    (v_rnum, v_inv.client_id, p_id, v_date, v_inv.total_amount, p_method, v_uid);

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_uid, 'client_invoices.mark_paid', 'client_invoices', p_id,
          jsonb_build_object('invoice_number', v_inv.invoice_number, 'receipt_number', v_rnum));

  return v_rnum;
end $$;

revoke all on function public.mark_client_invoice_paid(bigint, date, text) from public;
grant   execute on function public.mark_client_invoice_paid(bigint, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 069.
-- =============================================================
