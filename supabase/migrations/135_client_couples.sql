-- =============================================================
-- Migration 135: client_couples — link two individual clients whose
--                fees are invoiced to one of them
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The firm acts for both halves of a couple but raises a single invoice in
-- one spouse's name covering both. Nothing in the schema recorded that: every
-- invoice addresses one client_id and there is no payer concept.
--
-- Deliberately NOT done here:
--   * No column on client_invoices. The invoice is raised against the payer
--     and its lines cover both people, so the existing single client_id is
--     already correct.
--   * No sharing of records, folders or documents. Those are scoped by their
--     own client_id (migration 004) and stay completely separate — that is
--     the point of a link rather than a merge.
--   * This is NOT merge_clients (migrations 061/133). That one collapses two
--     clients into one and deletes the source. This keeps both.
-- =============================================================

begin;

create table if not exists public.client_couples (
  id              bigserial primary key,
  -- Stored with client_a_id < client_b_id so a pair can only be recorded once,
  -- whichever order it is entered in.
  client_a_id     bigint not null references public.clients(id) on delete cascade,
  client_b_id     bigint not null references public.clients(id) on delete cascade,
  -- Which of the two receives the invoice. Constrained to be one of the pair.
  payer_client_id bigint not null references public.clients(id) on delete restrict,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint client_couples_ordered check (client_a_id < client_b_id),
  constraint client_couples_payer_is_member
    check (payer_client_id = client_a_id or payer_client_id = client_b_id),
  constraint client_couples_unique_pair unique (client_a_id, client_b_id)
);

create index if not exists client_couples_a_idx on public.client_couples (client_a_id);
create index if not exists client_couples_b_idx on public.client_couples (client_b_id);
create index if not exists client_couples_payer_idx on public.client_couples (payer_client_id);

-- A client belongs to at most one couple. The unique constraint above only
-- stops the same pair being entered twice; without this, one client could be
-- linked to two different partners and "who is invoiced" becomes ambiguous.
create or replace function public.tg_client_couples_single_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clash bigint;
begin
  select c.id into v_clash
  from public.client_couples c
  where c.id is distinct from coalesce(new.id, -1)
    and (c.client_a_id in (new.client_a_id, new.client_b_id)
      or c.client_b_id in (new.client_a_id, new.client_b_id))
  limit 1;

  if v_clash is not null then
    raise exception 'One of these clients is already linked to another partner (couple %)', v_clash
      using errcode = 'unique_violation';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists client_couples_single_membership on public.client_couples;
create trigger client_couples_single_membership
  before insert or update on public.client_couples
  for each row execute function public.tg_client_couples_single_membership();

-- ---------- RLS: same shape as the other admin-managed tables ----------
alter table public.client_couples enable row level security;

drop policy if exists "client_couples read" on public.client_couples;
create policy "client_couples read" on public.client_couples
  for select using (public.is_admin());

drop policy if exists "client_couples write" on public.client_couples;
create policy "client_couples write" on public.client_couples
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

commit;

-- =============================================================
-- Verify:
--   select * from public.client_couples;
--
-- Expect the ordering + payer constraints to bite:
--   insert into public.client_couples (client_a_id, client_b_id, payer_client_id)
--   values (5, 5, 5);            -- fails: client_couples_ordered
--   values (2, 5, 9);            -- fails: client_couples_payer_is_member
--   -- linking a client already in a couple fails with unique_violation
-- =============================================================
-- End of migration 135.
-- =============================================================
