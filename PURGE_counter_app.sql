-- =============================================================
-- Maintenance: remove the demo "counter" app everywhere
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- One-off cleanup so the app library holds only the apps in real use
-- (Property Rentals + Management Dashboard) before the payroll app is added.
--
-- The portal now does this from Clients → App Templates → "Remove everywhere",
-- which runs exactly these deletes via the app-grants-admin function. This file
-- is the same job by hand, for while that build is not yet live.
--
-- RUN STEP 1 FIRST and read it. Only run step 2 once the key is confirmed.
-- =============================================================

-- ---------- STEP 1: what is actually there? ----------
-- Every app key in the system, and how much hangs off it.
select
  k.app_key,
  (select name from public.app_templates t where t.key = k.app_key)                     as template_name,
  (select count(*) from public.client_apps       a where a.app_key = k.app_key)         as allocations,
  (select count(*) from public.client_app_data   d where d.app_key = k.app_key)         as data_rows,
  (select count(*) from public.client_app_grants g where g.app_key = k.app_key)         as grants,
  (select count(*) from public.client_app_users  u where u.app_key = k.app_key)         as legacy_logins
from (
  select key as app_key from public.app_templates
  union
  select app_key from public.client_apps
) k
order by k.app_key;

-- Which clients hold the counter app (check this list before deleting):
select ca.client_id, c.name, ca.app_key, ca.enabled
  from public.client_apps ca
  join public.clients c on c.id = ca.client_id
 where ca.app_key ilike '%counter%'
 order by c.name;

-- ---------- STEP 2: purge it ----------
-- Replace 'counter' below with the exact key from step 1 if it differs, then
-- run the whole block. Dependants go first so nothing is left orphaned.
-- THIS DELETES THAT APP'S SAVED DATA FOR EVERY CLIENT. It cannot be undone.

-- begin;
--
-- delete from public.client_app_grants where app_key = 'counter';
-- delete from public.client_app_users  where app_key = 'counter';
-- delete from public.client_app_data   where app_key = 'counter';
-- delete from public.client_apps       where app_key = 'counter';
-- delete from public.app_templates     where key     = 'counter';
--
-- commit;

-- ---------- Verify (should return no rows) ----------
-- select 'template' as where_, key from public.app_templates where key ilike '%counter%'
-- union all select 'allocation', app_key from public.client_apps       where app_key ilike '%counter%'
-- union all select 'data',       app_key from public.client_app_data   where app_key ilike '%counter%'
-- union all select 'grant',      app_key from public.client_app_grants where app_key ilike '%counter%'
-- union all select 'legacy',     app_key from public.client_app_users  where app_key ilike '%counter%';
-- =============================================================
