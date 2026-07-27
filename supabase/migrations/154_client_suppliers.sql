-- =============================================================
-- Migration 154: Per-client suppliers (mirror of customer)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Each client already has a `customer` list (their own sales customers).
-- This adds the matching `supplier` list so the firm can hold the client's
-- suppliers and bulk-email them on the client's behalf (e.g. statements).
-- Same shape and RLS as customer (scoped by owner_client_id).
-- =============================================================

begin;

create table if not exists public.supplier (
  id              bigserial primary key,
  owner_client_id bigint not null references public.clients(id) on delete cascade,
  name            text not null,
  contact_person  text,
  email           text,
  phone           text,
  vat_number      text,
  address         text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists supplier_owner_idx on public.supplier (owner_client_id, name);

drop trigger if exists supplier_updated_at on public.supplier;
create trigger supplier_updated_at before update on public.supplier
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_supplier on public.supplier;
create trigger tg_audit_supplier
  after insert or update or delete on public.supplier
  for each row execute function public.tg_audit();

alter table public.supplier enable row level security;

drop policy if exists "supplier read"  on public.supplier;
drop policy if exists "supplier write" on public.supplier;

create policy "supplier read" on public.supplier
  for select using (public.user_can_access_client(owner_client_id));

create policy "supplier write" on public.supplier
  for all using (public.user_can_access_client(owner_client_id))
  with check (public.user_can_access_client(owner_client_id));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 154.
-- =============================================================
