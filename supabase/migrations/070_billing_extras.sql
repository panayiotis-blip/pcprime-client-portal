-- =============================================================
-- Migration 070: Billing extras
--   1. client_invoices.services_description — editable fee wording
--   2. service_presets — reusable invoice line descriptions
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================

begin;

-- ---------- 1. Invoice "description of services" ----------
-- A short editable line describing what the invoice covers. New invoices
-- default to "Our fees based on time spent"; it can be edited per invoice.
alter table public.client_invoices
  add column if not exists services_description text
    not null default 'Our fees based on time spent';

-- ---------- 2. Reusable service-line presets ----------
-- A catalogue of service descriptions (with an optional default price) the
-- user can pick from when adding invoice lines — like a stock-item list.
create table if not exists public.service_presets (
  id            bigserial primary key,
  description   text not null,
  default_price numeric(12,2),
  vatable       boolean not null default true,
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists tg_service_presets_updated on public.service_presets;
create trigger tg_service_presets_updated
  before update on public.service_presets
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_service_presets on public.service_presets;
create trigger tg_audit_service_presets
  after insert or update or delete on public.service_presets
  for each row execute function public.tg_audit();

alter table public.service_presets enable row level security;
drop policy if exists "service_presets read"  on public.service_presets;
drop policy if exists "service_presets write" on public.service_presets;
create policy "service_presets read" on public.service_presets
  for select using (public.is_admin());
create policy "service_presets write" on public.service_presets
  for all using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 070.
-- =============================================================
