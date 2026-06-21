-- 119_tax_return_checklist.sql
-- Pre-start "do we have everything?" checklist for an individual tax return.
-- Kept in its own column rather than input_data, because the calculator
-- overwrites input_data wholesale on every save.
--
-- Shape:
--   {
--     "items":        { "<itemKey>": true/false, ... },
--     "notes":        "free text — what's still missing",
--     "confirmed_at": "2026-06-21T...Z",
--     "confirmed_by": "<auth uid>"
--   }

ALTER TABLE tax_returns
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tax_returns.checklist IS
  'Pre-start information checklist gate: { items, notes, confirmed_at, confirmed_by }';
