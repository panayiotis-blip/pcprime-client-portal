-- =====================================================================
-- Migration 220: which charts the overview shows is a choice per client
--
-- FIX-3 §4a. The overview drew three charts for every client because
-- three charts were what the prototype drew. A haulier wants cash and
-- bank and the debtor ageing on the front page; a shop wants sales by
-- month and where the money went. So it becomes a choice, kept beside
-- the Client setup switches, and made per client.
--
-- The same shape as section_overrides in migration 217, and for the same
-- reason: a key ABSENT means nobody has decided and the default stands,
-- a key present is a decision. A boolean column with a default cannot
-- say the difference between "off because somebody turned it off" and
-- "off because nobody has looked yet", and that difference is the whole
-- point of putting the choice in front of a person.
--
-- The defaults live in the application, not here, and they are the three
-- charts already drawn -- sales by month, gross margin, where the money
-- went. Nobody's overview changes until somebody chooses.
-- =====================================================================

set search_path to reporting, public;

alter table reporting.client_settings
  add column if not exists chart_choices jsonb not null default '{}'::jsonb;

comment on column reporting.client_settings.chart_choices is
  'Which overview charts this client gets: {chart_key: boolean}. A key absent means nobody has decided and the application default stands; a key present is a decision. See migration 220.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'client_settings_chart_choices_is_object'
  ) then
    alter table reporting.client_settings
      add constraint client_settings_chart_choices_is_object
      check (jsonb_typeof(chart_choices) = 'object');
  end if;
end $$;

-- No new policy and no new grant: client_settings already has both, and
-- they defer to reporting.staff_can_access() like everything else here.
