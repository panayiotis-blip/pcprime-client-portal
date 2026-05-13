-- 036_clients_v3_core.sql
-- Part B core schema for the clients-v3 task. Splits into a separate
-- migration from the tax filings table (037) for readability.
--
--   B1  generate_client_code_v3 — PC-IN/CO/PA-XXX format
--   B2  client_status enum + sync trigger with is_active
--   B4  tags, user_saved_filters, profiles.column_preferences, profiles.open_client_tabs
--   Q4  drop the CHECK constraint on client_directors.role (free-text + UI dropdown)

begin;

-- ============================================================
-- B1 — new code generator
-- ============================================================
-- Format: PC-<TYPE>-NNN (zero-padded to 3 digits).
-- TYPE accepted in many forms: 'IND'/'I'/'individual' -> IN,
-- 'CO'/'C'/'company' -> CO, 'PART'/'P'/'partnership' -> PA.
-- Falls back to XX if type can't be resolved.
create or replace function public.generate_client_code_v3(p_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_n      int := 1;
  v_code   text;
begin
  v_prefix := upper(trim(coalesce(p_type, '')));
  v_prefix := case
    when v_prefix in ('IND', 'I', 'INDIVIDUAL', 'IN') then 'IN'
    when v_prefix in ('CO', 'C', 'COMPANY')          then 'CO'
    when v_prefix in ('PART', 'P', 'PARTNERSHIP', 'PA') then 'PA'
    else 'XX'
  end;

  loop
    v_code := format('PC-%s-%s', v_prefix, lpad(v_n::text, 3, '0'));
    if not exists (
      select 1 from public.clients where client_code = v_code
    ) then
      return v_code;
    end if;
    v_n := v_n + 1;
    if v_n > 9999 then
      raise exception 'Could not generate unique PC-%-code', v_prefix;
    end if;
  end loop;
end $$;

revoke all on function public.generate_client_code_v3(text) from public;
grant   execute on function public.generate_client_code_v3(text) to authenticated;

comment on function public.generate_client_code_v3(text) is
  'V3 code generator: PC-IN-001, PC-CO-001, PC-PA-001 by type. Replaces v2 (3-letter+number) for new clients. Imports preserve source codes verbatim.';

-- ============================================================
-- B2 — client_status enum + sync trigger with is_active
-- ============================================================
alter table public.clients add column if not exists client_status text
  default 'active'
  check (client_status in (
    'active', 'liquidated_dormant', 'deceased',
    'old_client', 'defence_tax_only', 'internal'
  ));

-- Idempotent sync: client_status drives is_active, except when the user
-- explicitly toggles is_active (then we adjust client_status to match).
create or replace function public._tg_clients_sync_status_active()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    -- New row: prefer explicit client_status if set, else derive from is_active.
    if new.client_status is not null then
      new.is_active := (new.client_status = 'active');
    elsif new.is_active is not null then
      new.client_status := case when new.is_active then 'active' else 'old_client' end;
    else
      new.client_status := 'active';
      new.is_active := true;
    end if;
  else
    -- UPDATE: only adjust the field that WASN'T explicitly changed by the user.
    if new.client_status is distinct from old.client_status then
      new.is_active := (new.client_status = 'active');
    elsif new.is_active is distinct from old.is_active then
      if new.is_active then
        new.client_status := 'active';
      else
        -- Flipped off: only override status if it was 'active'; leave other
        -- non-active statuses (deceased / dormant / etc.) alone.
        if old.client_status = 'active' then
          new.client_status := 'old_client';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_clients_sync_status_active on public.clients;
create trigger trg_clients_sync_status_active
  before insert or update on public.clients
  for each row execute function public._tg_clients_sync_status_active();

-- Backfill client_status for existing rows (everyone currently active)
update public.clients
  set client_status = case
    when is_active then 'active'
    else 'old_client'
  end
  where client_status is null;

create index if not exists clients_client_status_idx
  on public.clients (client_status) where deleted_at is null;

-- ============================================================
-- Q4 — drop the CHECK constraint on client_directors.role
-- ============================================================
-- Real data has Director/UBO, Partner/UBO, slash-combos. Free text + UI
-- dropdown with suggested values is the right fit.
alter table public.client_directors drop constraint if exists client_directors_role_check;

-- The default stays 'director' (set in migration 031). Suggested values for
-- the UI dropdown are: Director, Shareholder, UBO, Director/UBO, Partner/UBO,
-- Partner, Secretary, Signatory — but any free text is now accepted.

-- ============================================================
-- B4 — carry-over items (tags, saved filters, column prefs, open tabs)
-- ============================================================

-- B4a: clients.tags text[]
alter table public.clients add column if not exists tags text[] not null default '{}'::text[];
create index if not exists clients_tags_idx on public.clients using gin (tags);

-- B4b: profiles.column_preferences jsonb (which list columns each user shows)
alter table public.profiles add column if not exists column_preferences jsonb not null default '{}'::jsonb;

-- B4c: profiles.open_client_tabs jsonb (which clients are open as tabs)
alter table public.profiles add column if not exists open_client_tabs jsonb not null default '[]'::jsonb;

-- B4d: user_saved_filters table
create table if not exists public.user_saved_filters (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  scope         text not null default 'clients' check (scope in ('clients','tax_filings')),
  filter_config jsonb not null default '{}'::jsonb,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists user_saved_filters_user_idx
  on public.user_saved_filters (user_id, scope);

create or replace function public._tg_user_saved_filters_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_user_saved_filters_updated_at on public.user_saved_filters;
create trigger trg_user_saved_filters_updated_at
  before update on public.user_saved_filters
  for each row execute function public._tg_user_saved_filters_updated_at();

alter table public.user_saved_filters enable row level security;

-- Users read their own saved filters PLUS any flagged is_default=true (which are
-- created/maintained by the app and visible to everyone).
drop policy if exists "saved_filters_read"   on public.user_saved_filters;
drop policy if exists "saved_filters_insert" on public.user_saved_filters;
drop policy if exists "saved_filters_update" on public.user_saved_filters;
drop policy if exists "saved_filters_delete" on public.user_saved_filters;

create policy "saved_filters_read"
  on public.user_saved_filters for select to authenticated
  using (user_id = auth.uid() or is_default = true);

create policy "saved_filters_insert"
  on public.user_saved_filters for insert to authenticated
  with check (user_id = auth.uid() and is_default = false);

create policy "saved_filters_update"
  on public.user_saved_filters for update to authenticated
  using (user_id = auth.uid() and is_default = false)
  with check (user_id = auth.uid() and is_default = false);

create policy "saved_filters_delete"
  on public.user_saved_filters for delete to authenticated
  using (user_id = auth.uid() and is_default = false);

commit;
-- =============================================================
-- Verify:
--   select column_name from information_schema.columns where table_name='clients'
--     and column_name in ('client_status','tags') order by 1;
--   -- expect 2 rows
--
--   select public.generate_client_code_v3('IND');   -- 'PC-IN-001' (or next free)
--   select public.generate_client_code_v3('CO');    -- 'PC-CO-001' (or next free)
--   select public.generate_client_code_v3('PART');  -- 'PC-PA-001' (or next free)
--
--   \d public.user_saved_filters       -- exists
--   select count(*) from pg_constraint where conname = 'client_directors_role_check';
--   -- expect 0
-- =============================================================
