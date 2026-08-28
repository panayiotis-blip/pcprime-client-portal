-- =====================================================================
-- PC Prime & Calculate Consultants — client reporting platform
-- Migration 0002: review, VAT, payroll, stock, budgets, company record
--
-- Depends on 0001_core.sql. Same rule throughout: every table carries
-- client_id, RLS on, one policy, no service-role path in the app.
-- =====================================================================

set search_path to reporting, public;

-- ---------------------------------------------------------------------
-- The client's own particulars.
-- Identity, address, contacts, statutory dates and engagement live in
-- the portal's client register (public.clients) and are READ from there.
-- Only what is specific to how the books are kept is held here.
-- ---------------------------------------------------------------------

create table company_record (
  client_id        uuid primary key references public.clients(id) on delete cascade,
  vat_period       text,          -- e.g. 'quarterly, Feb/May/Aug/Nov'
  records_basis    text,          -- accruals / cash / mixed, and what the client supplies
  bank_accounts    text,          -- the accounts that appear in the ledger
  stock_count_date text,
  preparer         text,
  reviewer         text,
  team_notes       text,          -- what everyone should know before touching these books
  portal_read_at   timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

-- ---------------------------------------------------------------------
-- Feed status — drives the Data import screen.
-- One row per client per feed; rewritten by the import pipeline.
-- ---------------------------------------------------------------------

create type feed_kind as enum (
  'journal_listing','trial_balance_monthly','trial_balance_annual','chart_of_accounts',
  'vat_summary','vat_return_filed','payroll_cost_analysis','payroll_paysheet',
  'stock_valuation','sales_invoice_listing','bank_statement');

create table feed_status (
  client_id     uuid not null references public.clients(id) on delete cascade,
  feed          feed_kind not null,
  last_import   bigint references imports(id) on delete set null,
  last_file     text,
  uploaded_at   timestamptz,
  uploaded_by   uuid references auth.users(id),
  covers_to     date,            -- the last period the feed covers
  required      boolean not null default true,
  primary key (client_id, feed)
);

comment on table feed_status is
  'How current each feed is. The Data import screen shows uploaded_at and its age; a monthly feed older than 45 days reads as overdue.';

-- ---------------------------------------------------------------------
-- The review engine
-- ---------------------------------------------------------------------

create type severity as enum ('high','medium','low');

-- Exceptions are DERIVED. They are deleted and regenerated on every
-- commit, so a corrected item simply stops appearing. The natural key
-- below is what a sign-off and a query hang off, which is why a
-- corrected item loses its sign-off too — that is intended.
create table exceptions (
  id          bigserial primary key,
  client_id   uuid not null references public.clients(id) on delete cascade,
  ex_key      text not null,          -- check|month|account|reference|amount
  check_name  text not null,
  sev         severity not null,
  month       date,
  txn_date    date,
  account     text,
  report_line text,
  journal     text,
  journal_no  text,
  batch       text,
  reference   text,
  amount      numeric(14,2),
  description text not null,
  detail      text,                   -- e.g. 'no reversal found'
  generated_by bigint references imports(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (client_id, ex_key)
);

create index exceptions_client_open_idx on exceptions (client_id, sev, month);

-- Sign-offs survive regeneration by keying on ex_key, not on the row id.
create table exception_signoff (
  client_id  uuid not null references public.clients(id) on delete cascade,
  ex_key     text not null,
  reason     text not null,
  note       text,
  signed_by  uuid not null references auth.users(id),
  signed_at  timestamptz not null default now(),
  primary key (client_id, ex_key)
);

-- What is to be raised with the client on an item that cannot be put
-- right here. Stays with the item until the item is cleared.
create table exception_queries (
  client_id  uuid not null references public.clients(id) on delete cascade,
  ex_key     text not null,
  query_text text not null,
  raised_by  uuid not null references auth.users(id),
  raised_at  timestamptz not null default now(),
  answered   text,
  answered_at timestamptz,
  primary key (client_id, ex_key)
);

-- Free-text notes at the foot of every report, for discussion or correction.
create table report_notes (
  client_id  uuid not null references public.clients(id) on delete cascade,
  report_key text not null,          -- 'pl', 'bs', 'vat', 'stock', ...
  body       text not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (client_id, report_key)
);

-- ---------------------------------------------------------------------
-- Budgets — entered by hand after discussion with the client.
-- Nothing in this schema derives a budget from actuals. Copying prior
-- year into the form is a deliberate act in the UI, not a default.
-- ---------------------------------------------------------------------

create table budgets (
  client_id  uuid not null references public.clients(id) on delete cascade,
  fin_year   smallint not null,
  line_id    text not null,           -- report_lines.id
  month      smallint not null check (month between 1 and 12),
  amount     numeric(14,2) not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (client_id, fin_year, line_id, month)
);

-- ---------------------------------------------------------------------
-- VAT
-- ---------------------------------------------------------------------

create table vat_periods (
  client_id  uuid not null references public.clients(id) on delete cascade,
  period     text not null,           -- '2026 Q2'
  date_from  date not null,
  date_to    date not null,
  box1 numeric(14,2), box2 numeric(14,2), box3 numeric(14,2),
  box4 numeric(14,2), box5 numeric(14,2),
  out_base numeric(14,2), in_base numeric(14,2),
  by_code   jsonb,                    -- {code: {ob,ov,ib,iv,on,in}}
  computed_at timestamptz not null default now(),
  primary key (client_id, period)
);

-- The return actually submitted, against which the computed figures are
-- tested. prior_* holds the return's previous-period block, which belongs
-- to earlier quarters of the ledger and must be shown separately.
create table vat_returns (
  client_id   uuid not null references public.clients(id) on delete cascade,
  period      text not null,
  source      text not null,          -- 'BTMS VAT figures summary' | 'filed return'
  file_path   text,                   -- storage path
  box1 numeric(14,2), box2 numeric(14,2), box3 numeric(14,2),
  box4 numeric(14,2), box5 numeric(14,2),
  prior_box1 numeric(14,2), prior_box4 numeric(14,2), prior_box5 numeric(14,2),
  filed_total numeric(14,2),
  by_code     jsonb,
  attached_by uuid references auth.users(id),
  attached_at timestamptz not null default now(),
  primary key (client_id, period, source)
);

-- ---------------------------------------------------------------------
-- Payroll — two BTMS reports, each a check on the other
-- ---------------------------------------------------------------------

create table payroll_periods (
  client_id  uuid not null references public.clients(id) on delete cascade,
  period     date not null,           -- first of the month
  employees  smallint,
  gross      numeric(14,2), deductions numeric(14,2), contributions numeric(14,2),
  net        numeric(14,2), cost numeric(14,2),
  gross_ytd  numeric(14,2), cost_ytd numeric(14,2),
  journal_cost numeric(14,2),         -- what the wages journal actually carries
  primary key (client_id, period)
);

create type payroll_scope as enum ('department','employee');

create table payroll_lines (
  id         bigserial primary key,
  client_id  uuid not null references public.clients(id) on delete cascade,
  period     date not null,
  scope      payroll_scope not null,
  ref        text not null,           -- department code or employee code
  name       text,
  headcount  smallint,
  rate       numeric(10,2), hours numeric(10,2),
  gross numeric(14,2), deductions numeric(14,2), contributions numeric(14,2),
  net numeric(14,2), cost numeric(14,2),
  gross_ytd numeric(14,2), cost_ytd numeric(14,2),
  detail    jsonb,                    -- {earn:{}, ded:{}, con:{}, tr:{}}
  unique (client_id, period, scope, ref)
);

-- ---------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------

create table stock_valuations (
  client_id   uuid not null references public.clients(id) on delete cascade,
  valued_at   date not null,
  items       integer, units numeric(14,2),
  value       numeric(14,2),
  ledger_value numeric(14,2),         -- the stock account at the same date
  negative_items integer, negative_value numeric(14,2),
  file_path   text,
  primary key (client_id, valued_at)
);

-- ---------------------------------------------------------------------
-- Row level security — the whole point
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'company_record','feed_status','exceptions','exception_signoff','exception_queries',
    'report_notes','budgets','vat_periods','vat_returns','payroll_periods',
    'payroll_lines','stock_valuations'
  ] loop
    execute format('alter table reporting.%I enable row level security', t);
    execute format(
      'create policy client_scoped on reporting.%I for all
         using (has_client_access(client_id))
         with check (has_client_access(client_id))', t);
  end loop;
end $$;

-- Payroll is not for every member of staff: an explicit grant on top of
-- client access. Replace the blanket policy on the two payroll tables.
drop policy client_scoped on payroll_periods;
drop policy client_scoped on payroll_lines;

create or replace function has_payroll_access(target uuid) returns boolean
language sql stable security definer set search_path = reporting, public as $$
  select exists (
    select 1 from reporting.client_access ca
    where ca.user_id = auth.uid() and ca.client_id = target and ca.payroll_access
  );
$$;

create policy payroll_scoped on payroll_periods
  for all using (has_payroll_access(client_id)) with check (has_payroll_access(client_id));
create policy payroll_scoped on payroll_lines
  for all using (has_payroll_access(client_id)) with check (has_payroll_access(client_id));

-- ---------------------------------------------------------------------
-- Regenerate the review engine's findings for one client.
-- Called after every commit. Sign-offs and queries are keyed on ex_key
-- and are deliberately left alone: an item that has been corrected in
-- BTMS stops being generated, and its sign-off has nothing to attach to.
-- ---------------------------------------------------------------------

create or replace function regenerate_exceptions(p_client uuid, p_import bigint default null)
returns integer
language plpgsql security invoker set search_path = reporting, public as $$
declare n integer;
begin
  if not has_client_access(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  delete from exceptions where client_id = p_client;

  -- The individual checks are inserted here, one statement each, in the
  -- order given in section 9 of the build specification. Each must carry
  -- journal, journal_no, batch, account and report_line so the item can
  -- be found in BTMS from what appears on screen.
  --
  -- Implemented in P5. Kept as one function so that "re-run the checks"
  -- is a single call from the import pipeline.

  select count(*) into n from exceptions where client_id = p_client;
  return n;
end $$;

-- Housekeeping: a sign-off or a query whose exception no longer exists
-- is dead weight. Clear it once the item has gone.
create or replace function prune_signoffs(p_client uuid) returns integer
language sql security invoker set search_path = reporting, public as $$
  with gone as (
    delete from exception_signoff s
    where s.client_id = p_client
      and not exists (select 1 from exceptions e
                      where e.client_id = s.client_id and e.ex_key = s.ex_key)
    returning 1)
  select count(*)::int from gone;
$$;
