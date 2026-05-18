-- =============================================================
-- Migration 063: seed starter task templates
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Loads six ready-made task templates for an accounting / bookkeeping /
-- business-consulting practice. Each is fully editable afterwards in
-- Company Settings → Templates.
--
-- Safe to re-run: a template is only inserted if its name doesn't already
-- exist, and its items only if that template has none yet.
-- =============================================================

begin;

-- ---- Templates ----
insert into public.task_templates (name, description)
select v.name, v.description
from (values
  ('New Client Onboarding',          'Bring a new client on board — KYC, engagement, registrations and setup.'),
  ('Monthly Bookkeeping',            'Recurring monthly bookkeeping cycle for a client.'),
  ('VAT Return',                     'Prepare and submit a client''s VAT return.'),
  ('Annual Accounts & Corporate Tax','Year-end accounts, audit liaison and corporate tax filing.'),
  ('Monthly Payroll',                'Monthly payroll run and Social Insurance filing.'),
  ('Business Consulting Engagement', 'A consulting engagement from kick-off to follow-up.')
) as v(name, description)
where not exists (
  select 1 from public.task_templates t where t.name = v.name
);

-- ---- Items, per template ----
-- helper: insert a values-list of items for the template named :tname
-- (each block guards on the template having no items yet).

insert into public.task_template_items (template_id, ordinal, title, default_priority, days_offset)
select t.id, v.ordinal, v.title, v.priority, v.days_offset
from public.task_templates t
cross join (values
  (1, 'Collect KYC documents (ID, proof of address, structure)', 'high',   0),
  (2, 'Sign engagement letter',                                  'high',   2),
  (3, 'Set up client in portal & accounting system',             'medium', 3),
  (4, 'Register / verify tax & VAT numbers (TAXISNET access)',    'medium', 5),
  (5, 'Obtain prior-year accounts & opening balances',            'medium', 7),
  (6, 'Introductory meeting & confirm scope of services',         'low',    10)
) as v(ordinal, title, priority, days_offset)
where t.name = 'New Client Onboarding'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, ordinal, title, default_priority, days_offset)
select t.id, v.ordinal, v.title, v.priority, v.days_offset
from public.task_templates t
cross join (values
  (1, 'Collect monthly documents from client', 'medium', 0),
  (2, 'Post purchase & sales invoices',        'medium', 5),
  (3, 'Bank reconciliation',                   'high',   8),
  (4, 'Review & post adjustments',             'medium', 10),
  (5, 'Prepare management figures',            'low',    12)
) as v(ordinal, title, priority, days_offset)
where t.name = 'Monthly Bookkeeping'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, ordinal, title, default_priority, days_offset)
select t.id, v.ordinal, v.title, v.priority, v.days_offset
from public.task_templates t
cross join (values
  (1, 'Gather purchase & sales invoices for the period', 'high',   0),
  (2, 'Reconcile VAT input / output',                    'high',   3),
  (3, 'Prepare VAT return',                              'high',   5),
  (4, 'Senior review',                                   'high',   7),
  (5, 'Submit VAT return on TAXISNET',                   'urgent', 9),
  (6, 'File confirmation & advise client of payment',    'medium', 10)
) as v(ordinal, title, priority, days_offset)
where t.name = 'VAT Return'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, ordinal, title, default_priority, days_offset)
select t.id, v.ordinal, v.title, v.priority, v.days_offset
from public.task_templates t
cross join (values
  (1, 'Obtain trial balance & supporting schedules',     'high',   0),
  (2, 'Prepare draft financial statements',              'high',   14),
  (3, 'Internal review',                                 'high',   21),
  (4, 'Liaise with auditor',                             'medium', 28),
  (5, 'Finalise audited accounts',                       'high',   45),
  (6, 'Prepare & submit corporate tax return (TD4)',     'urgent', 55),
  (7, 'File annual return (HE32) with the Registrar',    'medium', 60)
) as v(ordinal, title, priority, days_offset)
where t.name = 'Annual Accounts & Corporate Tax'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, ordinal, title, default_priority, days_offset)
select t.id, v.ordinal, v.title, v.priority, v.days_offset
from public.task_templates t
cross join (values
  (1, 'Collect hours / changes from client',       'high',   0),
  (2, 'Process payroll & generate payslips',       'high',   3),
  (3, 'Submit Social Insurance contributions',     'urgent', 5),
  (4, 'Send payslips to client',                   'medium', 6)
) as v(ordinal, title, priority, days_offset)
where t.name = 'Monthly Payroll'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

insert into public.task_template_items (template_id, ordinal, title, default_priority, days_offset)
select t.id, v.ordinal, v.title, v.priority, v.days_offset
from public.task_templates t
cross join (values
  (1, 'Kick-off meeting & define objectives',     'high',   0),
  (2, 'Gather data & documentation',              'medium', 5),
  (3, 'Analysis & findings',                      'medium', 14),
  (4, 'Draft recommendations report',             'high',   21),
  (5, 'Present to client',                        'high',   28),
  (6, 'Follow-up & implementation check',         'low',    42)
) as v(ordinal, title, priority, days_offset)
where t.name = 'Business Consulting Engagement'
  and not exists (select 1 from public.task_template_items i where i.template_id = t.id);

commit;
-- =============================================================
-- End of migration 063.
-- =============================================================
