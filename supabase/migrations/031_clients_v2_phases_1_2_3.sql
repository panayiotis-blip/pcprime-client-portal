-- 031_clients_v2_phases_1_2_3.sql
-- Pre-go-live foundation: schema additions, directors table, new code
-- generator, and bulk wipe RPCs. Frontend keeps working unchanged; new
-- fields are optional, new tables are isolated.
--
--   Phase 1  — schema additions on clients + client_directors table
--   Phase 2  — generate_client_code_v2 (no 221 prefix, e.g. ASP01)
--   Phase 3  — wipe_test_clients + estimate RPC

begin;

-- =============================================================
-- PHASE 1A — Schema additions on clients
-- =============================================================

-- name_tax_office: Greek name exactly as it appears on tax-office returns.
-- text is UTF-8 by default in Postgres, so Greek/accents/etc work natively.
alter table public.clients add column if not exists name_tax_office text;

-- client_category: structured dropdown for the new tabbed UI. business_type
-- is kept too (per user direction) — they serve different roles: category is
-- the legal/tax classification, business_type is the operational description.
alter table public.clients
  add column if not exists client_category text
  check (client_category is null or client_category in (
    'company', 'partnership', 'individual', 'sole_trader',
    'self_employed', 'deceased', 'dormant', 'prospective', 'other'
  ));

-- is_active: drives the green/red toggle. Backfilled from status text below.
-- status text remains (user wants to keep both) — status carries the nuance
-- (active / inactive / suspended), is_active is the boolean for the toggle.
alter table public.clients add column if not exists is_active boolean default true;

-- Other Phase-1 fields
alter table public.clients add column if not exists tax_return_type      text;
alter table public.clients add column if not exists year_end_date        text;  -- 'DD/MM' format
alter table public.clients add column if not exists vat_period           text;
alter table public.clients add column if not exists fax                  text;
alter table public.clients add column if not exists bulk_import_batch_id text;  -- used by Phase 4 rollback

-- Backfill is_active from status text
update public.clients
  set is_active = case
    when lower(coalesce(status, 'active')) in ('active') then true
    when lower(coalesce(status, ''))       in ('inactive','suspended','deceased','dormant') then false
    else true
  end
  where is_active is null;

-- Indexes
create index if not exists clients_active_idx
  on public.clients (is_active) where deleted_at is null;
create index if not exists clients_batch_idx
  on public.clients (bulk_import_batch_id) where bulk_import_batch_id is not null;
create index if not exists clients_category_idx
  on public.clients (client_category) where deleted_at is null;

-- =============================================================
-- PHASE 1B — client_directors table
-- =============================================================
create table if not exists public.client_directors (
  id                   bigserial primary key,
  client_id            bigint not null references public.clients(id) on delete cascade,
  director_client_id   bigint references public.clients(id) on delete set null,  -- optional link if director is also a client
  name                 text not null,
  id_number            text,
  email                text,
  phone                text,
  shareholding_percent numeric(5,2),
  role                 text not null default 'director'
                         check (role in ('director','shareholder','both','secretary','signatory')),
  appointed_date       date,
  resigned_date        date,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists client_directors_client_idx
  on public.client_directors (client_id);
create index if not exists client_directors_linked_idx
  on public.client_directors (director_client_id) where director_client_id is not null;

-- updated_at auto-bump
create or replace function public._tg_client_directors_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_client_directors_updated_at on public.client_directors;
create trigger trg_client_directors_updated_at
  before update on public.client_directors
  for each row execute function public._tg_client_directors_updated_at();

-- Audit trigger (uses the existing generic tg_audit function from migration 007)
drop trigger if exists trg_client_directors_audit on public.client_directors;
create trigger trg_client_directors_audit
  after insert or update or delete on public.client_directors
  for each row execute function public.tg_audit();

-- RLS — same pattern as documents/emails: clients.read for SELECT,
-- clients.write for INSERT/UPDATE/DELETE, both gated on user_clients linkage
-- (or clients.read_all for internal-firm roles).
alter table public.client_directors enable row level security;

drop policy if exists "client_directors_read"  on public.client_directors;
drop policy if exists "client_directors_write" on public.client_directors;

create policy "client_directors_read"
  on public.client_directors for select to authenticated
  using (
    public.has_permission('clients.read') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_directors.client_id and uc.user_id = auth.uid()
      )
    )
  );

create policy "client_directors_write"
  on public.client_directors for all to authenticated
  using (
    public.has_permission('clients.write') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_directors.client_id and uc.user_id = auth.uid()
      )
    )
  )
  with check (
    public.has_permission('clients.write') and (
      public.has_permission('clients.read_all')
      or exists (
        select 1 from public.user_clients uc
        where uc.client_id = client_directors.client_id and uc.user_id = auth.uid()
      )
    )
  );

-- =============================================================
-- PHASE 2 — Client code generator v2 (no 221 prefix)
-- =============================================================
-- Rule: 3 alphanumeric chars from name (uppercase, X-padded if short) + 2-digit
-- sequence (01, 02, ...). Spills to 3-digit if 99 collide. Examples:
--   'A & S PRODROMOU MOVING SERVICES LIMITED' -> ASP01
--   'A. K. ERACLEOUS LIMITED'                 -> AKE01
--   'ADAMIDIS NIKOLAOS' (if ADA01 taken)      -> ADA02
create or replace function public.generate_client_code_v2(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_code   text;
  v_n      int := 1;
begin
  v_prefix := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  v_prefix := substring(v_prefix from 1 for 3);
  while length(v_prefix) < 3 loop
    v_prefix := v_prefix || 'X';
  end loop;

  loop
    v_code := v_prefix || lpad(v_n::text, 2, '0');
    if not exists (select 1 from public.clients where client_code = v_code) then
      return v_code;
    end if;
    v_n := v_n + 1;
    if v_n > 99 then
      -- Spill to 3 digits (very rare — 'COM100' etc.)
      loop
        v_code := v_prefix || lpad(v_n::text, 3, '0');
        if not exists (select 1 from public.clients where client_code = v_code) then
          return v_code;
        end if;
        v_n := v_n + 1;
        if v_n > 9999 then
          raise exception 'Could not generate unique client_code for %', p_name;
        end if;
      end loop;
    end if;
  end loop;
end $$;

revoke all on function public.generate_client_code_v2(text) from public;
grant   execute on function public.generate_client_code_v2(text) to authenticated;

comment on function public.generate_client_code_v2(text) is
  'Generates a unique client_code using the new format (3 letters + 2-digit sequence, e.g. ASP01). Replaces the legacy 221-prefixed generator for new clients; legacy codes on existing rows are preserved as-is.';

-- =============================================================
-- PHASE 3A — Estimate what bulk wipe would remove (no side effects)
-- =============================================================
create or replace function public.estimate_wipe_test_clients()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with client_ids as (
    select id from public.clients where deleted_at is null
  )
  select jsonb_build_object(
    'clients',              (select count(*) from client_ids),
    'invoices',             (select count(*) from public.invoices             where client_id in (select id from client_ids)),
    'documents',            (select count(*) from public.documents            where client_id in (select id from client_ids)),
    'platform_credentials', (select count(*) from public.platform_credentials where client_id in (select id from client_ids)),
    'compliance_tasks',     (select count(*) from public.compliance_tasks     where client_id in (select id from client_ids)),
    'staff_tasks',          (select count(*) from public.staff_tasks          where client_id in (select id from client_ids)),
    'client_emails',        (select count(*) from public.client_emails        where client_id in (select id from client_ids)),
    'email_attachments',    (select count(*) from public.client_email_attachments
                              where email_id in (select id from public.client_emails where client_id in (select id from client_ids))),
    'appointments',         (select count(*) from public.appointments         where client_id in (select id from client_ids)),
    'call_logs',            (select count(*) from public.call_logs            where client_id in (select id from client_ids)),
    'user_clients',         (select count(*) from public.user_clients         where client_id in (select id from client_ids))
  );
$$;

revoke all on function public.estimate_wipe_test_clients() from public;
grant   execute on function public.estimate_wipe_test_clients() to authenticated;

-- =============================================================
-- PHASE 3B — Bulk wipe RPC (owner only, confirmation phrase required)
-- =============================================================
-- Hard-deletes child rows (invoices, docs, credentials, etc.) for all live
-- clients, then soft-deletes the clients themselves with a "Wiped {ts} by {who}"
-- note. Storage objects (PDFs in buckets) are NOT removed by this function —
-- they're cleaned up client-side or left as orphans (test data only).
create or replace function public.wipe_test_clients(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := auth.uid();
  v_user_email  text;
  v_role        text;
  v_client_ids  bigint[];
  v_clients     int := 0;
  v_invoices    int := 0;
  v_documents   int := 0;
  v_credentials int := 0;
  v_compliance  int := 0;
  v_tasks       int := 0;
  v_emails      int := 0;
  v_attachments int := 0;
  v_appts       int := 0;
  v_calls       int := 0;
  v_uc          int := 0;
  v_note        text;
  v_summary     jsonb;
begin
  -- Fresh MFA proof required (this is highly destructive)
  perform public.require_aal2();

  -- Owner only
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') <> 'owner' then
    raise exception 'Only the owner can perform a bulk wipe (current role: %)', coalesce(v_role, 'none');
  end if;

  if coalesce(p_confirmation, '') <> 'WIPE ALL CLIENTS' then
    raise exception 'Confirmation phrase mismatch. Required exactly: WIPE ALL CLIENTS';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  -- Snapshot which clients we're wiping
  select array_agg(id) into v_client_ids from public.clients where deleted_at is null;
  if v_client_ids is null then v_client_ids := array[]::bigint[]; end if;

  -- Pre-count attachments before email-cascade removes them
  select count(*) into v_attachments
  from public.client_email_attachments
  where email_id in (select id from public.client_emails where client_id = any(v_client_ids));

  -- Hard-delete children. Order matters where there are inter-child FKs.
  with d as (delete from public.client_emails       where client_id = any(v_client_ids) returning 1) select count(*) into v_emails       from d;
  with d as (delete from public.invoices            where client_id = any(v_client_ids) returning 1) select count(*) into v_invoices    from d;
  with d as (delete from public.documents           where client_id = any(v_client_ids) returning 1) select count(*) into v_documents   from d;
  with d as (delete from public.platform_credentials where client_id = any(v_client_ids) returning 1) select count(*) into v_credentials from d;
  with d as (delete from public.compliance_tasks    where client_id = any(v_client_ids) returning 1) select count(*) into v_compliance  from d;
  with d as (delete from public.staff_tasks         where client_id = any(v_client_ids) returning 1) select count(*) into v_tasks       from d;
  with d as (delete from public.appointments        where client_id = any(v_client_ids) returning 1) select count(*) into v_appts       from d;
  with d as (delete from public.call_logs           where client_id = any(v_client_ids) returning 1) select count(*) into v_calls       from d;
  with d as (delete from public.user_clients        where client_id = any(v_client_ids) returning 1) select count(*) into v_uc          from d;

  -- Soft-delete clients with a wipe-note
  v_note := 'Wiped ' || now()::text || ' by ' || coalesce(v_user_email, v_user_id::text) || ' — pre-go-live cleanup';
  with u as (
    update public.clients
    set deleted_at = now(),
        notes      = case when coalesce(notes,'') = '' then v_note else notes || E'\n\n' || v_note end
    where id = any(v_client_ids)
    returning 1
  ) select count(*) into v_clients from u;

  v_summary := jsonb_build_object(
    'clients',              v_clients,
    'invoices',             v_invoices,
    'documents',            v_documents,
    'platform_credentials', v_credentials,
    'compliance_tasks',     v_compliance,
    'staff_tasks',          v_tasks,
    'client_emails',        v_emails,
    'email_attachments',    v_attachments,
    'appointments',         v_appts,
    'call_logs',            v_calls,
    'user_clients',         v_uc
  );

  -- Single audit entry tagged as a bulk wipe
  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (v_user_id, v_user_email, 'clients.bulk_wipe', 'clients', null, v_summary);

  return v_summary;
end $$;

revoke all on function public.wipe_test_clients(text) from public;
grant   execute on function public.wipe_test_clients(text) to authenticated;

comment on function public.wipe_test_clients(text) is
  'Pre-go-live test-data wipe. Owner only. Confirmation: caller must pass the literal string "WIPE ALL CLIENTS". Hard-deletes child rows (invoices, docs, credentials, tasks, emails, etc.) for all live clients then soft-deletes the clients themselves with a wipe-note. Soft-deleted clients remain restorable from the existing /clients/deleted page but their data is permanently gone. Storage objects are NOT removed.';

commit;
-- =============================================================
-- Verify after running:
--   select count(*) from clients where deleted_at is null;  -- still 123 (wipe not run yet)
--   select * from estimate_wipe_test_clients();             -- shows counts that would be deleted
--   \d public.client_directors                              -- new table exists
--   select generate_client_code_v2('Acme Tax Services Ltd'); -- expect ACM01 (or next free)
-- =============================================================
