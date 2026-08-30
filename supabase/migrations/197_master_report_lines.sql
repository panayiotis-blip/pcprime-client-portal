-- =====================================================================
-- Migration 197: the master report lines, and what A&F's accounts map to
--
-- P2. Every client's pack is built from one master list of report lines;
-- only the MAPPING differs from client to client. The master here is
-- 'PCP master report lines - draft v2', built from A&F's own chart and
-- its FY2025 and 07/2026 trial balances, 27 August 2026. 87 lines, 16
-- sections, 16 subtotals, two lines carrying no accounts at all because
-- they are derived (B-640 from retained earnings, B-650 from P-900).
--
-- BUILD.md 13 records this list as awaiting mark-up before it is frozen.
-- It is seeded here because a draft in a spreadsheet cannot be mapped
-- against, reported from or corrected in the application -- and because
-- the correcting is the point: a default that is wrong is meant to be
-- overridden on the screen, by a person, with the change audit-logged.
-- Nothing here is frozen by being loaded.
--
-- Two tables do two different jobs, and the difference is what makes
-- "changed from default" and "reset" mean anything:
--
--   mapping_defaults  what the account SHOULD map to, as drafted.
--   mappings          what a person decided instead. Only overrides.
--
-- The effective mapping is the override if there is one, otherwise the
-- default. Reset deletes the override and the default reappears. A
-- default of null is deliberate, not missing: headings and control
-- accounts are not reported anywhere, and saying so is different from
-- not having got to them yet.
-- =====================================================================

set search_path to reporting, public;

create table if not exists mapping_defaults (
  client_id    bigint not null references public.clients(id) on delete cascade,
  account_code text not null,
  -- null means deliberately not reported: a heading or a control account.
  line_id      text,
  source       text not null,
  created_at   timestamptz not null default now(),
  primary key (client_id, account_code)
);

comment on table mapping_defaults is
  'What each account should map to before anybody changes it. reporting.mappings holds only the overrides, so a changed-from-default count is the count of rows there.';

alter table mapping_defaults enable row level security;

-- Dropped first so the whole file can be run again: everything else here
-- is create-if-not-exists or an upsert, and a policy that cannot be
-- recreated is what would make it a one-shot.
drop policy if exists client_scoped on mapping_defaults;
create policy client_scoped on mapping_defaults for all
  using (staff_can_access(client_id))
  with check (staff_can_access(client_id));

grant select, insert, update, delete on mapping_defaults to authenticated;

-- ---------------------------------------------------------------------
-- The practice master. client_id null is what makes it the master.
-- ---------------------------------------------------------------------

insert into templates (kind, client_id, name)
select 'report_lines', null, 'PCP master report lines'
 where not exists (
   select 1 from templates where kind = 'report_lines' and client_id is null
                             and name = 'PCP master report lines');

-- ---------------------------------------------------------------------
-- 87 report lines.
-- ---------------------------------------------------------------------

insert into report_lines (template_id, line_id, statement, section, line_name, sort_order, is_subtotal, is_derived)
select t.id, v.line_id, v.statement, v.section, v.line_name, v.sort_order, v.is_subtotal, v.is_derived
  from templates t
  cross join (values
    ('P-010', 'pl', 'Revenue', 'Local sales', 1, false, false),
    ('P-020', 'pl', 'Revenue', 'Export sales', 2, false, false),
    ('P-030', 'pl', 'Revenue', 'Fees', 3, false, false),
    ('P-040', 'pl', 'Revenue', 'Discounts received', 4, false, false),
    ('P-099', 'pl', 'Revenue', 'Total revenue', 5, true, false),
    ('P-110', 'pl', 'Cost of sales', 'Opening stock', 6, false, false),
    ('P-120', 'pl', 'Cost of sales', 'Purchases', 7, false, false),
    ('P-130', 'pl', 'Cost of sales', 'Direct labour', 8, false, false),
    ('P-140', 'pl', 'Cost of sales', 'Subcontractors', 9, false, false),
    ('P-150', 'pl', 'Cost of sales', 'Production overheads', 10, false, false),
    ('P-160', 'pl', 'Cost of sales', 'Depreciation - production', 11, false, false),
    ('P-170', 'pl', 'Cost of sales', 'Closing stock', 12, false, false),
    ('P-199', 'pl', 'Cost of sales', 'Total cost of sales', 13, true, false),
    ('P-200', 'pl', 'Gross profit', 'Gross profit', 14, true, false),
    ('P-310', 'pl', 'Other income', 'Rent receivable', 15, false, false),
    ('P-320', 'pl', 'Other income', 'Interest received', 16, false, false),
    ('P-330', 'pl', 'Other income', 'Dividends received', 17, false, false),
    ('P-340', 'pl', 'Other income', 'Commission and rebates', 18, false, false),
    ('P-350', 'pl', 'Other income', 'Gains on disposal', 19, false, false),
    ('P-360', 'pl', 'Other income', 'Bad debts recovered', 20, false, false),
    ('P-370', 'pl', 'Other income', 'Sundry income', 21, false, false),
    ('P-399', 'pl', 'Other income', 'Total other income', 22, true, false),
    ('P-410', 'pl', 'Selling and distribution', 'Staff costs - selling', 23, false, false),
    ('P-420', 'pl', 'Selling and distribution', 'Commissions paid', 24, false, false),
    ('P-430', 'pl', 'Selling and distribution', 'Advertising and promotion', 25, false, false),
    ('P-440', 'pl', 'Selling and distribution', 'Discounts allowed', 26, false, false),
    ('P-450', 'pl', 'Selling and distribution', 'Entertainment', 27, false, false),
    ('P-460', 'pl', 'Selling and distribution', 'Packing and delivery', 28, false, false),
    ('P-470', 'pl', 'Selling and distribution', 'Depreciation - selling', 29, false, false),
    ('P-499', 'pl', 'Selling and distribution', 'Total selling and distribution', 30, true, false),
    ('P-510', 'pl', 'Administration', 'Directors'' remuneration', 31, false, false),
    ('P-520', 'pl', 'Administration', 'Staff costs', 32, false, false),
    ('P-530', 'pl', 'Administration', 'Premises costs', 33, false, false),
    ('P-540', 'pl', 'Administration', 'Insurance', 34, false, false),
    ('P-550', 'pl', 'Administration', 'Repairs and maintenance', 35, false, false),
    ('P-560', 'pl', 'Administration', 'Office and administration', 36, false, false),
    ('P-570', 'pl', 'Administration', 'Professional fees', 37, false, false),
    ('P-580', 'pl', 'Administration', 'Motor and travel', 38, false, false),
    ('P-590', 'pl', 'Administration', 'Taxes, levies and penalties', 39, false, false),
    ('P-600', 'pl', 'Administration', 'Bad debts', 40, false, false),
    ('P-610', 'pl', 'Administration', 'Staff training', 41, false, false),
    ('P-620', 'pl', 'Administration', 'Losses on disposal', 42, false, false),
    ('P-630', 'pl', 'Administration', 'Depreciation - administration', 43, false, false),
    ('P-699', 'pl', 'Administration', 'Total administration', 44, true, false),
    ('P-710', 'pl', 'Finance costs', 'Bank and card charges', 45, false, false),
    ('P-720', 'pl', 'Finance costs', 'Interest payable', 46, false, false),
    ('P-730', 'pl', 'Finance costs', 'Interest on taxes and contributions', 47, false, false),
    ('P-740', 'pl', 'Finance costs', 'Exchange differences', 48, false, false),
    ('P-799', 'pl', 'Finance costs', 'Total finance costs', 49, true, false),
    ('P-800', 'pl', 'Result', 'Profit before tax', 50, true, false),
    ('P-810', 'pl', 'Taxation', 'Corporation tax', 51, false, false),
    ('P-820', 'pl', 'Taxation', 'Defence tax', 52, false, false),
    ('P-900', 'pl', 'Result', 'Profit for the period', 53, true, false),
    ('B-010', 'bs', 'Non-current assets', 'Property and equipment - cost', 54, false, false),
    ('B-020', 'bs', 'Non-current assets', 'Property and equipment - depreciation', 55, false, false),
    ('B-030', 'bs', 'Non-current assets', 'Intangible assets', 56, false, false),
    ('B-040', 'bs', 'Non-current assets', 'Investments', 57, false, false),
    ('B-099', 'bs', 'Non-current assets', 'Total non-current assets', 58, true, false),
    ('B-110', 'bs', 'Current assets', 'Stock', 59, false, false),
    ('B-120', 'bs', 'Current assets', 'Trade debtors', 60, false, false),
    ('B-130', 'bs', 'Current assets', 'Other debtors and prepayments', 61, false, false),
    ('B-140', 'bs', 'Current assets', 'Tax and VAT recoverable', 62, false, false),
    ('B-150', 'bs', 'Current assets', 'Related company accounts', 63, false, false),
    ('B-160', 'bs', 'Current assets', 'Cash and bank', 64, false, false),
    ('B-170', 'bs', 'Current assets', 'Suspense', 65, false, false),
    ('B-199', 'bs', 'Current assets', 'Total current assets', 66, true, false),
    ('B-210', 'bs', 'Current liabilities', 'Trade creditors', 67, false, false),
    ('B-220', 'bs', 'Current liabilities', 'Payroll liabilities', 68, false, false),
    ('B-230', 'bs', 'Current liabilities', 'Accruals', 69, false, false),
    ('B-240', 'bs', 'Current liabilities', 'Taxation', 70, false, false),
    ('B-250', 'bs', 'Current liabilities', 'VAT', 71, false, false),
    ('B-260', 'bs', 'Current liabilities', 'Other creditors', 72, false, false),
    ('B-270', 'bs', 'Current liabilities', 'Bank overdraft', 73, false, false),
    ('B-299', 'bs', 'Current liabilities', 'Total current liabilities', 74, true, false),
    ('B-300', 'bs', 'Net current assets', 'Net current assets', 75, true, false),
    ('B-410', 'bs', 'Non-current liabilities', 'Bank loans', 76, false, false),
    ('B-420', 'bs', 'Non-current liabilities', 'Hire purchase', 77, false, false),
    ('B-430', 'bs', 'Non-current liabilities', 'Related company loans', 78, false, false),
    ('B-440', 'bs', 'Non-current liabilities', 'Directors and shareholders accounts (net)', 79, false, false),
    ('B-499', 'bs', 'Non-current liabilities', 'Total non-current liabilities', 80, true, false),
    ('B-500', 'bs', 'Net assets', 'Net assets', 81, true, false),
    ('B-610', 'bs', 'Equity', 'Share capital', 82, false, false),
    ('B-620', 'bs', 'Equity', 'Reserves', 83, false, false),
    ('B-630', 'bs', 'Equity', 'Retained earnings', 84, false, false),
    ('B-640', 'bs', 'Equity', 'Prior year results not yet transferred (audit open)', 85, false, true),
    ('B-650', 'bs', 'Equity', 'Result for the period', 86, false, true),
    ('B-699', 'bs', 'Equity', 'Total equity', 87, true, false)
  ) as v(line_id, statement, section, line_name, sort_order, is_subtotal, is_derived)
 where t.kind = 'report_lines' and t.client_id is null and t.name = 'PCP master report lines'
on conflict (template_id, line_id) do update
   set statement = excluded.statement, section = excluded.section,
       line_name = excluded.line_name, sort_order = excluded.sort_order,
       is_subtotal = excluded.is_subtotal, is_derived = excluded.is_derived;

-- ---------------------------------------------------------------------
-- A&F's drafted mapping: 206 accounts. (header) becomes a null
-- line, which means not reported rather than not yet done.
--
-- The client is found the way 193 finds it -- by a pattern that must
-- match exactly one reporting client, raising otherwise. A seed that
-- cannot say with certainty which client it means must stop, not pick.
-- ---------------------------------------------------------------------

do $$
declare
  v_client  bigint;
  v_matches int;
  -- Two parallel lists rather than 206 tuples: shorter to read, and their
  -- lengths are checked against each other below, which a tuple list cannot
  -- be. An empty entry means deliberately not reported.
  v_codes text[] := string_to_array('2,3,4,5,6,7,42,71,72,78,221,311,1501,1610,1630,1710,1810,1950,2111,2121,2161,2221,2241,2242,2243,2251,2301,2411,2541,2621,2622,2711,2712,2721,2731,2732,2733,2999,3131,3132,3133,3134,3136,3137,3139,3151,3152,3153,3154,3155,3158,3159,3160,3241,3311,3312,3341,3421,3431,3432,3440,3441,3510,3520,3530,3540,3550,3621,3622,3631,3633,3660,3711,3810,3999,4111,4201,4202,4330,4340,4350,4510,4520,4599,5111,5121,5201,5202,5211,5721,5731,5734,5740,5751,5761,5781,5782,5783,5784,6311,6321,6331,6351,6361,6371,6400,6411,6412,6421,6422,6425,6431,6442,6451,6461,6471,6472,6473,6474,6481,6482,6483,7111,7112,7131,7141,7144,7161,7163,7171,7172,7181,7211,7221,7231,7241,7242,7243,7245,7250,7251,7253,7254,7255,7256,7260,7261,7271,7281,7290,7291,7292,7301,7311,7321,7322,7341,7342,7343,7351,7361,7372,7381,7382,7383,7392,7401,7402,7403,7404,7405,7411,7412,7421,7441,7442,7443,7455,7456,7457,7461,7471,7481,7552,7811,7812,7813,7814,7815,7821,7831,7841,7851,7852,7853,7860,7870,8000,8010,9999,15011,16101,16301,17101,18101,33411', ',');
  v_lines text[] := string_to_array(',,,,,,,,,,B-120,B-210,B-010,B-010,B-010,B-010,B-030,B-040,B-110,B-110,B-110,B-120,B-130,B-130,B-120,B-130,B-140,B-140,B-150,B-440,B-440,B-160,B-160,B-160,B-160,B-160,B-160,B-170,B-220,B-220,B-220,B-220,B-260,B-260,B-260,B-230,B-230,B-230,B-230,B-230,B-230,B-230,B-230,B-260,B-410,B-410,B-420,B-240,B-240,B-240,B-240,B-240,B-250,B-250,B-250,B-250,B-250,B-440,B-440,B-430,B-430,B-440,B-260,B-270,B-260,B-610,B-620,B-620,B-620,B-620,B-620,B-630,B-630,B-630,P-010,P-020,P-350,P-360,P-030,P-310,P-320,P-320,P-330,P-340,P-370,P-040,P-350,P-350,P-360,P-110,P-110,P-110,P-170,P-170,P-170,P-120,P-120,P-120,P-130,P-130,P-130,P-140,P-150,P-150,P-150,P-150,P-150,P-150,P-150,P-160,P-150,P-150,P-410,P-410,P-420,P-430,P-440,P-450,P-450,P-460,P-460,P-470,P-510,P-510,P-510,P-520,P-520,P-520,P-520,P-530,P-530,P-530,P-530,P-530,P-530,P-560,P-530,P-540,P-530,P-560,P-560,P-560,P-560,P-580,P-570,P-580,P-570,P-570,P-570,P-570,P-550,P-570,P-560,P-560,P-560,P-610,P-590,P-590,P-590,P-590,P-590,P-600,P-600,P-590,P-570,P-620,P-570,P-560,P-620,P-530,P-560,P-620,P-630,P-530,P-710,P-720,P-710,P-710,P-710,P-720,P-720,P-720,P-730,P-730,P-730,P-740,P-740,P-810,P-820,,B-020,B-020,B-020,B-020,B-030,B-420', ',');
begin
  if array_length(v_codes,1) <> array_length(v_lines,1) then
    raise exception 'codes and lines are different lengths: % vs %', array_length(v_codes,1), array_length(v_lines,1);
  end if;

  select count(*), min(c.id) into v_matches, v_client
    from public.clients c
    join client_settings s on s.client_id = c.id
   where c.deleted_at is null
     and (c.name ilike '%ΗΛΕΚΤΡΑΓΟΡΑ%' or c.name ilike '%ELECTRAGORA%' or c.name ilike '%ELEKTRAGORA%');

  if v_matches <> 1 then
    raise exception 'Refusing to seed the mapping: expected exactly one Elektragora client, found %.', v_matches;
  end if;

  insert into mapping_defaults (client_id, account_code, line_id, source)
  select v_client, v_codes[i], nullif(v_lines[i], ''), 'PCP master report lines draft v2'
    from generate_subscripts(v_codes, 1) as i
  on conflict (client_id, account_code) do update
     set line_id = excluded.line_id, source = excluded.source;
end $$;
