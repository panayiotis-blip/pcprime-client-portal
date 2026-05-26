-- =============================================================
-- Migration 078: Client's own billing — foundations (Phase A)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Lets each firm-client run billing for THEIR OWN customers. This phase adds:
--   1. client_company_profile — the client's own invoicing identity (name,
--      VAT, address, logo) that appears on the invoices THEY issue. Seeded
--      from their clients record in the app, but independently editable.
--   2. customer — the client's customers (basic info).
--   3. client-logos storage bucket (public read; scoped write).
-- RLS scopes everything to the owning client via user_can_access_client,
-- so the client and the firm's staff can manage it; other clients cannot.
-- =============================================================

begin;

-- ---------- 1. client_company_profile ----------
create table if not exists public.client_company_profile (
  client_id           bigint primary key references public.clients(id) on delete cascade,
  business_name       text,
  registration_number text,
  vat_number          text,
  address             text,
  phone               text,
  email               text,
  logo_url            text,
  footer              text,
  updated_at          timestamptz not null default now()
);

drop trigger if exists tg_ccp_updated on public.client_company_profile;
create trigger tg_ccp_updated before update on public.client_company_profile
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_ccp on public.client_company_profile;
create trigger tg_audit_ccp after insert or update or delete on public.client_company_profile
  for each row execute function public.tg_audit();

alter table public.client_company_profile enable row level security;
drop policy if exists "ccp read"  on public.client_company_profile;
drop policy if exists "ccp write" on public.client_company_profile;
create policy "ccp read"  on public.client_company_profile
  for select using (public.user_can_access_client(client_id));
create policy "ccp write" on public.client_company_profile
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));

-- ---------- 2. customer ----------
create table if not exists public.customer (
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
create index if not exists customer_owner_idx on public.customer (owner_client_id, name);

drop trigger if exists tg_customer_updated on public.customer;
create trigger tg_customer_updated before update on public.customer
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_customer on public.customer;
create trigger tg_audit_customer after insert or update or delete on public.customer
  for each row execute function public.tg_audit();

alter table public.customer enable row level security;
drop policy if exists "customer read"  on public.customer;
drop policy if exists "customer write" on public.customer;
create policy "customer read"  on public.customer
  for select using (public.user_can_access_client(owner_client_id));
create policy "customer write" on public.customer
  for all using (public.user_can_access_client(owner_client_id))
  with check (public.user_can_access_client(owner_client_id));

-- ---------- 3. client-logos storage bucket ----------
insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', true)
on conflict (id) do nothing;

drop policy if exists "client-logos read"   on storage.objects;
drop policy if exists "client-logos write"  on storage.objects;
drop policy if exists "client-logos update" on storage.objects;
drop policy if exists "client-logos delete" on storage.objects;
create policy "client-logos read" on storage.objects
  for select using (bucket_id = 'client-logos');
create policy "client-logos write" on storage.objects
  for insert with check (bucket_id = 'client-logos'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));
create policy "client-logos update" on storage.objects
  for update using (bucket_id = 'client-logos'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));
create policy "client-logos delete" on storage.objects
  for delete using (bucket_id = 'client-logos'
    and public.user_can_access_client((storage.foldername(name))[1]::bigint));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 078.
-- =============================================================
