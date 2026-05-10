-- =============================================================
-- Migration 014: Role tiers (Owner > Supervisor > rest of staff)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Today is_admin() returns true for owner/supervisor/admin/staff.
-- That's still the "any internal-firm user" gate and stays unchanged.
--
-- This migration adds two stricter gates and applies them to the
-- highest-impact operations:
--
--   is_supervisor_or_higher()  → owner + supervisor only
--   is_owner()                 → owner only
--
-- Owner-only enforcement for the admin-users edge function happens
-- in code (separate file edit). This migration handles the DB side.
--
-- Wrapped in a transaction; rolls back atomically on failure.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. New helper functions
-- -------------------------------------------------------------
create or replace function public.is_supervisor_or_higher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('owner', 'supervisor')
      and active = true
  );
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'owner'
      and active = true
  );
$$;

-- -------------------------------------------------------------
-- 2. Platform credentials — read + write tightened to supervisor+
-- -------------------------------------------------------------
drop policy if exists "platform_creds read only"  on public.platform_credentials;
drop policy if exists "platform_creds admin"      on public.platform_credentials;
drop policy if exists "platform_creds admin write" on public.platform_credentials;

create policy "platform_creds supervisor+ write" on public.platform_credentials
  for all using (public.is_supervisor_or_higher())
  with check (public.is_supervisor_or_higher());

-- -------------------------------------------------------------
-- 3. Audit log — read tightened to supervisor+
-- -------------------------------------------------------------
drop policy if exists "audit_log read admin" on public.audit_log;
create policy "audit_log read supervisor+" on public.audit_log
  for select using (public.is_supervisor_or_higher());

-- -------------------------------------------------------------
-- 4. Credential set/get RPCs — gate on supervisor+
-- -------------------------------------------------------------
create or replace function public.set_credential_password(p_id bigint, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
  end if;
  if p_password is null or p_password = '' then
    update public.platform_credentials set password_enc = null where id = p_id;
  else
    update public.platform_credentials
       set password_enc = extensions.pgp_sym_encrypt(p_password, public._platform_creds_key())
     where id = p_id;
  end if;
end $$;

create or replace function public.get_credential_password(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pwd         text;
  v_client_id   bigint;
  v_actor_email text;
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
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

-- -------------------------------------------------------------
-- 5. Soft-delete + restore RPCs — gate on supervisor+
-- -------------------------------------------------------------
create or replace function public.soft_delete_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
  end if;
  update public.clients set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
  end if;
  update public.clients set deleted_at = null where id = p_id;
end $$;

create or replace function public.soft_delete_document(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
  end if;
  update public.documents set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_document(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
  end if;
  update public.documents set deleted_at = null where id = p_id;
end $$;

-- -------------------------------------------------------------
-- 6. list_deleted_clients — gate on supervisor+
-- -------------------------------------------------------------
create or replace function public.list_deleted_clients()
returns setof public.clients
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'supervisor or owner only';
  end if;
  return query
    select * from public.clients
    where deleted_at is not null
    order by deleted_at desc;
end $$;

commit;
-- =============================================================
-- End of migration 014.
-- =============================================================
