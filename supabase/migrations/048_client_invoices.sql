-- =============================================================
-- Migration 048: Client invoicing (sales invoices issued by the firm)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Distinct from the existing public.invoices table, which holds the
-- SCANNED purchase invoices the firm processes for clients.
--
-- This module is the firm's OWN invoicing: invoices issued to clients
-- for services rendered (charged-time entries, fixed fees, expenses).
--
-- Tables:
--   client_invoices       header (one per invoice)
--   client_invoice_lines  line items
--   invoice_sequences     atomic per-year counter for invoice_number
--
-- State machine (client_invoices.status):
--   draft     - editable, no invoice_number yet, time entries reserved (invoice_id set)
--   issued    - assigned invoice_number, locked except for owner/supervisor
--   paid      - terminal, fully locked
--   cancelled - released time entries back to unbilled, locked
--
-- RPCs:
--   issue_client_invoice(id)            draft → issued + assign number
--   cancel_client_invoice(id)           issued/draft → cancelled, release entries
--   mark_client_invoice_paid(id, date)  issued → paid
-- =============================================================

begin;

-- ---------- 1. Per-year invoice counter ----------
create table if not exists public.invoice_sequences (
  year         int  primary key,
  next_number  int  not null default 1
);

-- Atomic next-number generator. Returns 'YYYY-NNN' (3-digit zero-padded).
create or replace function public.next_invoice_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_num  int;
begin
  insert into public.invoice_sequences (year, next_number)
       values (v_year, 2)
  on conflict (year) do update
       set next_number = public.invoice_sequences.next_number + 1
  returning public.invoice_sequences.next_number - 1 into v_num;
  return v_year::text || '-' || lpad(v_num::text, 3, '0');
end $$;

revoke all on function public.next_invoice_number() from public;
grant   execute on function public.next_invoice_number() to authenticated;

-- ---------- 2. client_invoices header ----------
create table if not exists public.client_invoices (
  id                bigserial primary key,
  client_id         bigint not null references public.clients(id) on delete restrict,
  invoice_number    text unique,            -- null while draft
  status            text not null default 'draft'
                      check (status in ('draft','issued','paid','cancelled')),

  issue_date        date,
  due_date          date,
  paid_date         date,

  vat_rate          numeric(5,2) not null default 19.00 check (vat_rate >= 0 and vat_rate <= 100),

  -- Discount applied to vatable line amounts (i.e. firm-side services).
  -- discount_type='percent' uses discount_value as %, 'amount' as €.
  discount_type     text check (discount_type in (null, 'percent', 'amount')),
  discount_value    numeric(12,2) check (discount_value is null or discount_value >= 0),

  -- Computed totals stored at save time so the UI / print can read them
  -- directly without re-computing (and the audit trail captures any drift).
  subtotal_vatable     numeric(12,2) not null default 0,
  subtotal_nonvatable  numeric(12,2) not null default 0,
  discount_amount      numeric(12,2) not null default 0,
  vat_amount           numeric(12,2) not null default 0,
  total_amount         numeric(12,2) not null default 0,

  -- Snapshot of client's billing address at issue time (so later
  -- edits to the client record don't rewrite history)
  billing_address   text,
  notes             text,

  created_by        uuid references auth.users(id) on delete set null,
  issued_by         uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists client_invoices_client_idx       on public.client_invoices (client_id, issue_date desc);
create index if not exists client_invoices_status_idx       on public.client_invoices (status, issue_date desc);
create index if not exists client_invoices_invoice_num_idx  on public.client_invoices (invoice_number) where invoice_number is not null;

drop trigger if exists client_invoices_updated_at on public.client_invoices;
create trigger client_invoices_updated_at before update on public.client_invoices
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tg_audit_client_invoices on public.client_invoices;
create trigger tg_audit_client_invoices
  after insert or update or delete on public.client_invoices
  for each row execute function public.tg_audit();

alter table public.client_invoices enable row level security;

drop policy if exists "client_invoices read"   on public.client_invoices;
drop policy if exists "client_invoices insert" on public.client_invoices;
drop policy if exists "client_invoices update" on public.client_invoices;
drop policy if exists "client_invoices delete" on public.client_invoices;

create policy "client_invoices read" on public.client_invoices
  for select using (public.is_admin());

create policy "client_invoices insert" on public.client_invoices
  for insert with check (public.is_admin());

-- UPDATE: drafts editable by any internal user; issued/paid/cancelled only
-- editable by owner+supervisor (so an admin can build drafts, but only
-- leadership can adjust an issued invoice).
create policy "client_invoices update" on public.client_invoices
  for update using (
    public.is_admin() and (
      status = 'draft'
      or exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('owner','supervisor'))
    )
  )
  with check (
    public.is_admin() and (
      status = 'draft'
      or exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('owner','supervisor'))
    )
  );

-- DELETE only for drafts (data integrity for issued invoices); leadership
-- uses cancel_client_invoice() for issued ones.
create policy "client_invoices delete" on public.client_invoices
  for delete using (
    public.is_admin() and status = 'draft'
  );

-- ---------- 3. client_invoice_lines ----------
create table if not exists public.client_invoice_lines (
  id              bigserial primary key,
  invoice_id      bigint not null references public.client_invoices(id) on delete cascade,
  line_no         int    not null default 1,
  line_type       text   not null default 'fixed'
                    check (line_type in ('time','fixed','expense')),
  description     text   not null,
  quantity        numeric(12,3) not null default 1,
  unit_price      numeric(12,2) not null default 0,
  amount          numeric(12,2) not null default 0,   -- typically quantity * unit_price
  vatable         boolean not null default true,
  time_entry_id   bigint references public.time_entries(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists client_invoice_lines_invoice_idx
  on public.client_invoice_lines (invoice_id, line_no);
create index if not exists client_invoice_lines_time_entry_idx
  on public.client_invoice_lines (time_entry_id)
  where time_entry_id is not null;

alter table public.client_invoice_lines enable row level security;

drop policy if exists "client_invoice_lines read"  on public.client_invoice_lines;
drop policy if exists "client_invoice_lines write" on public.client_invoice_lines;

create policy "client_invoice_lines read" on public.client_invoice_lines
  for select using (public.is_admin());

-- Lines inherit their parent invoice's editability gate.
create policy "client_invoice_lines write" on public.client_invoice_lines
  for all using (
    public.is_admin() and exists (
      select 1 from public.client_invoices ci
       where ci.id = client_invoice_lines.invoice_id
         and (
           ci.status = 'draft'
           or exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role in ('owner','supervisor'))
         )
    )
  )
  with check (
    public.is_admin() and exists (
      select 1 from public.client_invoices ci
       where ci.id = client_invoice_lines.invoice_id
         and (
           ci.status = 'draft'
           or exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role in ('owner','supervisor'))
         )
    )
  );

-- ---------- 4. time_entries.invoice_id FK (deferred from migration 047) ----------
-- The column was added in 047 without a foreign key (the target table
-- didn't exist yet). Wire it up now.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'time_entries_invoice_id_fkey'
       and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_invoice_id_fkey
      foreign key (invoice_id) references public.client_invoices(id) on delete set null;
  end if;
end $$;

-- ---------- 5. State-transition RPCs ----------

-- Issue a draft invoice. Assigns an invoice_number from the year sequence,
-- marks linked time entries as billing_status='invoiced'.
create or replace function public.issue_client_invoice(p_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inv     public.client_invoices%rowtype;
  v_number  text;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles
                  where id = v_user_id and role in ('owner','supervisor','admin','staff')) then
    raise exception 'Staff only';
  end if;

  select * into v_inv from public.client_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'draft' then
    raise exception 'Only draft invoices can be issued (current: %)', v_inv.status;
  end if;

  v_number := public.next_invoice_number();

  update public.client_invoices
     set status         = 'issued',
         invoice_number = v_number,
         issued_by      = v_user_id,
         issue_date     = coalesce(issue_date, current_date)
   where id = p_id;

  -- Mark linked time entries as invoiced
  update public.time_entries
     set billing_status = 'invoiced'
   where invoice_id = p_id
     and billing_status <> 'invoiced';

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_user_id, 'client_invoices.issue', 'client_invoices', p_id,
          jsonb_build_object('invoice_number', v_number));

  return v_number;
end $$;

revoke all on function public.issue_client_invoice(bigint) from public;
grant   execute on function public.issue_client_invoice(bigint) to authenticated;

-- Cancel an invoice. Releases all linked time entries back to unbilled.
-- Leadership only (owner / supervisor).
create or replace function public.cancel_client_invoice(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inv     public.client_invoices%rowtype;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles
                  where id = v_user_id and role in ('owner','supervisor')) then
    raise exception 'Only owner or supervisor can cancel invoices';
  end if;

  select * into v_inv from public.client_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status = 'cancelled' then return; end if;
  if v_inv.status = 'paid' then
    raise exception 'Paid invoices cannot be cancelled';
  end if;

  -- Release linked time entries
  update public.time_entries
     set billing_status = 'unbilled',
         invoice_id     = null
   where invoice_id = p_id;

  update public.client_invoices
     set status = 'cancelled'
   where id = p_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_user_id, 'client_invoices.cancel', 'client_invoices', p_id,
          jsonb_build_object('invoice_number', v_inv.invoice_number));
end $$;

revoke all on function public.cancel_client_invoice(bigint) from public;
grant   execute on function public.cancel_client_invoice(bigint) to authenticated;

-- Mark an issued invoice paid.
create or replace function public.mark_client_invoice_paid(p_id bigint, p_paid_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inv     public.client_invoices%rowtype;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles
                  where id = v_user_id and role in ('owner','supervisor','admin','staff')) then
    raise exception 'Staff only';
  end if;

  select * into v_inv from public.client_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'issued' then
    raise exception 'Only issued invoices can be marked paid (current: %)', v_inv.status;
  end if;

  update public.client_invoices
     set status    = 'paid',
         paid_date = coalesce(p_paid_date, current_date)
   where id = p_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, summary)
  values (v_user_id, 'client_invoices.mark_paid', 'client_invoices', p_id,
          jsonb_build_object('invoice_number', v_inv.invoice_number));
end $$;

revoke all on function public.mark_client_invoice_paid(bigint, date) from public;
grant   execute on function public.mark_client_invoice_paid(bigint, date) to authenticated;

-- ---------- 6. Sync trigger: keep time_entries pinned to draft invoice ----------
-- When a time-entry-typed line is INSERTed, set the time entry's invoice_id.
-- When it's DELETEd from a draft, release the time entry.
create or replace function public.tg_invoice_line_sync_time_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' and new.line_type = 'time' and new.time_entry_id is not null then
    -- Pin the time entry to this invoice (do not yet flip billing_status)
    update public.time_entries
       set invoice_id = new.invoice_id
     where id = new.time_entry_id
       and (invoice_id is null or invoice_id = new.invoice_id);
    return new;
  elsif tg_op = 'DELETE' and old.line_type = 'time' and old.time_entry_id is not null then
    select status into v_status from public.client_invoices where id = old.invoice_id;
    -- Only release if the parent invoice is still a draft
    if v_status = 'draft' then
      update public.time_entries
         set invoice_id     = null,
             billing_status = 'unbilled'
       where id = old.time_entry_id;
    end if;
    return old;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists tg_invoice_line_sync on public.client_invoice_lines;
create trigger tg_invoice_line_sync
  after insert or delete on public.client_invoice_lines
  for each row execute function public.tg_invoice_line_sync_time_entry();

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 048.
-- =============================================================
