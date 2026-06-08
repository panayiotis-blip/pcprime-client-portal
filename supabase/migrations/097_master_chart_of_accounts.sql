-- Migration 097: Master Chart of Accounts (firm-level)
-- =====================================================
-- Adds a single firm-level master CoA, seeded from the file
-- "chart of accounts New.xls". Each client still has their own per-client
-- accounts table (migration 003); applying the master into a client is
-- additive (insert-if-not-exists by code) so client-specific edits are
-- preserved. New clients are auto-seeded with the master via trigger.

-- -------------------------------------------------------------
-- Per-client accounts: add columns to mirror the master schema
-- -------------------------------------------------------------
alter table public.accounts add column if not exists active boolean not null default true;
alter table public.accounts add column if not exists is_header boolean not null default false;
alter table public.accounts add column if not exists report_category text;

-- -------------------------------------------------------------
-- Master accounts (firm-level)
-- -------------------------------------------------------------
create table if not exists public.master_accounts (
  id bigserial primary key,
  code text not null unique,
  description text not null,
  category text not null default 'Expense',  -- one of: Income, Expense, Asset, Liability, Equity
  type_raw text,                              -- original spreadsheet value (e.g. 'Expenditure', 'Debtor')
  active boolean not null default true,
  is_header boolean not null default false,
  report_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_accounts_code on public.master_accounts(code);
create index if not exists idx_master_accounts_active on public.master_accounts(active);

alter table public.master_accounts enable row level security;

-- Any staff member can read the master (so per-client CoA pages can offer the
-- "Apply Master" button); only supervisor-or-higher can edit.
drop policy if exists "master accounts read" on public.master_accounts;
create policy "master accounts read" on public.master_accounts
  for select using (public.is_admin());

drop policy if exists "master accounts supervisor write" on public.master_accounts;
create policy "master accounts supervisor write" on public.master_accounts
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -------------------------------------------------------------
-- RPC: copy master into one client (insert-if-not-exists)
-- -------------------------------------------------------------
create or replace function public.apply_master_to_client(p_client_id bigint)
returns table(inserted int, skipped int)
language plpgsql security definer set search_path = public
as $$
declare
  v_ins int := 0;
  v_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with ins as (
    insert into public.accounts (client_id, code, description, category, active, is_header, report_category)
    select p_client_id, m.code, m.description, m.category, m.active, m.is_header, m.report_category
    from public.master_accounts m
    where m.active = true
      and not exists (
        select 1 from public.accounts a
        where a.client_id = p_client_id and a.code = m.code
      )
    returning 1
  )
  select count(*)::int into v_ins from ins;

  select count(*)::int into v_skip
  from public.master_accounts m
  where m.active = true
    and exists (
      select 1 from public.accounts a
      where a.client_id = p_client_id and a.code = m.code
    );

  inserted := v_ins;
  skipped := v_skip;
  return next;
end$$;

revoke all on function public.apply_master_to_client(bigint) from public;
grant execute on function public.apply_master_to_client(bigint) to authenticated;

-- -------------------------------------------------------------
-- RPC: copy master into every client (supervisor-only)
-- -------------------------------------------------------------
create or replace function public.apply_master_to_all_clients()
returns table(client_id bigint, inserted int, skipped int)
language plpgsql security definer set search_path = public
as $$
declare
  c record;
  r record;
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'not authorized';
  end if;
  for c in select id from public.clients where deleted_at is null loop
    select * into r from public.apply_master_to_client(c.id);
    client_id := c.id;
    inserted := r.inserted;
    skipped := r.skipped;
    return next;
  end loop;
end$$;

revoke all on function public.apply_master_to_all_clients() from public;
grant execute on function public.apply_master_to_all_clients() to authenticated;

-- -------------------------------------------------------------
-- Trigger: auto-seed master CoA into every newly created client
-- -------------------------------------------------------------
create or replace function public.tg_seed_master_accounts_to_new_client()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.accounts (client_id, code, description, category, active, is_header, report_category)
  select new.id, m.code, m.description, m.category, m.active, m.is_header, m.report_category
  from public.master_accounts m
  where m.active = true
    and not exists (
      select 1 from public.accounts a where a.client_id = new.id and a.code = m.code
    );
  return new;
end$$;

drop trigger if exists trg_seed_master_accounts on public.clients;
create trigger trg_seed_master_accounts
  after insert on public.clients
  for each row execute function public.tg_seed_master_accounts_to_new_client();

-- -------------------------------------------------------------
-- Seed data: 185 accounts from "chart of accounts New.xls"
-- -------------------------------------------------------------
insert into public.master_accounts (code, description, category, type_raw, active, is_header, report_category) values
  ('1000000', 'Sales / Turnover / Services', 'Income', 'Income', true, true, 'Sales'),
  ('1000010', 'Sales / Turnover', 'Income', 'Income', true, false, 'Sales'),
  ('2000000', 'Cost of Goods Sold', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2100000', 'Purchases', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2150000', 'Services Rendered', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2200000', 'Purchases Cost Variance', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2300000', 'Stock Adjustment', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2400000', 'Stock Cost Variance', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2500000', 'Opening Stock', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('2600000', 'Closing Stock', 'Expense', 'Expenditure', true, false, 'Cost Of Sales'),
  ('3010000', 'Discount Received', 'Income', 'Income', true, false, 'Other Income'),
  ('3050000', 'Fixed Asset Disposal', 'Income', 'Income', true, false, 'Other Income'),
  ('3100000', 'Interest Received', 'Income', 'Income', true, false, 'Other Income'),
  ('3120000', 'Dividend Received', 'Income', 'Income', true, false, 'Other Income'),
  ('3150000', 'Commissions Received', 'Income', 'Income', true, false, 'Other Income'),
  ('3190000', 'Rounding Adjustments', 'Income', 'Income', true, false, 'Other Income'),
  ('3200000', 'Other Income', 'Income', 'Income', true, false, 'Other Income'),
  ('3250000', 'Rents received', 'Income', 'Income', true, false, 'Other Income'),
  ('3300000', 'Profit and Loss', 'Income', 'Income', true, false, 'Other Income'),
  ('3400000', 'Profit on Exchange', 'Income', 'Income', true, false, 'Other Income'),
  ('4000000', 'Accounting Fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4010000', 'Audit Fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4050000', 'Advertising', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4070000', 'Ammortization', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4080000', 'Annual levy to the Registrar', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4100000', 'Bad Debts written off', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4150000', 'Bank Charges', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4180000', 'Books & Publications', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4195000', 'Call Center Charge', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4200000', 'Commission Paid', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4210000', 'Common Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4220000', 'Computer Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4230000', 'Consulting', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4235000', 'Consumables', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4250000', 'Contributions', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4300000', 'Depreciation', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4320000', 'Discount Allowed', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4340000', 'Donations', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4350000', 'Directors'' remuneration', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4360000', 'Electricity & Water', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4380000', 'Entertainment (Clients)', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4400000', 'Equipment Rental', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4420000', 'Cleaning & Common Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4440000', 'Finance Charges', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4460000', 'Freight & Delivery', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4470000', 'Gas', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4480000', 'General Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4490000', 'Impairment Charges', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4500000', 'Insurance', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4520000', 'Interest Paid', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4540000', 'Leasing', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4560000', 'Legal Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4580000', 'Licenses & Reg.of Cos fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4585000', 'Management Fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4590000', 'Marketing', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4595000', 'Office Expenses (Clients)', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4600000', 'Motor Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4610000', 'Municipality Charges', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4620000', 'Office Supplies', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4630000', 'Penalties', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4640000', 'Postage & Delivery', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4660000', 'Printing & Stationery', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4670000', 'Security', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4680000', 'Professional Fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4680010', 'Filing fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4685000', 'Rates & Taxes', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4700000', 'Rent', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4720000', 'Repairs & Maint.', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4730000', 'Royalties', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740000', 'Salaries & Wages', 'Expense', 'Expenditure', true, true, 'Expenses'),
  ('4740010', 'Salaries - Gross Payroll', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740020', 'Salaries - Union Fees', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740030', 'Salaries - Employre''s Social Insurance', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740040', 'Salaries - Providend Fund', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740050', 'Salaries - Employer''s Cost-Medical Insurance', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740060', 'Salaries - Special Contribution', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4740070', 'Salaries - Employer''s Other', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4760000', 'Security', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4765000', 'Staff Welfare', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4770000', 'Storage', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4780000', 'Subscriptions', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4800000', 'Telephone', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4830000', 'Tools', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4840000', 'Training & Education', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4845000', 'Traveling Expenses', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4846000', 'Casual Labor / Services Provided', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4850000', 'Uniforms', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4860000', 'Utilities', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4880000', 'Loss on Exchange', 'Expense', 'Expenditure', true, false, 'Expenses'),
  ('4930000', 'Taxation Expense', 'Expense', 'Expenditure', true, false, 'Tax'),
  ('4945000', 'Defence Taxation', 'Expense', 'Expenditure', true, false, 'Tax'),
  ('4948000', 'Dividend Declared / Paid', 'Expense', 'Expenditure', true, false, 'Dividends'),
  ('4999999', 'Transfer of Profit & Loss to BS', 'Expense', 'Expenditure', true, false, 'Transfer of P/L To Balance Sheet'),
  ('5100000', 'Share Capital', 'Equity', 'Equity', true, true, 'Share Capital'),
  ('5100010', 'Share Capital', 'Equity', 'Equity', true, false, 'Share Capital'),
  ('5100020', 'Shareholder 2', 'Equity', 'Equity', true, false, 'Share Capital'),
  ('5100030', 'Shareholder 3', 'Equity', 'Equity', true, false, 'Share Capital'),
  ('5100040', 'Shareholder 4', 'Equity', 'Equity', true, false, 'Share Capital'),
  ('5100050', 'Shareholder 5', 'Equity', 'Equity', true, false, 'Share Capital'),
  ('5200000', 'Accumulated Profit', 'Equity', 'Equity', true, false, 'Retained Income'),
  ('5300000', 'Revaluation Reserve', 'Equity', 'Equity', true, false, 'Other Equity'),
  ('5310000', 'Capital Reserve', 'Equity', 'Equity', true, false, 'Other Equity'),
  ('5400000', 'Loans Payable', 'Liability', 'Liability', true, true, 'Long Term Borrowings'),
  ('5400010', 'Shareholder Loan Account', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5400020', 'Shareholder Current Account', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500000', 'Long Term Loans', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500010', 'Loan Account 1', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500020', 'Loan Account 2', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500030', 'Loan Account 3', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500040', 'Loan Account 4', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500050', 'Loan Account 5', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500060', 'Loan Account 6', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500070', 'Loan Account 7', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500080', 'Loan Account 8', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500090', 'Loan Account 8', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('5500100', 'Loan Account 10', 'Liability', 'Liability', true, false, 'Long Term Borrowings'),
  ('6000000', 'Land and Buildings', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6000010', 'Land and Buildings - Accumulated Depreciation', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6000020', 'Land and Buildings - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6100000', 'Computer Equipment', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6100010', 'Computer Equipment - Accumulated Depreciation', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6100020', 'Computer Equipment - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6200000', 'Furniture & Fittings', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6200010', 'Furniture & Fittings - Accumulated Depreciation', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6200020', 'Furniture & Fittings - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6300000', 'Motor Vehicles', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6300010', 'Motor Vehicles - Accumulated Depreciation', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6300020', 'Motor Vehicles - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6400000', 'Office Equipment', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6400010', 'Office Equipment - Accumulated Depreciation', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6400020', 'Office Equipment - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6500000', 'Plant & Machinery', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6500010', 'Plant & Machinery - Accumulated Depreciation', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6500020', 'Plant & Machinery - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6800000', 'Goodwill', 'Asset', 'Asset', true, true, 'Fixed Assets'),
  ('6800010', 'Goodwill - Cost', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6800020', 'Goodwill - Amortization', 'Asset', 'Asset', true, false, 'Fixed Assets'),
  ('6900000', 'Investment Account', 'Asset', 'Asset', true, false, 'Investments'),
  ('6910000', 'Impairment of investments in subsidiaries', 'Asset', 'Asset', true, false, 'Investments'),
  ('7000000', 'Prepayments', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7100000', 'Rent receivable', 'Asset', 'Debtor', true, false, 'Accounts Receivable'),
  ('7100CASH01', 'CASH CUSTOMER', 'Asset', 'Debtor', true, false, ''),
  ('7110000', 'Provision for Bad Debts', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7200000', 'Recovery', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7300000', 'Staff Loans', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7400000', 'Stock', 'Asset', 'Asset', true, false, 'Inventory'),
  ('7450000', 'Work in Progress', 'Asset', 'Asset', true, false, 'Inventory'),
  ('7500000', 'Sundry Receivables', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7550000', 'Accrued Income', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7560000', 'Rent Deposits', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('7600000', 'Undeposited Funds', 'Asset', 'Asset', true, false, 'Current Assets'),
  ('8400000', 'Cash Float', 'Asset', 'Asset', true, false, 'Bank'),
  ('8410000', 'Credit Card', 'Asset', 'Asset', true, false, 'Bank'),
  ('8420000', 'Bank Account -', 'Asset', 'Asset', true, false, 'Bank'),
  ('8425000', 'Bank Account -', 'Asset', 'Asset', true, false, 'Bank'),
  ('8430000', 'Bank Account -', 'Asset', 'Asset', true, false, 'Bank'),
  ('8440000', 'Petty Cash', 'Asset', 'Asset', true, false, 'Bank'),
  ('9000000', 'Accruals', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9100CYT01', 'CYTA', 'Liability', 'Creditor', true, false, ''),
  ('9100EAC01', 'ELECTRICITY AUTHORITY OF CYPRUS', 'Liability', 'Creditor', true, false, ''),
  ('9100PCP01', 'PC PRIME & CALCULATE CONSULTANTS LIMITED', 'Liability', 'Creditor', true, false, ''),
  ('9200000', 'Payroll Liabilities', 'Liability', 'Liability', true, true, 'Current Liabilities'),
  ('9200010', 'Payroll Liability - Income Tax & Defence', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9200020', 'Payroll Liability - Net Payroll', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9200030', 'Payroll Liability - Social Insurance', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9200040', 'Payroll Liability - Provident Fund', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9200050', 'Payroll Liability - Medical Fund', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9200070', 'Payroll Liability - Payroll Other', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9300000', 'Purchases Accrual', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9350000', 'Receipts Control Account', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9400000', 'Sundry Payables', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9410000', 'Deposits From Clients', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9420000', 'Sundry Provisions', 'Liability', 'Liability', true, true, 'Current Liabilities'),
  ('9420010', 'Provision for legal claims', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9420020', 'Provision for unpaid leave (B/S)', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9420030', 'Legal fees Payable', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9420040', '13th Salary Provision', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9500000', 'Suspense', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9550000', 'Take on Suspense', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9600000', 'VAT Control Account', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9601000', 'Output Vat Account', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9602000', 'Input Vat Account', 'Liability', 'Liability', true, false, 'Current Liabilities'),
  ('9800000', 'Income Tax / Corporation Tax', 'Liability', 'Liability', true, false, 'Taxation'),
  ('9810000', 'Defence Taxation Liability', 'Liability', 'Liability', true, false, 'Taxation'),
  ('9850000', 'Dividends Liability', 'Liability', 'Liability', true, false, 'Current Liabilities')
on conflict (code) do nothing;
