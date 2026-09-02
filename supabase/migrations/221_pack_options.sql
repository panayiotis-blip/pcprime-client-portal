-- =====================================================================
-- Migration 221: what the standard pack looks like, per client
--
-- FIX-3 §5a. The management summary prints every month twice -- a value
-- and a percentage of sales -- and the partner wants that switchable,
-- because with the percentages off each month is one column instead of
-- two and there is nearly twice the room for the figures. It is not a
-- preference of whoever is looking: it is part of what THAT client's
-- pack looks like, so it is kept with the client.
--
-- One jsonb rather than a column per switch, with the same rule as
-- section_overrides (migration 217) and chart_choices (migration 220):
-- a key ABSENT means nobody has decided and the application default
-- stands, a key present is a decision. Three stores that behave the same
-- way is a pattern; three that behave differently is how a screen starts
-- lying about what it was told.
--
-- The defaults live in the application, not here. Today the only key is
-- summaryPercent, whose default is true -- which is what the summary has
-- always done, so nobody's pack changes until somebody chooses.
-- =====================================================================

set search_path to reporting, public;

alter table reporting.client_settings
  add column if not exists pack_options jsonb not null default '{}'::jsonb;

comment on column reporting.client_settings.pack_options is
  'How this client''s pack is laid out: {option_key: boolean}. A key absent means nobody has decided and the application default stands; a key present is a decision. See migration 221.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'client_settings_pack_options_is_object'
  ) then
    alter table reporting.client_settings
      add constraint client_settings_pack_options_is_object
      check (jsonb_typeof(pack_options) = 'object');
  end if;
end $$;

-- No new policy and no new grant: client_settings already has both, and
-- they defer to reporting.staff_can_access() like everything else here.
