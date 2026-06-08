-- Migration 100: Individual Tax Return + Tax Payments services
-- ==============================================================
-- Two new services that introduce non-monthly cadences:
--
--   • Individual Tax Return  (annual)        — 3 stages around the TD1 cycle
--   • Tax Payments           (multi-month)   — provisional, SDC, GeSY, self-employed SI
--
-- The existing scheduler (migration 098) only fired stages with
-- cadence='monthly'. This migration extends it: any stage may now have an
-- active_months int[] of months 1-12 in which it should fire. NULL means
-- "fire every month" (the previous behaviour). The runner now keys off
-- active_months rather than cadence.

-- -----------------------------------------------------------------
-- 1. Schema: active_months on every stage
-- -----------------------------------------------------------------
alter table public.service_stages
  add column if not exists active_months int[];

-- Backfill: monthly stages keep firing every month (NULL = all months).
-- Old quarterly/annual placeholders from 098 stay NULL → still skipped.

-- -----------------------------------------------------------------
-- 2. Rewrite run_due_service_schedules to use active_months
-- -----------------------------------------------------------------
create or replace function public.run_due_service_schedules(
  p_run_date date default current_date
) returns table(created_runs int, created_tasks int)
language plpgsql security definer set search_path = public
as $$
declare
  v_runs int := 0;
  v_tasks int := 0;
  rec record;
  v_sched date;
  v_task_id bigint;
  v_year int := extract(year from p_run_date)::int;
  v_month int := extract(month from p_run_date)::int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  for rec in
    select cs.id as client_service_id, cs.client_id, c.name as client_name,
           st.id as stage_id, st.label as stage_label, st.task_priority,
           st.sends_email, st.creates_task, st.cadence, st.active_months,
           coalesce(o.day_of_month,  st.default_day_of_month)  as day_of_month,
           coalesce(o.use_last_day, st.default_use_last_day) as use_last_day,
           coalesce(o.skip, false) as skip
    from public.client_services cs
    join public.clients c on c.id = cs.client_id
    join public.service_definitions sd on sd.id = cs.service_id
    join public.service_stages st on st.service_id = sd.id
    left join public.client_service_stage_overrides o
      on o.client_service_id = cs.id and o.service_stage_id = st.id
    where cs.enabled = true
      and sd.enabled = true
      and c.deleted_at is null
  loop
    if rec.skip then continue; end if;

    -- Gate on active_months. NULL = every month (legacy monthly stages).
    if rec.active_months is not null and not (v_month = any(rec.active_months)) then
      continue;
    end if;
    -- Old placeholder rows (cadence quarterly/annual, active_months NULL)
    -- are skipped — they were never meant to fire by themselves.
    if rec.cadence <> 'monthly' and rec.active_months is null then
      continue;
    end if;

    v_sched := public.next_stage_date_in_month(v_year, v_month, rec.day_of_month::int, rec.use_last_day);
    if v_sched is null or v_sched > p_run_date then continue; end if;

    if exists (
      select 1 from public.service_runs
      where client_service_id = rec.client_service_id
        and service_stage_id  = rec.stage_id
        and scheduled_date    = v_sched
    ) then continue; end if;

    v_task_id := null;
    if rec.creates_task then
      insert into public.staff_tasks (title, client_id, due_date, priority, status, description)
      values (
        rec.stage_label || ' — ' || rec.client_name,
        rec.client_id,
        v_sched,
        rec.task_priority,
        'open',
        'Auto-created by client services scheduler.'
      )
      returning id into v_task_id;
      v_tasks := v_tasks + 1;
    end if;

    insert into public.service_runs (
      client_service_id, service_stage_id, scheduled_date, fired_at, email_sent, task_id
    ) values (
      rec.client_service_id, rec.stage_id, v_sched, now(), false, v_task_id
    );
    v_runs := v_runs + 1;
  end loop;

  created_runs := v_runs;
  created_tasks := v_tasks;
  return next;
end$$;

-- -----------------------------------------------------------------
-- 3. Service: Individual Tax Return
-- -----------------------------------------------------------------
insert into public.service_definitions (key, label, description, ordinal) values
  ('individual_tax_return', 'Individual Tax Return',
   'Annual TD1 / personal tax return cycle for individual clients.',
   50)
on conflict (key) do nothing;

insert into public.service_stages (
  service_id, ordinal, key, label, cadence,
  default_day_of_month, default_use_last_day,
  active_months, sends_email, creates_task, task_priority
)
select s.id, v.ordinal, v.key, v.label, 'annual',
       v.day, v.last_day,
       v.months::int[], true, true, v.priority
from public.service_definitions s
cross join (values
  (1, 'doc_request',      'Tax Return: document request',     1,    false, '{2}',  'medium'),
  (2, 'draft_review',     'Tax Return: draft ready for review', 1,  false, '{5}',  'medium'),
  (3, 'filing_reminder',  'Tax Return: filing deadline',      1,    false, '{10}', 'high')
) as v(ordinal, key, label, day, last_day, months, priority)
where s.key = 'individual_tax_return'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

-- -----------------------------------------------------------------
-- 4. Service: Tax Payments
-- -----------------------------------------------------------------
insert into public.service_definitions (key, label, description, ordinal) values
  ('tax_payments', 'Tax Payments',
   'Periodic tax-payment reminders: provisional tax, SDC, GeSY contributions, '
   'self-employed Social Insurance.',
   60)
on conflict (key) do nothing;

insert into public.service_stages (
  service_id, ordinal, key, label, cadence,
  default_day_of_month, default_use_last_day,
  active_months, sends_email, creates_task, task_priority
)
select s.id, v.ordinal, v.key, v.label, v.cadence,
       v.day, v.last_day,
       v.months::int[], true, true, v.priority
from public.service_definitions s
cross join (values
  -- The first NULL is cast to int so Postgres types this VALUES column as int
  -- instead of text (which would fail to cast into default_day_of_month).
  (1, 'provisional_tax_h1', 'Provisional Tax: 1st instalment',  null::int, true, 'annual',   '{7}',         'high'),
  (2, 'provisional_tax_h2', 'Provisional Tax: 2nd instalment',  null,      true, 'annual',   '{12}',        'high'),
  (3, 'sdc_gesy_h1',        'SDC + GeSY (rents/dividends): H1', null,      true, 'annual',   '{6}',         'high'),
  (4, 'sdc_gesy_h2',        'SDC + GeSY (rents/dividends): H2', null,      true, 'annual',   '{12}',        'high'),
  (5, 'se_quarterly',       'Self-Employed SI + GeSY (quarterly)', null,   true, 'quarterly', '{3,6,9,12}', 'high'),
  (6, 'gesy_annual_recon',  'GeSY annual reconciliation',       null,      true, 'annual',   '{7}',         'medium')
) as v(ordinal, key, label, day, last_day, cadence, months, priority)
where s.key = 'tax_payments'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

-- -----------------------------------------------------------------
-- 5. Email templates
-- -----------------------------------------------------------------
-- Individual Tax Return
insert into public.service_email_templates (service_stage_id, subject, body)
select st.id, v.subject, v.body
from public.service_stages st
join public.service_definitions sd on sd.id = st.service_id
cross join lateral (
  values
  ('doc_request',
    'Documents needed for your personal tax return',
    '<p>Dear {{client_name}},</p>'
    '<p>It''s time to start preparing your personal tax return for last year. Please send us the '
    'following documents so we can begin:</p>'
    '<ul>'
    '<li>TD63s from all employers</li>'
    '<li>Bank statements with interest received</li>'
    '<li>Dividend statements</li>'
    '<li>Rental income summaries and lease agreements</li>'
    '<li>Life insurance / provident fund / medical fund certificates</li>'
    '<li>Donation receipts to approved charities</li>'
    '<li>Education / tuition fee receipts (if claiming)</li>'
    '<li>Any other income or deductions you wish to declare</li>'
    '</ul>'
    '<p>The earlier you send these, the more time we have to optimise your return.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('draft_review',
    'Your tax return draft is ready for review',
    '<p>Dear {{client_name}},</p>'
    '<p>Your personal tax return draft is ready. We''ll send you the summary separately for review.</p>'
    '<p>Please look it over carefully, confirm all income and deductions are captured, and let us '
    'know of any changes before we submit. The electronic filing deadline is 31 October.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('filing_reminder',
    'Tax return filing deadline approaching — 31 October',
    '<p>Dear {{client_name}},</p>'
    '<p>The deadline for electronic filing of your personal tax return is <strong>31 October</strong>. '
    'If you haven''t yet confirmed your return for filing, please do so urgently.</p>'
    '<p>Late filing carries penalties — let us know immediately if there''s anything outstanding.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  )
) as v(stage_key, subject, body)
where sd.key = 'individual_tax_return' and st.key = v.stage_key
  and not exists (
    select 1 from public.service_email_templates t where t.service_stage_id = st.id
  );

-- Tax Payments
insert into public.service_email_templates (service_stage_id, subject, body)
select st.id, v.subject, v.body
from public.service_stages st
join public.service_definitions sd on sd.id = st.service_id
cross join lateral (
  values
  ('provisional_tax_h1',
    'Provisional Tax — 1st instalment due 31 July',
    '<p>Dear {{client_name}},</p>'
    '<p>Reminder that the <strong>1st instalment of provisional tax</strong> is due by <strong>31 July</strong>. '
    'If your taxable profit estimate has changed since last year, please let us know now so we can '
    'adjust the instalment.</p>'
    '<p>We''ll send the payment instructions separately.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('provisional_tax_h2',
    'Provisional Tax — 2nd instalment due 31 December',
    '<p>Dear {{client_name}},</p>'
    '<p>Reminder that the <strong>2nd instalment of provisional tax</strong> is due by <strong>31 December</strong>. '
    'This is also the deadline to revise the original estimate without penalty.</p>'
    '<p>If your profit for the year is materially different from the estimate, please contact us '
    'immediately so we can submit a revised return.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('sdc_gesy_h1',
    'SDC + GeSY payment due (H1) — 30 June',
    '<p>Dear {{client_name}},</p>'
    '<p>Reminder that <strong>Special Defence Contribution (SDC)</strong> and <strong>GeSY</strong> on '
    'rents, dividends and interest for the first half of the year are due by <strong>30 June</strong>.</p>'
    '<p>Please send us the relevant income figures so we can prepare the IR614/IR614A return and '
    'payment instructions.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('sdc_gesy_h2',
    'SDC + GeSY payment due (H2) — 31 December',
    '<p>Dear {{client_name}},</p>'
    '<p>Reminder that <strong>Special Defence Contribution (SDC)</strong> and <strong>GeSY</strong> on '
    'rents, dividends and interest for the second half of the year are due by <strong>31 December</strong>.</p>'
    '<p>Please send us the relevant income figures so we can prepare the IR614/IR614A return and '
    'payment instructions.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('se_quarterly',
    'Self-Employed Social Insurance + GeSY due',
    '<p>Dear {{client_name}},</p>'
    '<p>Reminder that your quarterly <strong>Social Insurance and GeSY contributions</strong> as a '
    'self-employed person are due at the end of this month.</p>'
    '<p>If your earnings declaration has changed, please let us know so we can adjust the contribution.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('gesy_annual_recon',
    'GeSY annual reconciliation — 31 July',
    '<p>Dear {{client_name}},</p>'
    '<p>The annual <strong>GeSY reconciliation</strong> is due by <strong>31 July</strong>, alongside '
    'your personal tax return. We''ll prepare this together with the TD1.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  )
) as v(stage_key, subject, body)
where sd.key = 'tax_payments' and st.key = v.stage_key
  and not exists (
    select 1 from public.service_email_templates t where t.service_stage_id = st.id
  );
