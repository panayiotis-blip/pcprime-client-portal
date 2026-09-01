-- =====================================================================
-- Migration 217: which sections a client gets is a person's decision
--
-- The ON/OFF column on Client setup has been a statement of what the
-- payload builder worked out from the data. It has to be the opposite:
-- a decision taken when the client is set up, BEFORE a single file is
-- imported, so a client's sections are chosen deliberately rather than
-- appearing the day some data happens to arrive.
--
-- Two things are needed for that, and one thing has to be admitted.
--
-- WHAT HAS TO BE ADMITTED. has_stock and has_payroll are read by
-- nothing. The payload computes `stock` from whether any stock valuation
-- was loaded and `payroll` the same way, straight from the data -- so
-- migration 211's triggers have been faithfully maintaining two columns
-- that no screen has ever consulted. That is why turning them on "fixed"
-- nothing visible: they were never the switch.
--
-- WHAT IS ADDED. section_overrides holds the decisions, one place for
-- all twenty sections rather than twenty columns. A key that is absent
-- means nobody has decided and the old behaviour applies; a key set true
-- or false is a decision, and the builder honours it over anything the
-- data says.
--
--   {"stock": false, "cash": true}
--
-- WHAT CHANGES. has_stock / has_payroll / has_branches become nullable,
-- so null can mean "nobody has decided" as it could not before, and the
-- 211 triggers only write when the column is still null. They stay as
-- what they always were -- a record that this client HAS stock data --
-- and they can no longer contradict a person.
--
-- The existing values are reset to null. They were written by a trigger
-- and a backfill, not by anybody, and leaving them would be recording a
-- decision that nobody took.
-- =====================================================================

set search_path to reporting, public;

alter table client_settings
  add column if not exists section_overrides jsonb not null default '{}'::jsonb;

comment on column client_settings.section_overrides is
  'Which report sections this client gets, as decided by a person: {"stock": false}. A key absent means nobody has decided and the builder works it out from the data. A key present outranks the data and nothing may overwrite it.';

-- The object shape is the whole contract, so it is enforced rather than
-- assumed: an array or a string here would be read as no overrides at all
-- and the decisions would silently stop applying.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'client_settings_section_overrides_is_object'
       and conrelid = 'reporting.client_settings'::regclass
  ) then
    alter table client_settings
      add constraint client_settings_section_overrides_is_object
      check (jsonb_typeof(section_overrides) = 'object');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- null now means "nobody has decided"
-- ---------------------------------------------------------------------
alter table client_settings alter column has_stock    drop not null;
alter table client_settings alter column has_payroll  drop not null;
alter table client_settings alter column has_branches drop not null;

alter table client_settings alter column has_stock    drop default;
alter table client_settings alter column has_payroll  drop default;
alter table client_settings alter column has_branches drop default;

-- Written by a trigger and a backfill rather than by a person. Keeping
-- them would be recording a decision nobody took.
update client_settings
   set has_stock = null, has_payroll = null, has_branches = null
 where has_stock is not null or has_payroll is not null or has_branches is not null;

comment on column client_settings.has_stock is
  'Whether this client has stock. Null means nobody has said, and the report works it out from whether a valuation was loaded. Set by hand it is a decision, and the import trigger will not overwrite it.';
comment on column client_settings.has_payroll is
  'Whether this client has payroll. Null means nobody has said. Set by hand it is a decision, and the import trigger will not overwrite it.';

-- ---------------------------------------------------------------------
-- The triggers become what they were meant to be: a fallback
-- ---------------------------------------------------------------------
create or replace function _switch_on_stock() returns trigger
language plpgsql security definer set search_path = reporting, public as $$
begin
  -- Only where nobody has decided. A person who switched Stock off did so
  -- knowing the valuations exist, and an import must not argue with them.
  update client_settings set has_stock = true, updated_at = now()
   where client_id = new.client_id and has_stock is null;
  return new;
end $$;

create or replace function _switch_on_payroll() returns trigger
language plpgsql security definer set search_path = reporting, public as $$
begin
  update client_settings set has_payroll = true, updated_at = now()
   where client_id = new.client_id and has_payroll is null;
  return new;
end $$;

comment on function _switch_on_stock() is
  'Records that a client has stock the first time a valuation is imported, and only while nobody has decided otherwise. Migration 217 made it a fallback; 211 let it overwrite.';
