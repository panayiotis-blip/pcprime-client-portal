-- =====================================================================
-- PC Prime & Calculate Consultants — client reporting platform
-- Migration 0001: core schema
--
-- Lives in its own schema inside the portal's Supabase project so the
-- client master and auth directory are shared, not duplicated.
-- Every row is partitioned by client_id and protected by RLS.
-- =====================================================================

create schema if not exists reporting;
set search_path to reporting, public;

-- ---------------------------------------------------------------------
-- Client configuration
-- ---------------------------------------------------------------------

create table client_settings (
  client_id            uuid primary key references public.clients(id) on delete cascade,
  year_end_month       smallint not null default 12 check (year_end_month between 1 and 12),
  currency             char(3)  not null default 'EUR',
  vat_registered       boolean  not null default true,
  vat_scheme           text     not null default 'standard'
                         check (vat_scheme in ('standard','cash','not_registered')),
  vat_quarter_offset   smallint not null default 0 check (vat_quarter_offset between 0 and 2),
  has_stock            boolean  not null default false,
  has_payroll          boolean  not null default false,
  has_branches         boolean  not null default false,
  comparatives         text     not null default 'prior_year'
                         check (comparatives in ('prior_year','budget','both','none')),
  first_reporting_month date,
  dormant_from         date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id)
);

comment on column client_settings.vat_quarter_offset is
  'Which calendar cycle the client''s VAT quarters follow: 0 = Mar/Jun/Sep/Dec, 1 = Jan/Apr/..., 2 = Feb/May/...';

-- ---------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------

create table coa_accounts (
  id            bigserial primary key,
  client_id     uuid not null references public.clients(id) on delete cascade,
  code          text not null,
  name          text not null,
  alt_code      text,
  account_type  text,                       -- BTMS: Asset, Liability, Equity, Income, Expenditure, Debtor, Creditor
  btms_category text,                       -- BTMS "Report Category" — seeds the suggested mapping
  is_header     boolean not null default false,
  control_code  text,                       -- sub-accounts roll up here (e.g. 22100004 -> 221)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (client_id, code)
);

create index coa_accounts_client_control_idx on coa_accounts (client_id, control_code);

-- ---------------------------------------------------------------------
-- Report line templates and mapping
-- ---------------------------------------------------------------------

create table templates (
  id          bigserial primary key,
  kind        text not null check (kind in ('report_lines','pack_contents','budget_lines','discussion_points')),
  client_id   uuid references public.clients(id) on delete cascade,   -- null = practice master
  name        text not null,
  master_id   bigint references templates(id),                        -- the master this copy came from
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

create unique index templates_master_kind_idx on templates (kind) where client_id is null;

create table report_lines (
  id           bigserial primary key,
  template_id  bigint not null references templates(id) on delete cascade,
  line_id      text not null,                                         -- 'P-010', 'B-640'
  statement    text not null check (statement in ('pl','bs')),
  section      text not null,
  line_name    text not null,
  sort_order   integer not null,
  is_subtotal  boolean not null default false,
  is_derived   boolean not null default false,                        -- B-640/B-650 carry no accounts
  unique (template_id, line_id)
);

create table mappings (
  id             bigserial primary key,
  client_id      uuid not null references public.clients(id) on delete cascade,
  account_code   text not null,
  line_id        text not null,
  effective_from date not null default '1900-01-01',
  effective_to   date,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  unique (client_id, account_code, effective_from)
);

comment on table mappings is
  'Versioned by effective date so restating a prior year never rewrites an issued report.';

-- ---------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------

create type feed_type as enum (
  'ledger','trial_balance','sales','purchases','stock','vat',
  'payroll_calc','payroll_journal','payslips','si_submission','si_payment','paye_return','budget'
);

create type import_status as enum ('staged','validated','committed','rejected','withdrawn');

create table imports (
  id                bigserial primary key,
  client_id         uuid not null references public.clients(id) on delete cascade,
  feed              feed_type not null,
  status            import_status not null default 'staged',
  storage_path      text not null,
  original_filename text not null,
  checksum          text not null,
  period_from       date,
  period_to         date,
  months_covered    date[],                       -- first day of each month the file covers
  row_count         integer,
  total_debit       numeric(16,2),
  total_credit      numeric(16,2),
  reported_total    numeric(16,2),                -- the figure on the report's own footer
  truncated         boolean not null default false,
  notes             text,
  uploaded_at       timestamptz not null default now(),
  uploaded_by       uuid not null references auth.users(id),
  committed_at      timestamptz,
  committed_by      uuid references auth.users(id)
);

create index imports_client_feed_idx on imports (client_id, feed, period_to desc);
create unique index imports_checksum_idx on imports (client_id, feed, checksum)
  where status = 'committed';

comment on column imports.truncated is
  'BTMS paginates its exports; a file whose rows do not agree to its own total row is refused here.';

-- ---------------------------------------------------------------------
-- Postings — the detail ledger
-- ---------------------------------------------------------------------

create table postings (
  id             bigserial primary key,
  client_id      uuid not null references public.clients(id) on delete cascade,
  import_id      bigint not null references imports(id) on delete cascade,
  posted_on      date not null,
  period_month   date not null,                  -- first day of the month, generated on insert
  account_code   text not null,
  account_name   text,
  reference      text,
  details        text,
  debit          numeric(14,2) not null default 0,
  credit         numeric(14,2) not null default 0,
  vat_code       text,
  vat_rate       numeric(6,2),
  vat_amount     numeric(14,2) not null default 0,
  journal_code   text,                           -- SIN, PIN, REC, BPM, JV, PRL ...
  journal_no     integer,
  batch_no       integer,
  source_origin  smallint,
  created_at     timestamptz not null default now()
);

create index postings_client_month_idx   on postings (client_id, period_month);
create index postings_client_account_idx on postings (client_id, account_code, posted_on);
create index postings_import_idx         on postings (import_id);
create index postings_journal_idx        on postings (client_id, journal_code, posted_on);

-- ---------------------------------------------------------------------
-- Monthly aggregate — every report reads this, never postings
-- ---------------------------------------------------------------------

create table balances_monthly (
  client_id     uuid not null references public.clients(id) on delete cascade,
  period_month  date not null,
  account_code  text not null,
  debit         numeric(16,2) not null default 0,
  credit        numeric(16,2) not null default 0,
  movement      numeric(16,2) generated always as (debit - credit) stored,
  rebuilt_at    timestamptz not null default now(),
  primary key (client_id, period_month, account_code)
);

-- ---------------------------------------------------------------------
-- Trial balance
-- ---------------------------------------------------------------------

create table trial_balance (
  id             bigserial primary key,
  client_id      uuid not null references public.clients(id) on delete cascade,
  import_id      bigint not null references imports(id) on delete cascade,
  period_month   date not null,
  is_annual      boolean not null default false,
  detailed       boolean not null default false,   -- debtors/suppliers listed individually
  account_code   text not null,
  account_name   text,
  account_type   text,
  opening        numeric(16,2) not null default 0,
  debit          numeric(16,2) not null default 0,
  credit         numeric(16,2) not null default 0,
  closing        numeric(16,2) not null default 0,
  unique (client_id, period_month, is_annual, detailed, account_code)
);

comment on table trial_balance is
  'A monthly BTMS trial balance covers that month only, not year to date. The annual layout covers the year.';

-- ---------------------------------------------------------------------
-- Period status — the coverage board
-- ---------------------------------------------------------------------

create type period_state as enum ('not_due','missing','uploaded','reconciled','issued','locked');

create table period_status (
  client_id     uuid not null references public.clients(id) on delete cascade,
  period_month  date not null,
  feed          feed_type not null,
  state         period_state not null default 'missing',
  import_id     bigint references imports(id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (client_id, period_month, feed)
);

-- ---------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------

create table audit_log (
  id          bigserial primary key,
  client_id   uuid references public.clients(id) on delete cascade,
  entity      text not null,
  entity_id   text,
  action      text not null,
  detail      jsonb,
  acted_at    timestamptz not null default now(),
  acted_by    uuid not null references auth.users(id)
);

create index audit_log_client_idx on audit_log (client_id, acted_at desc);

-- ---------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------

create type staff_role as enum ('preparer','reviewer','supervisor','admin');

create table client_access (
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  role          staff_role not null default 'preparer',
  payroll_access boolean not null default false,
  granted_at    timestamptz not null default now(),
  granted_by    uuid references auth.users(id),
  primary key (user_id, client_id)
);

create or replace function has_client_access(target uuid) returns boolean
language sql stable security definer set search_path = reporting, public as $$
  select exists (
    select 1 from reporting.client_access ca
    where ca.user_id = auth.uid() and ca.client_id = target
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'client_settings','coa_accounts','templates','report_lines','mappings',
    'imports','postings','balances_monthly','trial_balance','period_status',
    'audit_log','client_access'
  ] loop
    execute format('alter table reporting.%I enable row level security', t);
  end loop;
end $$;

create policy client_scoped on postings
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on imports
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on trial_balance
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on balances_monthly
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on coa_accounts
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on mappings
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on period_status
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));
create policy client_scoped on client_settings
  for all using (has_client_access(client_id)) with check (has_client_access(client_id));

-- ---------------------------------------------------------------------
-- Commit a staged import: replaces only the months the file covers,
-- and refuses a net loss of postings without an explicit override.
-- ---------------------------------------------------------------------

create or replace function commit_ledger_import(p_import bigint, p_allow_loss boolean default false)
returns table (months_replaced int, postings_removed int, postings_added int)
language plpgsql security definer set search_path = reporting, public as $$
declare
  v_client uuid;
  v_months date[];
  v_old int;
  v_new int;
begin
  select client_id, months_covered into v_client, v_months
    from imports where id = p_import and status = 'validated';
  if v_client is null then
    raise exception 'Import % is not staged and validated', p_import;
  end if;

  select count(*) into v_old
    from postings where client_id = v_client and period_month = any(v_months);
  select count(*) into v_new
    from postings_staging where import_id = p_import;

  if v_new < v_old and not p_allow_loss then
    raise exception
      'Refusing to commit: % postings held for these months, file carries only %. Override explicitly if intended.',
      v_old, v_new;
  end if;

  delete from postings where client_id = v_client and period_month = any(v_months);
  insert into postings select * from postings_staging where import_id = p_import;
  delete from postings_staging where import_id = p_import;

  delete from balances_monthly where client_id = v_client and period_month = any(v_months);
  insert into balances_monthly (client_id, period_month, account_code, debit, credit)
  select client_id, period_month, account_code, sum(debit), sum(credit)
    from postings where client_id = v_client and period_month = any(v_months)
   group by client_id, period_month, account_code;

  update imports set status = 'committed', committed_at = now(), committed_by = auth.uid()
   where id = p_import;

  insert into period_status (client_id, period_month, feed, state, import_id, updated_by)
  select v_client, m, 'ledger', 'uploaded', p_import, auth.uid() from unnest(v_months) m
  on conflict (client_id, period_month, feed)
    do update set state = 'uploaded', import_id = p_import, updated_at = now(), updated_by = auth.uid();

  months_replaced := array_length(v_months, 1);
  postings_removed := v_old;
  postings_added := v_new;
  return next;
end $$;

create table postings_staging (like postings including defaults);
create index postings_staging_import_idx on postings_staging (import_id);
