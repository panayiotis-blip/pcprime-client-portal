-- =============================================================
-- Migration 145: Custom (ad-hoc) per-client services
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The service catalogue (service_definitions) carries stages, cadences
-- and email/task automation, so it stays admin-managed. But some clients
-- need a one-off service that isn't in the catalogue. This lets a
-- client_services row be EITHER a catalogue service (service_id set) OR a
-- custom label (service_id NULL, custom_label set).
--
-- Custom rows are record-only: the scheduler RPC and pending-email view
-- INNER JOIN service_definitions, so a NULL service_id row is naturally
-- excluded from all automation — no RPC/view change needed.
-- =============================================================

begin;

alter table public.client_services alter column service_id drop not null;
alter table public.client_services add column if not exists custom_label text;

-- A row must be a catalogue service or carry a non-empty custom label.
alter table public.client_services
  drop constraint if exists client_services_service_or_custom;
alter table public.client_services
  add constraint client_services_service_or_custom
  check (service_id is not null or (custom_label is not null and btrim(custom_label) <> ''));

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 145.
-- =============================================================
