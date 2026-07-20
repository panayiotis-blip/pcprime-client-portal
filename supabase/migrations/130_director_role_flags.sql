-- =============================================================
-- Migration 130: multi-role flags on client_directors
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A person can independently be a Director, Shareholder, Secretary,
-- Signatory and/or UBO. The old single free-text `role` couldn't capture
-- combinations, so reports (who is the secretary? who are the shareholders?)
-- were unreliable. Add independent boolean flags and back-fill them from the
-- existing `role` text. The `role` column is kept for reference.
-- =============================================================

begin;

alter table public.client_directors
  add column if not exists is_director    boolean not null default false,
  add column if not exists is_shareholder boolean not null default false,
  add column if not exists is_secretary   boolean not null default false,
  add column if not exists is_signatory   boolean not null default false,
  add column if not exists is_ubo         boolean not null default false;

-- Back-fill flags from the existing free-text role (case-insensitive contains).
update public.client_directors set
  is_director    = is_director    or role ilike '%director%',
  is_shareholder = is_shareholder or role ilike '%shareholder%' or role ilike '%partner%',
  is_secretary   = is_secretary   or role ilike '%secretary%',
  is_signatory   = is_signatory   or role ilike '%signatory%',
  is_ubo         = is_ubo         or role ilike '%ubo%'
where role is not null;

-- A shareholding % with no role flags → treat as a shareholder.
update public.client_directors set is_shareholder = true
  where coalesce(shareholding_percent, 0) > 0
    and not (is_director or is_shareholder or is_secretary or is_signatory or is_ubo);

-- Anything still unflagged → default to Director (the old default role).
update public.client_directors set is_director = true
  where not (is_director or is_shareholder or is_secretary or is_signatory or is_ubo);

-- Helpful partial indexes for reporting.
create index if not exists client_directors_secretary_idx  on public.client_directors (client_id) where is_secretary;
create index if not exists client_directors_shareholder_idx on public.client_directors (client_id) where is_shareholder;

notify pgrst, 'reload schema';

commit;
