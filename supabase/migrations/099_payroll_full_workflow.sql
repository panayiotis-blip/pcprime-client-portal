-- Migration 099: Expand the Payroll service to the full monthly workflow
-- =====================================================================
-- Replaces the 3 starter stages from migration 098 with the firm's actual
-- Cyprus monthly payroll cycle:
--
--   1. info_request       — day 1        — "send us THIS month's payroll info"
--   2. payroll_execution  — day 25       — "we'll run THIS month's payroll"
--   3. payroll_payment    — last day     — "client pays salaries to employees"
--   4. si_payment         — day 10       — "SI/GHS due for LAST month's payroll"
--   5. paye_payment       — day 10       — "PAYE due for LAST month's payroll"
--   6. td7_filing         — last day     — "TD7 monthly return for LAST month's payroll"
--
-- Stages 4-6 in any given month refer to the PREVIOUS month's payroll
-- (Cyprus practice: SI/PAYE/TD7 due the month after wages are paid). The
-- email-template wording makes this clear so reminders aren't ambiguous.
--
-- Existing payroll stages from migration 098 are dropped — cascades clean
-- up their email templates, client-service overrides, and any prior
-- service_runs records.

-- -----------------------------------------------------------------
-- 1. Remove old payroll stages (cascade does the rest)
-- -----------------------------------------------------------------
delete from public.service_stages
where service_id = (select id from public.service_definitions where key = 'payroll');

-- -----------------------------------------------------------------
-- 2. Insert the six-stage workflow
-- -----------------------------------------------------------------
insert into public.service_stages (
  service_id, ordinal, key, label, cadence,
  default_day_of_month, default_use_last_day,
  sends_email, creates_task, task_priority
)
select s.id, v.ordinal, v.key, v.label, 'monthly',
       v.day, v.last_day,
       v.email, v.task, v.priority
from public.service_definitions s
cross join (values
  (1, 'info_request',      'Payroll: info request',           1,   false, true,  true,  'medium'),
  (2, 'payroll_execution', 'Payroll: execution (we run it)',  25,  false, false, true,  'high'),
  (3, 'payroll_payment',   'Payroll: payment by client',      null,true,  true,  true,  'high'),
  (4, 'si_payment',        'SI/GHS payment (prev month)',     10,  false, true,  true,  'high'),
  (5, 'paye_payment',      'PAYE payment (prev month)',       10,  false, true,  true,  'high'),
  (6, 'td7_filing',        'TD7 monthly filing (prev month)', null,true,  true,  true,  'urgent')
) as v(ordinal, key, label, day, last_day, email, task, priority)
where s.key = 'payroll';

-- -----------------------------------------------------------------
-- 3. Email templates per stage (sensible Cyprus-practice defaults)
-- -----------------------------------------------------------------
-- Merge fields available: {{client_name}}, {{month_name}},
-- {{period_label}}, {{firm_name}}, {{firm_email}}
insert into public.service_email_templates (service_stage_id, subject, body)
select st.id, v.subject, v.body
from public.service_stages st
join public.service_definitions sd on sd.id = st.service_id
cross join lateral (
  values
  ('info_request',
    'Payroll information needed for {{month_name}}',
    '<p>Dear {{client_name}},</p>'
    '<p>It''s time for your <strong>{{month_name}}</strong> payroll. Please send us the following by return:</p>'
    '<ul>'
    '<li>Hours worked / overtime for the month</li>'
    '<li>Any new starters or leavers</li>'
    '<li>Bonuses, allowances or one-off payments</li>'
    '<li>Any unpaid leave or sickness days</li>'
    '</ul>'
    '<p>If everything is unchanged from last month, just reply "no changes" and we''ll proceed.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('payroll_execution',
    'We''re running your {{month_name}} payroll',
    '<p>Dear {{client_name}},</p>'
    '<p>We''re preparing your <strong>{{month_name}}</strong> payroll today. If there are any '
    'last-minute changes (overtime, bonuses, leavers), please send them before end of day.</p>'
    '<p>You''ll receive the payslips and payment summary as soon as the run is complete.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('payroll_payment',
    'Payroll payment due — {{month_name}}',
    '<p>Dear {{client_name}},</p>'
    '<p>Reminder that the <strong>{{month_name}}</strong> payroll payment to employees is due today. '
    'Please process the bank transfers using the payment summary we sent you.</p>'
    '<p>Once paid, please reply to confirm so we can close out the month.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('si_payment',
    'Social Insurance / GHS payment due',
    '<p>Dear {{client_name}},</p>'
    '<p>The Social Insurance and GHS contribution for the <strong>previous month''s</strong> payroll '
    'is due today. Please process the payment to the Social Insurance Services using the figures '
    'we provided with last month''s payroll summary.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('paye_payment',
    'PAYE payment due',
    '<p>Dear {{client_name}},</p>'
    '<p>The PAYE (income tax withheld) for the <strong>previous month''s</strong> payroll is due today. '
    'Please process the payment to the Tax Department using the figures we provided with last '
    'month''s payroll summary.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('td7_filing',
    'TD7 monthly filing due — last day of month',
    '<p>Dear {{client_name}},</p>'
    '<p>The TD7 monthly employer''s return for the <strong>previous month''s</strong> payroll is due '
    'today. We''ll be submitting the form via TaxisNet on your behalf.</p>'
    '<p>If you haven''t yet confirmed the previous month''s figures, please do so as soon as possible '
    'so we can file on time.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  )
) as v(stage_key, subject, body)
where sd.key = 'payroll' and st.key = v.stage_key;
