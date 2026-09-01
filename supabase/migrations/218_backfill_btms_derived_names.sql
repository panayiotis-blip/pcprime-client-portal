-- =====================================================================
-- Migration 218: the migrated files get their derived names
--
-- Seventeen of the eighteen files in A&F's BTMS folder came across from
-- the old reporting-imports bucket, and they carry the names BTMS gave
-- them -- "a&f tb 01 2026.xls". Everything uploaded through the app since
-- is named from its type and its period -- "Trial balance — January
-- 2026.xls" -- with the BTMS name kept on the row as a note.
--
-- Two naming schemes in one folder is worse than either, so the migrated
-- rows are brought over. The name is derived from what the gate recorded
-- about each file, so nothing is invented: the kind and the period are
-- already on reporting.btms_file_checks.
--
-- The BTMS name is not lost. It moves to documents.notes, which is where
-- the app looks for it and where the folder panel prints it underneath
-- the derived name -- it is what a person searches for when they go
-- looking for the export itself.
--
-- ONE FILE IS EXCEPTED. The paysheet arrived with no name at all: the old
-- bucket called it paysheet-<sha256>.xls and no import row pointed at it,
-- so the mover already derived one. Recording that as "As exported:"
-- would attribute to BTMS a name this application invented. It is renamed
-- and its note left empty.
--
-- SAFE TO RE-RUN. Only rows with no note are touched, and a row that has
-- been through this has one.
-- =====================================================================

set search_path to public;

with named as (
  select
    d.id,
    d.file_name,
    case k.kind
      when 'ledger'        then 'Journal listing'
      when 'chart'         then 'Chart of accounts'
      when 'trial_balance' then 'Trial balance'
      when 'stock'         then 'Stock valuation'
      when 'payroll_cost'  then 'Payroll cost analysis'
      when 'payroll_sheet' then 'Payroll paysheet'
      when 'vat_summary'   then 'VAT figures summary'
      when 'vat_return'    then 'VAT return as filed'
      when 'bank_statement' then 'Bank statement'
      when 'detailed_ledger' then 'Detail ledger'
      else 'BTMS export'
    end as kind_name,
    case
      when k.period is null then null
      -- A journal listing covers a span and says so on both sides.
      when k.period like '% to %' then
        to_char(to_date(split_part(k.period, ' to ', 1), 'YYYY-MM-DD'), 'FMMonth YYYY')
        || ' to '
        || to_char(to_date(split_part(k.period, ' to ', 2), 'YYYY-MM-DD'), 'FMMonth YYYY')
      -- Only a stock valuation shows a full date: only it is a count
      -- taken on a day rather than a position at the end of one.
      when k.kind = 'stock' and k.period ~ '^\d{4}-\d{2}-\d{2}$' then
        to_char(to_date(k.period, 'YYYY-MM-DD'), 'FMDD Mon YYYY')
      when k.period ~ '^\d{4}-\d{2}-\d{2}$' then
        to_char(to_date(k.period, 'YYYY-MM-DD'), 'FMMonth YYYY')
      when k.period ~ '^\d{4}-\d{2}$' then
        to_char(to_date(k.period, 'YYYY-MM'), 'FMMonth YYYY')
      else k.period
    end as period_label,
    case when d.file_name ~ '\.[A-Za-z0-9]+$'
         then substring(d.file_name from '\.[A-Za-z0-9]+$') else '' end as ext,
    -- A name this application already derived is not a name BTMS gave.
    d.file_name ~ '^(Journal listing|Detail ledger|Chart of accounts|Trial balance|Stock valuation|Payroll |VAT |Bank statement|Supporting document|BTMS export)'
      as already_derived
  from documents d
  join reporting.btms_file_checks k on k.document_id = d.id
  where d.category = 'btms'
    and d.deleted_at is null
    and coalesce(d.notes, '') = ''
)
update documents d
   set file_name = n.kind_name || coalesce(' — ' || n.period_label, '') || n.ext,
       notes = case when n.already_derived then '' else 'As exported: ' || n.file_name end
  from named n
 where d.id = n.id;
