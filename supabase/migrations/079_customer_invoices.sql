-- =============================================================
-- Migration 079: Client's own billing — invoices (Phase B)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Invoices a firm-client issues to their own customers. Mirrors the firm's
-- client_invoices but scoped by owner_client_id, billed to a `customer`,
-- with per-client per-year numbering (YYYY-NNN). RLS via
-- user_can_access_client(owner_client_id) — the client and firm staff only.
-- =============================================================

begin;

-- ---------- per-client, per-year numbering ----------
create table if not exists public.customer_invoice_sequences (
  owner_client_id bigint not null references public.clients(id) on delete cascade,
  year            int not null,
  next_number     int not null default 1,
  primary key (owner_client_id, year)
);
alter table public.customer_invoice_sequences enable row level security;
-- No policy: only the security-definer RPC below touches this table.

create or replace function public.next_customer_invoice_number(p_owner bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from current_date)::int;
  v_num  int;
begin
  insert into public.customer_invoice_sequences (owner_client_id, year, next_number)
       values (p_owner, v_year, 2)
  on conflict (owner_client_id, year) do update
       set next_number = public.customer_invoice_sequences.next_number + 1
  returning public.customer_invoice_sequences.next_number - 1 into v_num;
  return v_year::text || '-' || lpad(v_num::text, 3, '0');
end $$;
revoke all on function public.next_customer_invoice_number(bigint) from public;
grant   execute on function public.next_customer_invoice_number(bigint) to authenticated;

-- ---------- customer_invoice ----------
create table if not exists public.customer_invoice (
  id                  bigserial primary key,
  owner_client_id     bigint not null references public.clients(id) on delete cascade,
  customer_id         bigint not null references public.customer(id) on delete restrict,
  invoice_number      text,
  status              text not null default 'draft'
                        check (status in ('draft', 'issued', 'paid', 'cancelled')),
  issue_date          date,
  due_date            date,
  paid_date           date,
  discount_type       text check (discount_type is null or discount_type in ('percent', 'amount')),
  discount_value      numeric(12,2),
  subtotal_vatable    numeric(12,2) not null default 0,
  subtotal_nonvatable numeric(12,2) not null default 0,
  discount_amount     numeric(12,2) not null default 0,
  vat_amount          numeric(12,2) not null default 0,
  total_amount        numeric(12,2) not null default 0,
  notes               text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists customer_invoice_owner_idx on public.customer_invoice (owner_client_id, status, issue_date desc);
create index if not exists customer_invoice_customer_idx on public.customer_invoice (customer_id);

drop trigger if exists tg_ci_updated on public.customer_invoice;
create trigger tg_ci_updated before update on public.customer_invoice
  for each row execute function public.tg_set_updated_at();
drop trigger if exists tg_audit_ci on public.customer_invoice;
create trigger tg_audit_ci after insert or update or delete on public.customer_invoice
  for each row execute function public.tg_audit();

alter table public.customer_invoice enable row level security;
drop policy if exists "customer_invoice rw" on public.customer_invoice;
create policy "customer_invoice rw" on public.customer_invoice
  for all using (public.user_can_access_client(owner_client_id))
  with check (public.user_can_access_client(owner_client_id));

-- ---------- customer_invoice_line ----------
create table if not exists public.customer_invoice_line (
  id          bigserial primary key,
  invoice_id  bigint not null references public.customer_invoice(id) on delete cascade,
  line_no     int not null default 1,
  line_type   text not null default 'fixed' check (line_type in ('fixed', 'expense', 'remarks')),
  description text not null,
  quantity    numeric(12,3) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0,
  vatable     boolean not null default true,
  vat_rate    numeric(5,2) not null default 19.00,
  created_at  timestamptz not null default now()
);
create index if not exists customer_invoice_line_idx on public.customer_invoice_line (invoice_id, line_no);

alter table public.customer_invoice_line enable row level security;
drop policy if exists "customer_invoice_line rw" on public.customer_invoice_line;
create policy "customer_invoice_line rw" on public.customer_invoice_line
  for all using (exists (
    select 1 from public.customer_invoice ci
     where ci.id = customer_invoice_line.invoice_id
       and public.user_can_access_client(ci.owner_client_id)))
  with check (exists (
    select 1 from public.customer_invoice ci
     where ci.id = customer_invoice_line.invoice_id
       and public.user_can_access_client(ci.owner_client_id)));

-- ---------- state RPCs ----------
create or replace function public.issue_customer_invoice(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare v_inv public.customer_invoice%rowtype; v_num text;
begin
  select * into v_inv from public.customer_invoice where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.user_can_access_client(v_inv.owner_client_id) then raise exception 'Not allowed'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only draft invoices can be issued'; end if;
  v_num := public.next_customer_invoice_number(v_inv.owner_client_id);
  update public.customer_invoice
     set status = 'issued', invoice_number = v_num, issue_date = coalesce(issue_date, current_date)
   where id = p_id;
  return v_num;
end $$;
revoke all on function public.issue_customer_invoice(bigint) from public;
grant   execute on function public.issue_customer_invoice(bigint) to authenticated;

create or replace function public.mark_customer_invoice_paid(p_id bigint, p_paid_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inv public.customer_invoice%rowtype;
begin
  select * into v_inv from public.customer_invoice where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.user_can_access_client(v_inv.owner_client_id) then raise exception 'Not allowed'; end if;
  if v_inv.status <> 'issued' then raise exception 'Only issued invoices can be marked paid'; end if;
  update public.customer_invoice
     set status = 'paid', paid_date = coalesce(p_paid_date, current_date)
   where id = p_id;
end $$;
revoke all on function public.mark_customer_invoice_paid(bigint, date) from public;
grant   execute on function public.mark_customer_invoice_paid(bigint, date) to authenticated;

create or replace function public.cancel_customer_invoice(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inv public.customer_invoice%rowtype;
begin
  select * into v_inv from public.customer_invoice where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.user_can_access_client(v_inv.owner_client_id) then raise exception 'Not allowed'; end if;
  if v_inv.status = 'paid' then raise exception 'Paid invoices cannot be cancelled'; end if;
  update public.customer_invoice set status = 'cancelled' where id = p_id;
end $$;
revoke all on function public.cancel_customer_invoice(bigint) from public;
grant   execute on function public.cancel_customer_invoice(bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 079.
-- =============================================================
