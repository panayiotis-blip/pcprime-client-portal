-- =============================================================
-- Phase 1: Profiles, Clients, User-Client links
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================

-- -------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  role text not null check (role in ('admin', 'client')) default 'client',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id bigserial primary key,
  client_code text unique,
  name text not null,
  trading_name text,
  tax_number text,
  vat_number text,
  registration_number text,
  employer_number text,
  ergani_number text,
  social_insurance_number text,
  id_number text,
  passport_number text,
  contact_person text,
  director_name text,
  business_type text,
  services text,
  monthly_fee numeric(12,2),
  status text default 'active',
  address text,
  phone text,
  email text,
  kyc_completed boolean default false,
  kyc_expiry_date date,
  kyc_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_clients (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id bigint not null references public.clients(id) on delete cascade,
  primary key (user_id, client_id)
);

-- -------------------------------------------------------------
-- updated_at trigger for clients
-- -------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
  for each row execute function public.tg_set_updated_at();

-- -------------------------------------------------------------
-- Helper functions (used by RLS)
-- -------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

create or replace function public.user_can_access_client(cid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.user_clients
      where user_id = auth.uid() and client_id = cid
    );
$$;

-- -------------------------------------------------------------
-- Auto-create profile row when a new auth.users row is created
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'client'),
    true
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.clients      enable row level security;
alter table public.user_clients enable row level security;

-- PROFILES
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles admin all" on public.profiles;
create policy "profiles admin all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- CLIENTS
drop policy if exists "clients read linked or admin" on public.clients;
create policy "clients read linked or admin" on public.clients
  for select using (public.user_can_access_client(id));

drop policy if exists "clients admin write" on public.clients;
create policy "clients admin write" on public.clients
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "clients linked user update" on public.clients;
create policy "clients linked user update" on public.clients
  for update using (public.user_can_access_client(id))
  with check (public.user_can_access_client(id));

-- USER_CLIENTS
drop policy if exists "user_clients read self or admin" on public.user_clients;
create policy "user_clients read self or admin" on public.user_clients
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_clients admin write" on public.user_clients;
create policy "user_clients admin write" on public.user_clients
  for all using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------
-- Bootstrap: first admin
-- After you sign up the first time via the app, run this manually
-- in SQL Editor to grant yourself admin:
--   update public.profiles set role = 'admin' where username = 'admin';
-- -------------------------------------------------------------
