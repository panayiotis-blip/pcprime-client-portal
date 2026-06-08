-- Migration 098: Client services + recurring per-stage schedules
-- =================================================================
-- Adds a structured catalogue of services we offer (Payroll, VAT,
-- Annual Accounts, Bookkeeping) and a per-client opt-in with per-stage
-- date overrides. Each "stage" of a service has a default day-of-month,
-- an editable email template, and toggles for whether firing the stage
-- should send an email, create a staff task, or both.
--
-- This migration creates the data model + seed data + a manual-run RPC
-- (run_due_service_schedules) so the workflow can be validated before
-- wiring full pg_cron automation in a follow-up migration.

-- -----------------------------------------------------------------
-- 1. service_definitions — firm-level catalogue
-- -----------------------------------------------------------------
create table if not exists public.service_definitions (
  id bigserial primary key,
  key text not null unique,
  label text not null,
  description text,
  enabled boolean not null default true,
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_definitions enable row level security;

drop policy if exists "service_definitions read" on public.service_definitions;
create policy "service_definitions read" on public.service_definitions
  for select using (public.is_admin());

drop policy if exists "service_definitions write" on public.service_definitions;
create policy "service_definitions write" on public.service_definitions
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -----------------------------------------------------------------
-- 2. service_stages — the workflow steps inside a service
-- -----------------------------------------------------------------
-- Each stage fires on a specific day-of-month (or last day) every period.
-- cadence describes the period: monthly is the only one supported by the
-- MVP runner; quarterly/annual are reserved for a future migration.
create table if not exists public.service_stages (
  id bigserial primary key,
  service_id bigint not null references public.service_definitions(id) on delete cascade,
  ordinal int not null,
  key text not null,
  label text not null,
  cadence text not null default 'monthly'
    check (cadence in ('monthly', 'quarterly', 'annual')),
  default_day_of_month int
    check (default_day_of_month is null or (default_day_of_month between 1 and 31)),
  default_use_last_day boolean not null default false,
  sends_email boolean not null default true,
  creates_task boolean not null default true,
  task_priority text not null default 'medium'
    check (task_priority in ('low', 'medium', 'high', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, key)
);

create index if not exists service_stages_service_idx
  on public.service_stages (service_id, ordinal);

alter table public.service_stages enable row level security;

drop policy if exists "service_stages read" on public.service_stages;
create policy "service_stages read" on public.service_stages
  for select using (public.is_admin());

drop policy if exists "service_stages write" on public.service_stages;
create policy "service_stages write" on public.service_stages
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -----------------------------------------------------------------
-- 3. service_email_templates — editable subject/body per stage
-- -----------------------------------------------------------------
-- Body supports merge fields: {{client_name}}, {{month_name}},
-- {{period_label}}, {{firm_name}}, {{firm_email}}.
create table if not exists public.service_email_templates (
  id bigserial primary key,
  service_stage_id bigint not null unique
    references public.service_stages(id) on delete cascade,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

alter table public.service_email_templates enable row level security;

drop policy if exists "service_email_templates read" on public.service_email_templates;
create policy "service_email_templates read" on public.service_email_templates
  for select using (public.is_admin());

drop policy if exists "service_email_templates write" on public.service_email_templates;
create policy "service_email_templates write" on public.service_email_templates
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -----------------------------------------------------------------
-- 4. client_services — per-client opt-in for a service
-- -----------------------------------------------------------------
create table if not exists public.client_services (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  service_id bigint not null references public.service_definitions(id) on delete cascade,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, service_id)
);

create index if not exists client_services_client_idx
  on public.client_services (client_id);

alter table public.client_services enable row level security;

drop policy if exists "client_services read" on public.client_services;
create policy "client_services read" on public.client_services
  for select using (public.user_can_access_client(client_id));

drop policy if exists "client_services write" on public.client_services;
create policy "client_services write" on public.client_services
  for all using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------
-- 5. client_service_stage_overrides — per-client date / skip overrides
-- -----------------------------------------------------------------
-- NULL day_of_month / use_last_day means "use the firm default from
-- service_stages". skip=true means this stage is silenced for this client.
create table if not exists public.client_service_stage_overrides (
  id bigserial primary key,
  client_service_id bigint not null
    references public.client_services(id) on delete cascade,
  service_stage_id bigint not null
    references public.service_stages(id) on delete cascade,
  day_of_month int
    check (day_of_month is null or (day_of_month between 1 and 31)),
  use_last_day boolean,
  skip boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (client_service_id, service_stage_id)
);

alter table public.client_service_stage_overrides enable row level security;

drop policy if exists "stage_overrides read" on public.client_service_stage_overrides;
create policy "stage_overrides read" on public.client_service_stage_overrides
  for select using (true);

drop policy if exists "stage_overrides write" on public.client_service_stage_overrides;
create policy "stage_overrides write" on public.client_service_stage_overrides
  for all using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------
-- 6. service_runs — audit log of every stage firing
-- -----------------------------------------------------------------
-- Used to (a) prevent double-firing for the same period, (b) show a
-- history of what was sent, (c) record any email failure for retry.
create table if not exists public.service_runs (
  id bigserial primary key,
  client_service_id bigint not null
    references public.client_services(id) on delete cascade,
  service_stage_id bigint not null
    references public.service_stages(id) on delete cascade,
  scheduled_date date not null,
  fired_at timestamptz,
  email_sent boolean not null default false,
  email_error text,
  task_id bigint references public.staff_tasks(id) on delete set null,
  unique (client_service_id, service_stage_id, scheduled_date)
);

create index if not exists service_runs_date_idx
  on public.service_runs (scheduled_date);

alter table public.service_runs enable row level security;

drop policy if exists "service_runs read" on public.service_runs;
create policy "service_runs read" on public.service_runs
  for select using (public.is_admin());

drop policy if exists "service_runs write" on public.service_runs;
create policy "service_runs write" on public.service_runs
  for all using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------
-- Seed: the 4 services
-- -----------------------------------------------------------------
insert into public.service_definitions (key, label, description, ordinal) values
  ('payroll',         'Payroll',         'Monthly payroll cycle: info request, Social Insurance submission, payment confirmation.', 10),
  ('vat_return',      'VAT Return',      'Periodic VAT return — info request before period close, then submission reminder.',      20),
  ('annual_accounts', 'Annual Accounts', 'Year-end accounts + corporate tax filing.',                                                30),
  ('bookkeeping',     'Bookkeeping',     'Monthly bookkeeping cycle — request for monthly documents.',                               40)
on conflict (key) do nothing;

-- -----------------------------------------------------------------
-- Seed: stages per service
-- -----------------------------------------------------------------
-- Payroll: 3 monthly stages
insert into public.service_stages (service_id, ordinal, key, label, cadence, default_day_of_month, task_priority)
select s.id, v.ordinal, v.key, v.label, 'monthly', v.day, v.priority
from public.service_definitions s
cross join (values
  (1, 'info_request',          'Payroll: info request',          1,  'medium'),
  (2, 'si_submission',         'Payroll: Social Insurance load', 10, 'high'),
  (3, 'payment_confirmation',  'Payroll: payment confirmation',  15, 'medium')
) as v(ordinal, key, label, day, priority)
where s.key = 'payroll'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

-- VAT Return: 2 quarterly stages (cadence quarterly — the MVP runner skips
-- these for now; they're seeded so the UI shows them. Activate by changing
-- cadence to monthly or wiring quarterly logic later.)
insert into public.service_stages (service_id, ordinal, key, label, cadence, default_day_of_month, task_priority)
select s.id, v.ordinal, v.key, v.label, 'quarterly', v.day, v.priority
from public.service_definitions s
cross join (values
  (1, 'info_request',  'VAT: info request',  20, 'medium'),
  (2, 'submission',    'VAT: submission',    10, 'high')
) as v(ordinal, key, label, day, priority)
where s.key = 'vat_return'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

-- Annual Accounts: 2 annual stages
insert into public.service_stages (service_id, ordinal, key, label, cadence, default_day_of_month, task_priority)
select s.id, v.ordinal, v.key, v.label, 'annual', v.day, v.priority
from public.service_definitions s
cross join (values
  (1, 'data_request',  'Annual Accounts: data request',  15, 'medium'),
  (2, 'filing_prep',   'Annual Accounts: filing prep',   1,  'high')
) as v(ordinal, key, label, day, priority)
where s.key = 'annual_accounts'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = v.key
  );

-- Bookkeeping: 1 monthly stage
insert into public.service_stages (service_id, ordinal, key, label, cadence, default_day_of_month, task_priority)
select s.id, 1, 'docs_request', 'Bookkeeping: docs request', 'monthly', 5, 'medium'
from public.service_definitions s
where s.key = 'bookkeeping'
  and not exists (
    select 1 from public.service_stages st where st.service_id = s.id and st.key = 'docs_request'
  );

-- -----------------------------------------------------------------
-- Seed: default email templates per stage
-- -----------------------------------------------------------------
-- Merge fields available: {{client_name}}, {{month_name}},
-- {{period_label}}, {{firm_name}}, {{firm_email}}
insert into public.service_email_templates (service_stage_id, subject, body)
select st.id, v.subject, v.body
from public.service_stages st
join public.service_definitions sd on sd.id = st.service_id
cross join lateral (
  values
  ('payroll', 'info_request',
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
  ('payroll', 'si_submission',
    'Social Insurance submission for {{month_name}}',
    '<p>Dear {{client_name}},</p>'
    '<p>We''ve prepared and submitted your <strong>{{month_name}}</strong> Social Insurance return. '
    'Please find the SI calculation attached for your records.</p>'
    '<p>The payment will be due shortly. We''ll send a separate confirmation request once the figures '
    'are confirmed.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('payroll', 'payment_confirmation',
    'Please confirm {{month_name}} payroll payment',
    '<p>Dear {{client_name}},</p>'
    '<p>Please confirm that the <strong>{{month_name}}</strong> payroll payment has been processed '
    'and Social Insurance has been paid.</p>'
    '<p>Reply with the payment date once done — we''ll then close out the month.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('vat_return', 'info_request',
    'VAT return information needed for {{period_label}}',
    '<p>Dear {{client_name}},</p>'
    '<p>Your VAT period is closing. Please send us your sales and purchase records for '
    '<strong>{{period_label}}</strong> at your earliest convenience so we can prepare the return.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('vat_return', 'submission',
    'VAT return ready for review — {{period_label}}',
    '<p>Dear {{client_name}},</p>'
    '<p>Your VAT return for <strong>{{period_label}}</strong> has been prepared. Please review the '
    'attached summary and confirm we may submit.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('annual_accounts', 'data_request',
    'Year-end information needed for {{period_label}}',
    '<p>Dear {{client_name}},</p>'
    '<p>Your financial year-end is approaching. Please start gathering the following:</p>'
    '<ul>'
    '<li>Bank statements covering the full year</li>'
    '<li>Outstanding receivables and payables at year-end</li>'
    '<li>Stock count (if applicable)</li>'
    '<li>Loan balances and interest statements</li>'
    '</ul>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('annual_accounts', 'filing_prep',
    'Annual accounts filing — action required',
    '<p>Dear {{client_name}},</p>'
    '<p>We''re preparing your annual accounts for filing. Please make yourself available '
    'this week for any clarifications, and confirm the directors'' details are unchanged.</p>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  ),
  ('bookkeeping', 'docs_request',
    'Monthly documents needed for {{month_name}}',
    '<p>Dear {{client_name}},</p>'
    '<p>Please send us the following for <strong>{{month_name}}</strong>:</p>'
    '<ul>'
    '<li>Bank statements</li>'
    '<li>Sales invoices issued</li>'
    '<li>Purchase invoices / receipts</li>'
    '<li>Any other transaction documents</li>'
    '</ul>'
    '<p>Kind regards,<br>{{firm_name}}<br>{{firm_email}}</p>'
  )
) as v(service_key, stage_key, subject, body)
where sd.key = v.service_key and st.key = v.stage_key
  and not exists (
    select 1 from public.service_email_templates t where t.service_stage_id = st.id
  );

-- -----------------------------------------------------------------
-- Helper: compute the next scheduled_date for (override or default,
-- starting from a reference date)
-- -----------------------------------------------------------------
-- Returns the date in p_month at the given day-of-month, capped to the
-- actual last day of that month. If use_last_day=true, returns the
-- month's last calendar day.
create or replace function public.next_stage_date_in_month(
  p_year int, p_month int, p_day int, p_use_last_day boolean
) returns date language plpgsql immutable as $$
declare
  v_last_day int;
begin
  if p_year is null or p_month is null then return null; end if;
  v_last_day := extract(day from (date_trunc('month', make_date(p_year, p_month, 1)) + interval '1 month - 1 day'))::int;
  if coalesce(p_use_last_day, false) then
    return make_date(p_year, p_month, v_last_day);
  end if;
  if p_day is null then return null; end if;
  return make_date(p_year, p_month, least(p_day, v_last_day));
end$$;

-- -----------------------------------------------------------------
-- RPC: run_due_service_schedules(p_run_date)
-- -----------------------------------------------------------------
-- For every active client_service + monthly stage, computes the
-- scheduled_date for the month containing p_run_date. If
-- scheduled_date <= p_run_date AND no service_runs row exists yet,
-- creates a staff task (if creates_task) and inserts a service_runs
-- row marked email_sent=false. Email sending is left to the caller —
-- the UI walks pending service_runs and posts to send-via-outlook.
--
-- Returns: how many runs were created. The caller can then list rows
-- with email_sent=false to drive the email step.
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
           st.sends_email, st.creates_task, st.cadence,
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
    -- MVP supports monthly only. Skip stages explicitly silenced for
    -- this client, and any stage whose date couldn't be resolved.
    if rec.skip then continue; end if;
    if rec.cadence <> 'monthly' then continue; end if;

    v_sched := public.next_stage_date_in_month(v_year, v_month, rec.day_of_month::int, rec.use_last_day);
    if v_sched is null or v_sched > p_run_date then continue; end if;

    -- Already fired for this month?
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

revoke all on function public.run_due_service_schedules(date) from public;
grant execute on function public.run_due_service_schedules(date) to authenticated;

-- -----------------------------------------------------------------
-- View: pending automated emails (rows in service_runs with
-- email_sent=false and stage.sends_email=true), with the resolved
-- subject/body + recipient. UI walks this to send emails one by one.
-- -----------------------------------------------------------------
create or replace view public.v_pending_service_emails as
select
  sr.id as run_id,
  sr.scheduled_date,
  sr.client_service_id,
  sr.service_stage_id,
  cs.client_id,
  c.name as client_name,
  c.email as client_email,
  sd.key  as service_key,
  sd.label as service_label,
  st.key  as stage_key,
  st.label as stage_label,
  te.subject,
  te.body,
  sr.email_error
from public.service_runs sr
join public.client_services cs on cs.id = sr.client_service_id
join public.clients c on c.id = cs.client_id
join public.service_stages st on st.id = sr.service_stage_id
join public.service_definitions sd on sd.id = st.service_id
left join public.service_email_templates te on te.service_stage_id = st.id
where sr.email_sent = false
  and st.sends_email = true;

grant select on public.v_pending_service_emails to authenticated;
