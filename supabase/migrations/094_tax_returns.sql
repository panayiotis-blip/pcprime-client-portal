-- =============================================================
-- Migration 094: Personal tax returns (individual clients only)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- One row per (client, tax_year). `input_data` holds the calculator form
-- state, `results` holds the computed liability snapshot at last save.
-- Tax returns are restricted to clients with client_type = 'individual'
-- (enforced via trigger since PostgreSQL CHECK can't reference another
-- table). The same restriction is enforced at the UI level — the tab
-- only appears for individual clients.
-- =============================================================

begin;

create table if not exists public.tax_returns (
  id               bigserial primary key,
  client_id        bigint  not null references public.clients(id) on delete cascade,
  tax_year         integer not null check (tax_year between 2020 and 2100),
  input_data       jsonb   not null default '{}'::jsonb,
  results          jsonb   not null default '{}'::jsonb,
  status           text    not null default 'draft'
                   check (status in ('draft', 'submitted', 'filed', 'amended')),
  reference_number text,
  notes            text,
  submitted_at     timestamptz,
  created_by       uuid    references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists tax_returns_client_year_uidx
  on public.tax_returns (client_id, tax_year);
create index if not exists tax_returns_client_idx
  on public.tax_returns (client_id, tax_year desc);
create index if not exists tax_returns_status_idx
  on public.tax_returns (status, updated_at desc);

-- ---------- updated_at trigger ----------
drop trigger if exists tax_returns_updated_at on public.tax_returns;
create trigger tax_returns_updated_at before update on public.tax_returns
  for each row execute function public.tg_set_updated_at();

-- ---------- audit trigger ----------
drop trigger if exists tg_audit_tax_returns on public.tax_returns;
create trigger tg_audit_tax_returns after insert or update or delete on public.tax_returns
  for each row execute function public.tg_audit();

-- ---------- individual-only enforcement ----------
create or replace function public.tax_returns_check_individual()
returns trigger language plpgsql as $$
declare v_type text;
begin
  select client_type into v_type from public.clients where id = new.client_id;
  if v_type is null then
    raise exception 'Client % not found', new.client_id;
  end if;
  if v_type <> 'individual' then
    raise exception 'Tax returns can only be created for individual clients (client % is %)', new.client_id, v_type;
  end if;
  return new;
end $$;

drop trigger if exists tax_returns_individual_check on public.tax_returns;
create trigger tax_returns_individual_check before insert or update on public.tax_returns
  for each row execute function public.tax_returns_check_individual();

-- ---------- RLS ----------
alter table public.tax_returns enable row level security;
drop policy if exists "tax_returns read"   on public.tax_returns;
drop policy if exists "tax_returns insert" on public.tax_returns;
drop policy if exists "tax_returns update" on public.tax_returns;
drop policy if exists "tax_returns delete" on public.tax_returns;
create policy "tax_returns read"   on public.tax_returns
  for select using (public.user_can_access_client(client_id));
create policy "tax_returns insert" on public.tax_returns
  for insert with check (public.user_can_access_client(client_id));
create policy "tax_returns update" on public.tax_returns
  for update using      (public.user_can_access_client(client_id))
              with check (public.user_can_access_client(client_id));
create policy "tax_returns delete" on public.tax_returns
  for delete using (public.is_admin());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 094.
-- =============================================================
