-- =============================================================
-- Migration 066: keep clients.city in sync with the client's address
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The Clients list (city column + city filter) reads the flat clients.city
-- column, but addresses are stored in client_addresses and nothing kept
-- clients.city up to date — so it was empty / stale.
--
-- This adds a trigger that, whenever a client_addresses row changes, sets
-- clients.city from that client's best address (registered → home →
-- trading → postal). Existing clients are backfilled once.
-- =============================================================

begin;

create or replace function public.tg_sync_client_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cid  bigint := coalesce(new.client_id, old.client_id);
  v_city text;
begin
  select a.city into v_city
  from public.client_addresses a
  where a.client_id = v_cid
    and a.city is not null and trim(a.city) <> ''
  order by case a.address_type
             when 'registered' then 1
             when 'home'       then 2
             when 'trading'    then 3
             when 'postal'     then 4
             else 5
           end
  limit 1;

  update public.clients set city = v_city where id = v_cid;
  return null;
end $$;

drop trigger if exists sync_client_city on public.client_addresses;
create trigger sync_client_city
  after insert or update or delete on public.client_addresses
  for each row execute function public.tg_sync_client_city();

-- One-time backfill of existing clients from their current addresses.
update public.clients c set city = sub.city
from (
  select distinct on (a.client_id) a.client_id, a.city
  from public.client_addresses a
  where a.city is not null and trim(a.city) <> ''
  order by a.client_id,
           case a.address_type
             when 'registered' then 1
             when 'home'       then 2
             when 'trading'    then 3
             when 'postal'     then 4
             else 5
           end
) sub
where c.id = sub.client_id
  and c.city is distinct from sub.city;

commit;
-- =============================================================
-- End of migration 066.
-- =============================================================
