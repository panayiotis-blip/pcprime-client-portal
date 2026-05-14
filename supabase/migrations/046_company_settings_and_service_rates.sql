-- =============================================================
-- Migration 046: Company Settings + Per-Service Staff Rates
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Two related additions:
--
-- 1. public.company_settings — single-row table holding the firm's
--    own details (name, address, logo, default service rates, etc.).
--    The single-row constraint is enforced via PK = 1 + a CHECK so
--    no one can accidentally insert a second row.
--
-- 2. public.staff_service_rates — per-staff override of the firm-wide
--    default rate, for a given service. A staff member who has no
--    row here for a given service falls back to the company default
--    for that service, and then to profiles.hourly_rate.
--
-- The rate-snapshot trigger on time_entries (from migration 045) is
-- updated to follow the new lookup order:
--   1. staff_service_rates (user_id, service)
--   2. company_settings.default_service_rates ->> service
--   3. profiles.hourly_rate
-- =============================================================

begin;

-- ---------- 1. company_settings (single row) ----------
create table if not exists public.company_settings (
  id                       int primary key default 1
                            check (id = 1),
  name                     text,
  legal_name               text,
  registration_number      text,
  tax_id                   text,
  vat_number               text,
  address_line1            text,
  address_line2            text,
  city                     text,
  postal_code              text,
  country                  text,
  phone                    text,
  email                    text,
  website                  text,
  iban                     text,
  bank_name                text,
  logo_url                 text,
  tagline                  text,
  report_footer            text,
  -- jsonb map: { "Bookkeeping": 40, "VAT": 45, ... }
  default_service_rates    jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

-- Ensure the row exists so the UI's update calls always have something
-- to UPDATE (avoids "insert then update" race in the form).
insert into public.company_settings (id) values (1)
on conflict (id) do nothing;

-- updated_at trigger
drop trigger if exists company_settings_updated_at on public.company_settings;
create trigger company_settings_updated_at before update on public.company_settings
  for each row execute function public.tg_set_updated_at();

-- audit trigger
drop trigger if exists tg_audit_company_settings on public.company_settings;
create trigger tg_audit_company_settings
  after insert or update or delete on public.company_settings
  for each row execute function public.tg_audit();

alter table public.company_settings enable row level security;

drop policy if exists "company_settings read"  on public.company_settings;
drop policy if exists "company_settings write" on public.company_settings;

-- All authenticated staff can READ (the logo + name appear on printables).
create policy "company_settings read" on public.company_settings
  for select using (public.is_admin());

-- Only owner/supervisor can edit firm details.
create policy "company_settings write" on public.company_settings
  for all using (
    exists (select 1 from public.profiles
            where id = auth.uid() and role in ('owner', 'supervisor'))
  )
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid() and role in ('owner', 'supervisor'))
  );

-- ---------- 2. staff_service_rates (per-staff override) ----------
create table if not exists public.staff_service_rates (
  user_id     uuid not null references auth.users(id) on delete cascade,
  service     text not null check (service in (
                'Bookkeeping','VAT','Payroll','Audit','Tax Returns',
                'Company Admin','Meetings','Other'
              )),
  rate        numeric(10,2) not null check (rate >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, service)
);

create index if not exists staff_service_rates_user_idx
  on public.staff_service_rates (user_id);

drop trigger if exists staff_service_rates_updated_at on public.staff_service_rates;
create trigger staff_service_rates_updated_at before update on public.staff_service_rates
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_staff_service_rates on public.staff_service_rates;
create trigger tg_audit_staff_service_rates
  after insert or update or delete on public.staff_service_rates
  for each row execute function public.tg_audit();

alter table public.staff_service_rates enable row level security;

drop policy if exists "staff_service_rates read"  on public.staff_service_rates;
drop policy if exists "staff_service_rates write" on public.staff_service_rates;

create policy "staff_service_rates read" on public.staff_service_rates
  for select using (public.is_admin());

create policy "staff_service_rates write" on public.staff_service_rates
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 3. Updated rate snapshot trigger ----------
-- Replaces the migration-045 trigger function with one that follows the new
-- lookup order. The trigger itself is already attached to time_entries; we
-- just swap the function body.
create or replace function public.tg_time_entries_snapshot_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric(10,2);
  v_default jsonb;
begin
  if new.rate_snapshot is not null then
    return new;
  end if;

  -- 1. staff-specific override for this service
  select rate into v_rate
    from public.staff_service_rates
   where user_id = new.user_id and service = new.service;

  -- 2. company default for this service
  if v_rate is null then
    select default_service_rates into v_default
      from public.company_settings
     where id = 1;
    if v_default is not null and v_default ? new.service then
      v_rate := nullif(v_default->>new.service, '')::numeric(10,2);
    end if;
  end if;

  -- 3. staff flat rate
  if v_rate is null then
    select hourly_rate into v_rate
      from public.profiles where id = new.user_id;
  end if;

  new.rate_snapshot := v_rate;
  return new;
end $$;

-- ---------- 4. Storage bucket for the company logo ----------
-- Public bucket so the logo can be embedded directly in print/PDF
-- output via its public URL. Logo is brand material, not sensitive.
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do nothing;

-- Storage policies for the bucket. Anyone can read (bucket is public),
-- only owner/supervisor can write.
drop policy if exists "company-assets read"  on storage.objects;
drop policy if exists "company-assets write" on storage.objects;

create policy "company-assets read" on storage.objects
  for select using (bucket_id = 'company-assets');

create policy "company-assets write" on storage.objects
  for all using (
    bucket_id = 'company-assets'
    and exists (select 1 from public.profiles
                where id = auth.uid() and role in ('owner','supervisor'))
  )
  with check (
    bucket_id = 'company-assets'
    and exists (select 1 from public.profiles
                where id = auth.uid() and role in ('owner','supervisor'))
  );

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 046.
-- =============================================================
