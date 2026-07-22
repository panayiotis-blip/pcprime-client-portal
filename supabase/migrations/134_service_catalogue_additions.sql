-- =============================================================
-- Migration 134: add Audit Support, Transfer Pricing Study and
--                Company Secretarial to the service catalogue
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The catalogue held seven services (payroll, VAT, annual accounts,
-- bookkeeping, individual tax return, tax payments, consulting) and was
-- missing work the firm actually performs.
--
-- These are seeded with a name and description ONLY — deliberately no
-- service_stages rows. A stage carries sends_email and creates_task, so a
-- seeded stage with a guessed cadence could email clients or raise tasks on a
-- schedule nobody chose. Stages and deliverables are added per service in
-- Settings → Services, where the effect of each switch is visible.
--
-- Ordinals continue after consulting (70). Existing rows are left untouched:
-- on conflict (key) do nothing.
-- =============================================================

begin;

insert into public.service_definitions (key, label, description, ordinal) values
  ('audit_support', 'Audit Support',
   'Supporting an external auditor through the annual audit — preparing schedules and reconciliations, answering queries, and managing the audit file.',
   80),
  ('transfer_pricing_study', 'Transfer Pricing Study',
   'Transfer pricing documentation for controlled transactions, including benchmarking and the Local File / Master File as applicable.',
   90),
  ('company_secretarial', 'Company Secretarial',
   'Registrar of Companies filings and statutory record keeping — annual return, statutory registers, and changes of officers, shareholders or registered office.',
   100)
on conflict (key) do nothing;

commit;

-- =============================================================
-- Verify:
--   select key, label, ordinal, enabled
--   from public.service_definitions
--   order by ordinal;
--
-- Expect the three new rows with no stages:
--   select d.key, count(s.id) as stages
--   from public.service_definitions d
--   left join public.service_stages s on s.service_id = d.id
--   where d.key in ('audit_support','transfer_pricing_study','company_secretarial')
--   group by d.key;
-- =============================================================
-- End of migration 134.
-- =============================================================
