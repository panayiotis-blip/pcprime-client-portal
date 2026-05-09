-- =============================================================
-- Phase 0 Security Fixes
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- This migration is wrapped in a single transaction. If anything
-- fails, the whole thing rolls back and your database is unchanged.
--
-- Items covered:
--   1. Harden the user-creation trigger so signup metadata cannot
--      grant admin role.
--   2. Add 'owner' and 'supervisor' roles. Set roles on
--      panayiotis@... (owner) and christina@... (supervisor).
--      Widen is_admin() so existing RLS policies keep working for
--      all three internal roles.
--   3. Lock public.platform_credentials so no inserts/updates/
--      deletes are possible (existing rows preserved).
--   4. Create public.audit_log + helper function + auto-capture
--      triggers on the high-value tables.
--   5. Add deleted_at columns to public.clients and
--      public.documents. Rebuild their RLS so soft-deleted rows
--      are hidden from everyone (admin restore via raw SQL until
--      we build a UI in a later phase). Hard DELETE is blocked at
--      the policy level too — UPDATE deleted_at = now() instead.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- ITEM 1: Harden handle_new_user trigger
-- Always set role = 'client' regardless of what the new user
-- supplied in raw_user_meta_data. The admin-users edge function
-- explicitly UPDATEs the role afterwards when it needs to.
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'client',                       -- role NEVER taken from user metadata
    true
  )
  on conflict (id) do nothing;
  return new;
end; $$;


-- -------------------------------------------------------------
-- ITEM 2a: Widen is_admin() before changing roles
-- Returns true for owner / supervisor / admin / staff so every
-- existing RLS policy that gates on is_admin() continues to work.
-- -------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('owner', 'supervisor', 'admin', 'staff')
      and active = true
  );
$$;


-- -------------------------------------------------------------
-- ITEM 2b: Widen the CHECK on profiles.role
-- -------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles drop constraint profiles_role_check;
  end if;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'supervisor', 'admin', 'staff', 'client'));


-- -------------------------------------------------------------
-- ITEM 3: Lock platform_credentials — writes blocked at RLS
-- Existing rows remain readable to admins for export.
-- -------------------------------------------------------------
drop policy if exists "platform_creds admin"     on public.platform_credentials;
drop policy if exists "platform_creds read only" on public.platform_credentials;
create policy "platform_creds read only" on public.platform_credentials
  for select using (public.is_admin());
-- No INSERT / UPDATE / DELETE policy → no writes from anyone via
-- the publishable key. Service-role bypass still works (intended
-- backdoor for ops); audit trigger below captures any writes.


-- -------------------------------------------------------------
-- ITEM 5a: Add deleted_at columns (placed before audit setup so
-- the audit-trigger function can recognise soft-delete events).
-- -------------------------------------------------------------
alter table public.clients   add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_at timestamptz;

create index if not exists clients_deleted_at_idx
  on public.clients(deleted_at) where deleted_at is not null;
create index if not exists documents_deleted_at_idx
  on public.documents(deleted_at) where deleted_at is not null;


-- -------------------------------------------------------------
-- ITEM 5b: Rebuild clients RLS for soft-delete model
-- -------------------------------------------------------------
drop policy if exists "clients read linked or admin" on public.clients;
drop policy if exists "clients admin write"          on public.clients;
drop policy if exists "clients linked user update"   on public.clients;
drop policy if exists "clients select"               on public.clients;
drop policy if exists "clients insert admin"         on public.clients;
drop policy if exists "clients update admin"         on public.clients;
drop policy if exists "clients update linked"        on public.clients;

-- Read: linked or admin, undeleted only
create policy "clients select" on public.clients
  for select using (public.user_can_access_client(id) and deleted_at is null);

-- Insert: admin only
create policy "clients insert admin" on public.clients
  for insert with check (public.is_admin());

-- Update (admin path): no deleted_at filter, so admins can soft-delete or restore
create policy "clients update admin" on public.clients
  for update using (public.is_admin()) with check (public.is_admin());

-- Update (linked client user path): only undeleted rows
create policy "clients update linked" on public.clients
  for update using (public.user_can_access_client(id) and deleted_at is null)
  with check (public.user_can_access_client(id) and deleted_at is null);

-- No DELETE policy → hard deletes blocked. Use UPDATE deleted_at instead.


-- -------------------------------------------------------------
-- ITEM 5c: Rebuild documents RLS for soft-delete model
-- -------------------------------------------------------------
drop policy if exists "documents read"          on public.documents;
drop policy if exists "documents write"         on public.documents;
drop policy if exists "documents select"        on public.documents;
drop policy if exists "documents insert"        on public.documents;
drop policy if exists "documents update admin"  on public.documents;
drop policy if exists "documents update linked" on public.documents;

create policy "documents select" on public.documents
  for select using (public.user_can_access_client(client_id) and deleted_at is null);

create policy "documents insert" on public.documents
  for insert with check (public.user_can_access_client(client_id));

create policy "documents update admin" on public.documents
  for update using (public.is_admin()) with check (public.is_admin());

create policy "documents update linked" on public.documents
  for update using (public.user_can_access_client(client_id) and deleted_at is null)
  with check (public.user_can_access_client(client_id) and deleted_at is null);

-- No DELETE policy → hard deletes blocked.


-- -------------------------------------------------------------
-- ITEM 4a: audit_log table
-- -------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigserial primary key,
  ts           timestamptz not null default now(),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  action       text not null,        -- e.g. 'clients.update', 'documents.delete', 'login'
  target_type  text,                  -- e.g. 'clients', 'documents'
  target_id    text,                  -- stringified primary key
  summary      jsonb,                 -- before/after, file name, etc.
  ip_address   inet,
  user_agent   text
);

create index if not exists audit_log_ts_idx        on public.audit_log (ts desc);
create index if not exists audit_log_actor_idx     on public.audit_log (actor_id, ts desc);
create index if not exists audit_log_target_idx    on public.audit_log (target_type, target_id, ts desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log read admin" on public.audit_log;
create policy "audit_log read admin" on public.audit_log
  for select using (public.is_admin());

-- No INSERT / UPDATE / DELETE policies → only SECURITY DEFINER
-- functions (log_action, tg_audit) can write. Logs are tamper-
-- resistant from inside the application.


-- -------------------------------------------------------------
-- ITEM 4b: log_action() — for app-driven events (login, export,
-- download). Called from the frontend via the supabase RPC.
-- -------------------------------------------------------------
create or replace function public.log_action(
  p_action       text,
  p_target_type  text default null,
  p_target_id    text default null,
  p_summary      jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();

  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (auth.uid(), v_email, p_action, p_target_type, p_target_id, p_summary);
exception when others then
  -- Audit failures must never block the calling user action
  raise warning 'audit_log insert failed: %', sqlerrm;
end;
$$;

revoke all on function public.log_action(text, text, text, jsonb) from public;
grant execute on function public.log_action(text, text, text, jsonb) to authenticated;


-- -------------------------------------------------------------
-- ITEM 4c: tg_audit() — generic trigger function for capturing
-- INSERT / UPDATE / DELETE on the audited tables.
-- Special-cases soft-delete (deleted_at went null → not-null) as
-- 'X.delete' instead of 'X.update'.
-- -------------------------------------------------------------
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action     text;
  v_target_id  text;
  v_summary    jsonb;
  v_email      text;
  v_old_jsonb  jsonb;
  v_new_jsonb  jsonb;
begin
  if TG_OP = 'INSERT' then
    v_new_jsonb := to_jsonb(new);
    v_action := TG_TABLE_NAME || '.create';
    v_target_id := v_new_jsonb ->> 'id';
    v_summary := jsonb_build_object('new', v_new_jsonb);
  elsif TG_OP = 'UPDATE' then
    v_old_jsonb := to_jsonb(old);
    v_new_jsonb := to_jsonb(new);
    v_action := TG_TABLE_NAME || '.update';
    v_target_id := v_new_jsonb ->> 'id';
    if (v_old_jsonb ? 'deleted_at') and (v_new_jsonb ? 'deleted_at') then
      if (v_old_jsonb ->> 'deleted_at') is null and (v_new_jsonb ->> 'deleted_at') is not null then
        v_action := TG_TABLE_NAME || '.delete';
      elsif (v_old_jsonb ->> 'deleted_at') is not null and (v_new_jsonb ->> 'deleted_at') is null then
        v_action := TG_TABLE_NAME || '.restore';
      end if;
    end if;
    v_summary := jsonb_build_object('old', v_old_jsonb, 'new', v_new_jsonb);
  elsif TG_OP = 'DELETE' then
    v_old_jsonb := to_jsonb(old);
    v_action := TG_TABLE_NAME || '.hard_delete';
    v_target_id := v_old_jsonb ->> 'id';
    v_summary := jsonb_build_object('old', v_old_jsonb);
  end if;

  select email into v_email from auth.users where id = auth.uid();

  begin
    insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
    values (auth.uid(), v_email, v_action, TG_TABLE_NAME, v_target_id, v_summary);
  exception when others then
    raise warning 'audit_log insert failed for % on %: %', TG_OP, TG_TABLE_NAME, sqlerrm;
  end;

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;


-- -------------------------------------------------------------
-- ITEM 4d: Attach audit triggers to high-value tables
-- -------------------------------------------------------------
drop trigger if exists tg_audit_clients on public.clients;
create trigger tg_audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.tg_audit();

drop trigger if exists tg_audit_documents on public.documents;
create trigger tg_audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.tg_audit();

drop trigger if exists tg_audit_invoices on public.invoices;
create trigger tg_audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function public.tg_audit();

drop trigger if exists tg_audit_compliance_tasks on public.compliance_tasks;
create trigger tg_audit_compliance_tasks
  after insert or update or delete on public.compliance_tasks
  for each row execute function public.tg_audit();

drop trigger if exists tg_audit_profiles on public.profiles;
create trigger tg_audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.tg_audit();

drop trigger if exists tg_audit_user_clients on public.user_clients;
create trigger tg_audit_user_clients
  after insert or update or delete on public.user_clients
  for each row execute function public.tg_audit();

drop trigger if exists tg_audit_platform_credentials on public.platform_credentials;
create trigger tg_audit_platform_credentials
  after insert or update or delete on public.platform_credentials
  for each row execute function public.tg_audit();


-- -------------------------------------------------------------
-- ITEM 2c: Set the new owner / supervisor roles.
-- This is the LAST step — by now audit triggers exist, so these
-- changes are recorded as the first entries in audit_log.
-- -------------------------------------------------------------
do $$
declare
  v_owner_id uuid;
  v_super_id uuid;
begin
  select id into v_owner_id from auth.users where email = 'panayiotis@primeandcalculate.com';
  select id into v_super_id from auth.users where email = 'christina@primeandcalculate.com';

  if v_owner_id is null then
    raise warning 'Owner account not found in auth.users: panayiotis@primeandcalculate.com';
  else
    update public.profiles set role = 'owner', active = true where id = v_owner_id;
    raise notice 'Set role=owner for panayiotis (%)', v_owner_id;
  end if;

  if v_super_id is null then
    raise warning 'Supervisor account not found in auth.users: christina@primeandcalculate.com';
  else
    update public.profiles set role = 'supervisor', active = true where id = v_super_id;
    raise notice 'Set role=supervisor for christina (%)', v_super_id;
  end if;
end $$;


commit;
-- =============================================================
-- End of migration 007_phase0_security.sql
--
-- After running, verify in Supabase Dashboard → SQL Editor:
--   select id, role, active from public.profiles
--     where role in ('owner','supervisor');
--   select count(*) from public.audit_log;   -- should be ≥ 2
-- =============================================================
