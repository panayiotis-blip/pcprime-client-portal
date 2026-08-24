-- =============================================================
-- Migration 186: built-in apps join the template list
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- WHY. There were two kinds of app and they behaved differently. Uploaded ones
-- were rows in app_templates: versioned, allocatable from one screen, with
-- active/restricted flags an admin could change. Built-in ones (rentals, mgmt)
-- were code — allocated from a different screen, with their flags frozen in
-- clientApps.ts. That split is why `rentals` accumulated ten allocations when
-- one was intended, and why "which clients have this app" had two answers.
--
-- A built-in becomes a row too, carrying a builtin_asset path instead of html.
-- Its FILES still ship in the build and still render from public/<app>/ — this
-- row is about identity and allocation, not about serving the app.
--
-- html is therefore no longer mandatory, and a CHECK keeps the promise that
-- every row is renderable one way or the other: uploaded rows carry html,
-- built-in rows carry an asset path, never neither.
--
-- NOT INCLUDED: mgmt-report. It runs as portal code rather than in a frame
-- (component: true, staffOnly: true) and reads the client's real invoices under
-- the caller's own RLS, so it is not a template in any useful sense and stays
-- in the registry.
--
-- FORKING. Per an explicit decision on 2026-08-24, built-ins are NOT forkable
-- per client: html_override on a built-in would cut that client off from every
-- future fix — including the one that had been silently destroying uploaded
-- contracts. Customisation for built-ins is configuration, held per client in
-- client_app_data. See docs/APP_ALLOCATION_DESIGN.md.
-- =============================================================

begin;

alter table public.app_templates add column if not exists builtin_asset text;
alter table public.app_templates alter column html drop not null;

alter table public.app_templates drop constraint if exists app_templates_renderable;
alter table public.app_templates add constraint app_templates_renderable
  check (html is not null or builtin_asset is not null);

-- Metadata mirrors what clientApps.ts has been declaring, so nothing visibly
-- changes on the day this runs — the source of truth moves, the values do not.
insert into public.app_templates (key, name, icon, description, builtin_asset, restricted, active)
values
  ('rentals', 'Property Rentals', '🏠',
   'Tenants & contracts, rent schedule, receipts, arrears, deposits and statements.',
   '/rental-app/', false, true),
  ('mgmt', 'Management Dashboard (Greson Easy Loo)', '📊',
   'Built for Greson Easy Loo only — their financials, P&L, divisions, payroll, rentals and operations.',
   '/mgmt-app/', true, true)   -- restricted: written around one client, never offer it to another
on conflict (key) do update
  set builtin_asset = excluded.builtin_asset,
      description   = coalesce(public.app_templates.description, excluded.description);

commit;

-- =============================================================
-- Verify:
--   select key, name, restricted, active, builtin_asset,
--          case when html is null then 'built-in' else 'uploaded' end as kind
--     from public.app_templates order by key;
-- =============================================================
-- End of migration 186.
-- =============================================================
