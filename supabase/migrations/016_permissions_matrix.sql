-- =============================================================
-- Migration 016: Per-user permissions matrix (Phase 1)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds:
--   role_permission_defaults  — static lookup of which permissions
--                                each role gets by default (matches
--                                existing role-based behaviour exactly).
--   user_permissions          — per-user overrides (grant or revoke
--                                a specific permission).
--   has_permission(perm)      — main check used by RLS / RPCs.
--   get_my_permissions()      — bulk fetch for UI on login.
--   get_user_permissions(uid) — admin: list a user's effective perms.
--   set_user_permission(...)  — admin: grant / revoke a single perm.
--
-- Wires Phase 1 enforcement on these high-impact spots:
--   - platform_credentials read/write policies
--   - audit_log read policy
--   - get_credential_password   → credentials.reveal
--   - set_credential_password   → credentials.write
--   - soft_delete_client        → clients.delete
--   - restore_client            → clients.restore
--   - soft_delete_document      → documents.delete
--   - restore_document          → documents.delete (no separate restore)
--   - list_deleted_clients      → clients.restore
--
-- Other policies still use the legacy role gates and migrate later.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Schema
-- -------------------------------------------------------------
create table if not exists public.role_permission_defaults (
  role       text not null,
  permission text not null,
  primary key (role, permission)
);

create table if not exists public.user_permissions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  permission text not null,
  granted    boolean not null,                 -- true = explicit grant; false = explicit revoke
  set_by     uuid references auth.users(id) on delete set null,
  set_at     timestamptz not null default now(),
  primary key (user_id, permission)
);

create index if not exists user_permissions_user_idx on public.user_permissions(user_id);

-- -------------------------------------------------------------
-- 2. Pre-populate role defaults to match TODAY's behaviour exactly.
-- Re-runnable thanks to ON CONFLICT DO NOTHING.
-- -------------------------------------------------------------
insert into public.role_permission_defaults (role, permission) values
  -- OWNER: everything
  ('owner', 'clients.read'), ('owner', 'clients.write'), ('owner', 'clients.delete'), ('owner', 'clients.restore'),
  ('owner', 'invoices.read'), ('owner', 'invoices.write'), ('owner', 'invoices.export'),
  ('owner', 'documents.read'), ('owner', 'documents.write'), ('owner', 'documents.delete'),
  ('owner', 'compliance.read'), ('owner', 'compliance.write'), ('owner', 'compliance.generate'),
  ('owner', 'tasks.read'), ('owner', 'tasks.write'),
  ('owner', 'credentials.read'), ('owner', 'credentials.reveal'), ('owner', 'credentials.write'),
  ('owner', 'audit.read'),
  ('owner', 'users.read'), ('owner', 'users.write'), ('owner', 'roles.write'),
  ('owner', 'chart_of_accounts.read'), ('owner', 'chart_of_accounts.write'),
  ('owner', 'vendor_patterns.read'), ('owner', 'vendor_patterns.write'),
  ('owner', 'folders.write'),

  -- SUPERVISOR: everything except user/role management
  ('supervisor', 'clients.read'), ('supervisor', 'clients.write'), ('supervisor', 'clients.delete'), ('supervisor', 'clients.restore'),
  ('supervisor', 'invoices.read'), ('supervisor', 'invoices.write'), ('supervisor', 'invoices.export'),
  ('supervisor', 'documents.read'), ('supervisor', 'documents.write'), ('supervisor', 'documents.delete'),
  ('supervisor', 'compliance.read'), ('supervisor', 'compliance.write'), ('supervisor', 'compliance.generate'),
  ('supervisor', 'tasks.read'), ('supervisor', 'tasks.write'),
  ('supervisor', 'credentials.read'), ('supervisor', 'credentials.reveal'), ('supervisor', 'credentials.write'),
  ('supervisor', 'audit.read'),
  ('supervisor', 'chart_of_accounts.read'), ('supervisor', 'chart_of_accounts.write'),
  ('supervisor', 'vendor_patterns.read'), ('supervisor', 'vendor_patterns.write'),
  ('supervisor', 'folders.write'),

  -- ADMIN: everything except credentials/audit/users/roles/destructive
  ('admin', 'clients.read'), ('admin', 'clients.write'),
  ('admin', 'invoices.read'), ('admin', 'invoices.write'), ('admin', 'invoices.export'),
  ('admin', 'documents.read'), ('admin', 'documents.write'),
  ('admin', 'compliance.read'), ('admin', 'compliance.write'), ('admin', 'compliance.generate'),
  ('admin', 'tasks.read'), ('admin', 'tasks.write'),
  ('admin', 'chart_of_accounts.read'), ('admin', 'chart_of_accounts.write'),
  ('admin', 'vendor_patterns.read'), ('admin', 'vendor_patterns.write'),
  ('admin', 'folders.write'),

  -- STAFF: same as admin baseline
  ('staff', 'clients.read'), ('staff', 'clients.write'),
  ('staff', 'invoices.read'), ('staff', 'invoices.write'), ('staff', 'invoices.export'),
  ('staff', 'documents.read'), ('staff', 'documents.write'),
  ('staff', 'compliance.read'), ('staff', 'compliance.write'), ('staff', 'compliance.generate'),
  ('staff', 'tasks.read'), ('staff', 'tasks.write'),
  ('staff', 'chart_of_accounts.read'), ('staff', 'chart_of_accounts.write'),
  ('staff', 'vendor_patterns.read'), ('staff', 'vendor_patterns.write'),
  ('staff', 'folders.write'),

  -- CLIENT: limited (most access still gated by user_clients link via existing RLS)
  ('client', 'invoices.read'), ('client', 'invoices.write'),
  ('client', 'documents.read'), ('client', 'documents.write')
on conflict (role, permission) do nothing;

-- -------------------------------------------------------------
-- 3. RLS on the new tables
-- -------------------------------------------------------------
alter table public.role_permission_defaults enable row level security;
alter table public.user_permissions         enable row level security;

drop policy if exists "role_perm_defaults read"  on public.role_permission_defaults;
create policy "role_perm_defaults read" on public.role_permission_defaults
  for select using (auth.uid() is not null);
-- No writes (defaults are fixed at migration time)

drop policy if exists "user_permissions read own"   on public.user_permissions;
drop policy if exists "user_permissions read admin" on public.user_permissions;
create policy "user_permissions read own" on public.user_permissions
  for select using (user_id = auth.uid());
create policy "user_permissions read admin" on public.user_permissions
  for select using (
    -- Anyone with roles.write can manage permissions, so they can read them too.
    -- We can't call has_permission yet (it's defined below), so inline the check.
    exists (
      select 1 from public.role_permission_defaults d
       where d.permission = 'roles.write'
         and d.role = (select role from public.profiles where id = auth.uid() and active)
    )
  );
-- No direct writes — only via set_user_permission().

-- -------------------------------------------------------------
-- 4. has_permission(p_perm) — the core check
-- -------------------------------------------------------------
create or replace function public.has_permission(p_perm text) returns boolean
language plpgsql security definer set search_path = '' stable as $$
declare
  v_role     text;
  v_default  boolean;
  v_override boolean;
begin
  if auth.uid() is null then return false; end if;

  select role into v_role from public.profiles
   where id = auth.uid() and active = true;
  if v_role is null then return false; end if;

  v_default := exists (
    select 1 from public.role_permission_defaults
     where role = v_role and permission = p_perm
  );

  select granted into v_override from public.user_permissions
   where user_id = auth.uid() and permission = p_perm;

  return coalesce(v_override, v_default);
end $$;
revoke execute on function public.has_permission(text) from public, anon;
grant   execute on function public.has_permission(text) to authenticated;

-- -------------------------------------------------------------
-- 5. get_my_permissions() — bulk read for the UI
-- -------------------------------------------------------------
create or replace function public.get_my_permissions() returns text[]
language plpgsql security definer set search_path = '' stable as $$
declare
  v_role text;
begin
  if auth.uid() is null then return array[]::text[]; end if;
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role is null then return array[]::text[]; end if;

  return (
    select coalesce(array_agg(distinct permission order by permission), array[]::text[])
    from (
      select permission from public.role_permission_defaults where role = v_role
      union
      select permission from public.user_permissions
       where user_id = auth.uid() and granted = true
    ) all_grants
    where permission not in (
      select permission from public.user_permissions
       where user_id = auth.uid() and granted = false
    )
  );
end $$;
revoke execute on function public.get_my_permissions() from public, anon;
grant   execute on function public.get_my_permissions() to authenticated;

-- -------------------------------------------------------------
-- 6. get_user_permissions(uid) — admin-side full matrix view
-- -------------------------------------------------------------
create or replace function public.get_user_permissions(p_user_id uuid)
returns table (permission text, granted_by_default boolean, override boolean)
language plpgsql security definer set search_path = '' stable as $$
declare
  v_role text;
begin
  if not public.has_permission('roles.write') then
    raise exception 'roles.write permission required';
  end if;

  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then raise exception 'user not found or has no role'; end if;

  return query
  select
    p.permission,
    exists(
      select 1 from public.role_permission_defaults
       where role = v_role and permission = p.permission
    ) as granted_by_default,
    (select up.granted from public.user_permissions up
      where up.user_id = p_user_id and up.permission = p.permission) as override
  from (
    select distinct permission from public.role_permission_defaults
  ) p
  order by p.permission;
end $$;
revoke execute on function public.get_user_permissions(uuid) from public, anon;
grant   execute on function public.get_user_permissions(uuid) to authenticated;

-- -------------------------------------------------------------
-- 7. set_user_permission(uid, perm, granted) — null = remove override
-- -------------------------------------------------------------
create or replace function public.set_user_permission(p_user_id uuid, p_permission text, p_granted boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('roles.write') then
    raise exception 'roles.write permission required';
  end if;

  if p_granted is null then
    delete from public.user_permissions
     where user_id = p_user_id and permission = p_permission;
  else
    insert into public.user_permissions (user_id, permission, granted, set_by)
    values (p_user_id, p_permission, p_granted, auth.uid())
    on conflict (user_id, permission) do update
      set granted = excluded.granted, set_by = excluded.set_by, set_at = now();
  end if;
end $$;
revoke execute on function public.set_user_permission(uuid, text, boolean) from public, anon;
grant   execute on function public.set_user_permission(uuid, text, boolean) to authenticated;

-- -------------------------------------------------------------
-- 8. PHASE 1 WIRING — switch high-impact gates to has_permission
-- -------------------------------------------------------------

-- platform_credentials: split into separate read + write policies
drop policy if exists "platform_creds supervisor+ write" on public.platform_credentials;
drop policy if exists "platform_creds read"              on public.platform_credentials;
drop policy if exists "platform_creds write"             on public.platform_credentials;

create policy "platform_creds read" on public.platform_credentials
  for select using (public.has_permission('credentials.read'));

create policy "platform_creds write" on public.platform_credentials
  for all using (public.has_permission('credentials.write'))
  with check (public.has_permission('credentials.write'));

-- audit_log: read gated on audit.read
drop policy if exists "audit_log read supervisor+" on public.audit_log;
create policy "audit_log read" on public.audit_log
  for select using (public.has_permission('audit.read'));

-- Credential reveal/set: gated on the new permissions
create or replace function public.get_credential_password(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pwd         text;
  v_client_id   bigint;
  v_actor_email text;
begin
  if not public.has_permission('credentials.reveal') then
    raise exception 'credentials.reveal permission required';
  end if;

  select extensions.pgp_sym_decrypt(password_enc, public._platform_creds_key()), client_id
    into v_pwd, v_client_id
  from public.platform_credentials
  where id = p_id;

  select email into v_actor_email from auth.users where id = auth.uid();
  begin
    insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
    values (auth.uid(), v_actor_email,
            'platform_credentials.reveal',
            'platform_credentials',
            p_id::text,
            jsonb_build_object('client_id', v_client_id));
  exception when others then
    raise warning 'audit_log insert failed: %', sqlerrm;
  end;

  return v_pwd;
end $$;

create or replace function public.set_credential_password(p_id bigint, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('credentials.write') then
    raise exception 'credentials.write permission required';
  end if;
  if p_password is null or p_password = '' then
    update public.platform_credentials set password_enc = null where id = p_id;
  else
    update public.platform_credentials
       set password_enc = extensions.pgp_sym_encrypt(p_password, public._platform_creds_key())
     where id = p_id;
  end if;
end $$;

-- Soft-delete + restore for clients and documents
create or replace function public.soft_delete_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('clients.delete') then
    raise exception 'clients.delete permission required';
  end if;
  update public.clients set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('clients.restore') then
    raise exception 'clients.restore permission required';
  end if;
  update public.clients set deleted_at = null where id = p_id;
end $$;

create or replace function public.soft_delete_document(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('documents.delete') then
    raise exception 'documents.delete permission required';
  end if;
  update public.documents set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_document(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('documents.delete') then
    raise exception 'documents.delete permission required';
  end if;
  update public.documents set deleted_at = null where id = p_id;
end $$;

create or replace function public.list_deleted_clients()
returns setof public.clients
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.has_permission('clients.restore') then
    raise exception 'clients.restore permission required';
  end if;
  return query
    select * from public.clients
    where deleted_at is not null
    order by deleted_at desc;
end $$;

commit;
-- =============================================================
-- End of migration 016.
--
-- Quick verify in SQL editor:
--   select role, count(*) from role_permission_defaults group by role;
--   -- expect: owner=27, supervisor=25, admin=17, staff=17, client=4
--   select * from get_my_permissions();
--   -- expect a sorted text[] of your effective permissions
-- =============================================================
