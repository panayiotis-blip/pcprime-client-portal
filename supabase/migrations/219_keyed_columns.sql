-- =====================================================================
-- Migration 219: a column the partner types into
--
-- FIX-3 §3. Sitting with a client he needs to put figures in himself and
-- see the arithmetic -- a target, a what-if, an agreed adjustment -- as a
-- comparison column on the profit and loss, with the variance computed
-- against it like any other column.
--
-- It is kept here rather than in browser storage for the same reason the
-- budget was moved in migration 191: a conversation held on one machine
-- is worth nothing on another, and a key of the form "pcp-keyed" with no
-- client in it shows one client's figures under every other client's
-- name. That is the one rule this build has above all others.
--
-- WHAT THIS IS NOT. These figures are keyed by a person. They are not
-- from the ledger and nothing derives them. Deliberately:
--
--   * No trigger, no default, nothing that copies actuals or a budget in.
--     Seeding a "what-if" from the ledger is a deliberate act in the UI.
--   * Nothing else reads this table. It does not feed the statements, the
--     review, the audit or the VAT return. The application marks every
--     figure that comes out of here as keyed, wherever it appears.
--   * It is not a budget. reporting.budgets is the agreed budget for a
--     financial year, keyed per month, and the review measures against
--     it. This is a column in a conversation, and more than one can be
--     kept for the same period.
--
-- The period is stored as the two month keys the report ran on, in the
-- template's own '2026-01' form, because that is what the column was
-- typed against. A column keyed against January-to-July is offered when
-- the profit and loss is showing January to July, and not otherwise --
-- a target for seven months is not a target for twelve.
-- =====================================================================

set search_path to reporting, public;

create table if not exists reporting.keyed_columns (
  id          bigserial primary key,
  client_id   bigint not null references public.clients(id) on delete cascade,
  period_from text   not null,              -- '2026-01', the template's month key
  period_to   text   not null,              -- '2026-07'
  name        text   not null check (length(btrim(name)) between 1 and 60),
  amounts     jsonb  not null default '{}'::jsonb,   -- {report_lines.id: number}
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One name per client per period. Keying "Target" twice for the same
  -- seven months is a correction of the first, not a second column.
  unique (client_id, period_from, period_to, name)
);

comment on table reporting.keyed_columns is
  'Comparison columns keyed by hand on the profit and loss (FIX-3 §3). Not from the ledger; nothing derives them and nothing else reads them. See migration 219.';
comment on column reporting.keyed_columns.amounts is
  'report_lines.id -> amount, for the whole period. A line absent from this object was not keyed, which is not the same as keyed at nought.';

create index if not exists keyed_columns_client_period
  on reporting.keyed_columns (client_id, period_from, period_to);

-- The same access rule as every other table in this schema. There is no
-- second register of who may see what: it defers to staff_can_access(),
-- which migration 214 settled.
alter table reporting.keyed_columns enable row level security;

drop policy if exists client_scoped on reporting.keyed_columns;
create policy client_scoped on reporting.keyed_columns for all
  using (reporting.staff_can_access(client_id))
  with check (reporting.staff_can_access(client_id));

grant select, insert, update, delete on reporting.keyed_columns to authenticated;
grant usage, select on sequence reporting.keyed_columns_id_seq to authenticated;
-- service_role is covered by the default privileges set in migration 216.
