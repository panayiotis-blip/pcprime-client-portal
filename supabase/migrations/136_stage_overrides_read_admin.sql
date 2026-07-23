-- =============================================================
-- Migration 136: tighten client_service_stage_overrides read policy
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Security review finding F1: the read policy on
-- client_service_stage_overrides was `using (true)`, so the row-level check
-- passed for any role — the table's per-client date overrides were readable by
-- anyone the table grant let in, unlike every sibling service table.
--
-- The only reader is the admin Services tab (api.getClientStageOverrides), and
-- the write policy is already is_admin(). This brings read into line with the
-- write and with service_definitions / service_stages / service_deliverables,
-- all of which are is_admin()-read. No app change: is_admin() includes the
-- staff tier that opens the Services tab.
-- =============================================================

begin;

drop policy if exists "stage_overrides read" on public.client_service_stage_overrides;
create policy "stage_overrides read" on public.client_service_stage_overrides
  for select using (public.is_admin());

commit;

-- =============================================================
-- Verify:
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'public.client_service_stage_overrides'::regclass;
--   -- expect the read policy's using_expr to be is_admin(), not `true`.
-- =============================================================
-- End of migration 136.
-- =============================================================
