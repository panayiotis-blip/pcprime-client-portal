-- =============================================================
-- Migration 095: Add form_type to tax_returns
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Lets the practitioner choose which TD1 form variant a return targets
-- (Individuals other-than-self-employed vs. Self-Employed). Defaults to
-- 'individuals' so all existing rows keep their current behaviour.
-- =============================================================

begin;

alter table public.tax_returns
  add column if not exists form_type text not null default 'individuals'
    check (form_type in ('individuals', 'self_employed'));

create index if not exists tax_returns_form_type_idx
  on public.tax_returns (client_id, form_type, tax_year desc);

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 095.
-- =============================================================
