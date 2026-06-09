-- Migration 106: Service deliverables + Consulting Services
-- ============================================================
-- Each service in the catalogue now has a list of deliverables — the
-- concrete tasks we perform when the service is engaged. The engagement
-- letter renders these as sub-bullets under each service so the client
-- (and the firm) sees the full scope at a glance, and so pricing
-- discussions reference specific deliverables.

-- ---------- 1. Add Consulting Services to the catalogue ----------
insert into public.service_definitions (key, label, description, ordinal) values
  ('consulting', 'Consulting Services',
   'Business advisory, financial analysis, and strategic planning engagements.',
   70)
on conflict (key) do nothing;

-- ---------- 2. service_deliverables table ----------
create table if not exists public.service_deliverables (
  id bigserial primary key,
  service_id bigint not null references public.service_definitions(id) on delete cascade,
  ordinal int not null default 0,
  label text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_deliverables_service_idx
  on public.service_deliverables (service_id, ordinal);

alter table public.service_deliverables enable row level security;

drop policy if exists "service_deliverables read" on public.service_deliverables;
create policy "service_deliverables read" on public.service_deliverables
  for select using (public.is_admin());

drop policy if exists "service_deliverables write" on public.service_deliverables;
create policy "service_deliverables write" on public.service_deliverables
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- ---------- 3. Seed deliverables per service (idempotent) ----------
-- Each block guards on the service having no deliverables yet, so re-running
-- this migration doesn't duplicate.

-- Payroll
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Prepare and review monthly payroll',
      'Calculation of gross/net pay, deductions, allowances and overtime per employee.'),
  (2, 'Generate payslips and payment summary',
      'Issue payslips to employees and a payment summary for client approval.'),
  (3, 'Social Insurance (SI/GHS) monthly submission',
      'Calculate, prepare and submit monthly SI and GHS contributions.'),
  (4, 'PAYE monthly submission',
      'Calculate, withhold and submit monthly PAYE income tax to the Tax Department.'),
  (5, 'TD7 annual employer''s declaration',
      'Prepare and submit the annual TD7 employer''s return to the Tax Department.'),
  (6, 'TD63 annual employee certificates',
      'Prepare and distribute TD63 income tax certificates for each employee.'),
  (7, 'Year-end payroll reconciliation',
      'Reconcile annual payroll totals against SI, PAYE and accounting records.'),
  (8, 'New starter and leaver processing',
      'Register new employees and de-register leavers with Social Insurance and the Tax Department.')
) as v(ordinal, label, description)
where s.key = 'payroll'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);

-- VAT Return
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Quarterly VAT return preparation and submission',
      'Prepare the VAT return from accounting records and file via TaxisNet.'),
  (2, 'Monthly VIES return preparation and submission',
      'Prepare and submit the monthly VIES (EU sales/services) return.'),
  (3, 'VAT advisory',
      'Advice on VAT treatment of transactions, reverse charge, OSS, etc.'),
  (4, 'VAT registration / deregistration',
      'Assist with VAT registration when turnover thresholds are reached or deregistration when ceased.')
) as v(ordinal, label, description)
where s.key = 'vat_return'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);

-- Annual Accounts
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Annual financial statements preparation',
      'Prepare the year-end financial statements in accordance with IFRS for SMEs / IFRS as applicable.'),
  (2, 'Liaison with external auditors',
      'Coordinate the audit, respond to queries and provide schedules / breakdowns.'),
  (3, 'Corporate income tax return',
      'Prepare and submit the IR4 corporate tax return.'),
  (4, 'Annual UBO submission',
      'Prepare and submit the Ultimate Beneficial Owner declaration to the Registrar.'),
  (5, 'Statutory filings with Registrar of Companies',
      'Annual return (HE32), changes of directors/secretary, share allotments and other statutory filings.'),
  (6, 'Year-end management reporting',
      'Final year-end review with management — financial position, key ratios, recommendations.')
) as v(ordinal, label, description)
where s.key = 'annual_accounts'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);

-- Bookkeeping
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Recording accounting transactions',
      'Post all sales, purchases, expenses, journals and adjustments into the accounting system monthly.'),
  (2, 'Bank reconciliation',
      'Reconcile every bank account monthly to identify and resolve discrepancies.'),
  (3, 'Maintenance of accounting records',
      'Maintain proper books and records in accordance with Cyprus law.'),
  (4, 'Quarterly management accounts (P&L)',
      'Produce a quarterly profit & loss with comparatives and brief commentary.'),
  (5, 'Debtors and creditors monitoring',
      'Maintain debtor/creditor ledgers, age analysis, and flag overdue items.'),
  (6, 'Chart of accounts maintenance',
      'Maintain the chart of accounts; add new ledger codes as needed for new transactions / categories.')
) as v(ordinal, label, description)
where s.key = 'bookkeeping'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);

-- Individual Tax Return
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Personal tax return (TD1) preparation',
      'Prepare the individual tax return based on employment, rental, dividend, interest and other income.'),
  (2, 'Calculation of personal tax liability',
      'Compute the final tax due / refundable, including SDC and GeSY where applicable.'),
  (3, 'Submission via TaxisNet',
      'Electronic filing of the TD1 via TaxisNet before the statutory deadline.'),
  (4, 'Tax planning advice',
      'Identify allowances, deductions and reliefs (life insurance, provident, donations, etc.) to optimise the position.')
) as v(ordinal, label, description)
where s.key = 'individual_tax_return'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);

-- Tax Payments
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Provisional Tax — calculation and submission',
      'Calculate and submit the two provisional tax instalments (July and December).'),
  (2, 'Provisional Tax — revision',
      'Revise the provisional declaration when profit estimates change to avoid penalties.'),
  (3, 'SDC payment on rents, dividends and interest',
      'Calculate and submit the Special Defence Contribution due bi-annually (June and December).'),
  (4, 'GeSY contributions on passive income',
      'Calculate and submit the General Healthcare System contributions due alongside SDC.'),
  (5, 'Self-employed Social Insurance + GeSY',
      'Calculate and arrange payment of quarterly self-employed SI and GeSY contributions.'),
  (6, 'Annual GeSY reconciliation',
      'Reconcile annual GeSY contributions at year-end and arrange any balancing payment.')
) as v(ordinal, label, description)
where s.key = 'tax_payments'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);

-- Consulting Services
insert into public.service_deliverables (service_id, ordinal, label, description)
select s.id, v.ordinal, v.label, v.description
from public.service_definitions s
cross join (values
  (1, 'Periodic client meetings / business review',
      'Bi-monthly or quarterly meetings to review performance, plans and concerns.'),
  (2, 'Financial analysis and reporting',
      'Bespoke analysis — KPI reports, margin analysis, scenario modelling.'),
  (3, 'Strategic planning support',
      'Assistance with business planning, budgeting and forecasting.'),
  (4, 'Tax planning and optimisation',
      'Strategic tax advice for the company and its shareholders.'),
  (5, 'Cash flow management advice',
      'Working-capital review, cash forecasting and treasury recommendations.'),
  (6, 'Acquisition / disposal support',
      'Due diligence, valuation indications, deal structuring support.'),
  (7, 'Business plan preparation',
      'Structured business plans for funding, investor presentations or internal use.'),
  (8, 'Restructuring and reorganisation support',
      'Advice on group restructuring, share transfers, mergers and demergers.'),
  (9, 'Banking and finance support',
      'Loan applications, lender liaison and covenant compliance reporting.'),
  (10, 'Other ad-hoc advisory engagements',
      'Any additional advisory work agreed separately under a Statement of Work.')
) as v(ordinal, label, description)
where s.key = 'consulting'
  and not exists (select 1 from public.service_deliverables d where d.service_id = s.id);
