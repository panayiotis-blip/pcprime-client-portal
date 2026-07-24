-- =============================================================
-- Migration 144: Address codes for the saved address book
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Gives every saved address a short code (ADR-0001, ADR-0002, …) so the
-- Address Book page can list them like the client list. Codes are
-- auto-assigned on insert via a trigger; existing rows are backfilled.
-- Requires migration 143 (saved_addresses) to have been run first.
-- =============================================================

begin;

alter table public.saved_addresses add column if not exists code text;

-- Auto-assign an ADR-#### code on insert when one isn't supplied.
create or replace function public.tg_saved_address_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if new.code is null or new.code = '' then
    select coalesce(max((substring(code from 'ADR-(\d+)'))::int), 0) + 1
      into n from public.saved_addresses;
    new.code := 'ADR-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists saved_addresses_code on public.saved_addresses;
create trigger saved_addresses_code before insert on public.saved_addresses
  for each row execute function public.tg_saved_address_code();

-- Backfill existing rows in id order.
with numbered as (
  select id, row_number() over (order by id) as rn
    from public.saved_addresses where code is null
)
update public.saved_addresses s
   set code = 'ADR-' || lpad(n.rn::text, 4, '0')
  from numbered n
 where s.id = n.id;

create unique index if not exists saved_addresses_code_key on public.saved_addresses (code);

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 144.
-- =============================================================
