-- 025_require_aal2.sql
-- Step-up authentication: high-value operations now require the caller to have
-- verified MFA in their current session (aal2), not just be MFA-enrolled.
--
-- When a user signs in with password only (or skipped MFA via trusted device),
-- their JWT has aal = 'aal1'. After they enter their 6-digit authenticator code,
-- it becomes 'aal2'. We enforce aal2 on the most damaging actions so that a
-- session resumed on a trusted device can still do day-to-day work, but a
-- fresh MFA proof is required to reveal credentials, delete clients, or
-- manage users.

-- Helper: throws if the caller's session isn't MFA-verified. The error message
-- starts with "MFA verification required" so the frontend can render a
-- friendly popup with a "Sign out" prompt.
create or replace function public.require_aal2()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aal text;
begin
  v_aal := coalesce((auth.jwt() ->> 'aal'), 'aal1');
  if v_aal <> 'aal2' then
    raise exception 'MFA verification required. Sign out and sign in again, entering your authenticator code.';
  end if;
end;
$$;

revoke all on function public.require_aal2() from public;
grant   execute on function public.require_aal2() to authenticated;

-- ---------- Re-define sensitive functions with aal2 gate ----------

create or replace function public.get_credential_password(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pwd         text;
  v_client_id   bigint;
  v_actor_email text;
begin
  perform public.require_aal2();
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

create or replace function public.soft_delete_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_aal2();
  if not public.has_permission('clients.delete') then
    raise exception 'clients.delete permission required';
  end if;
  update public.clients set deleted_at = now() where id = p_id;
end $$;

create or replace function public.restore_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_aal2();
  if not public.has_permission('clients.restore') then
    raise exception 'clients.restore permission required';
  end if;
  update public.clients set deleted_at = null where id = p_id;
end $$;

comment on function public.require_aal2() is
  'Throws if the caller has not freshly verified MFA in the current session (aal2). Used to gate high-value operations so a trusted-device session can do regular work but not the most damaging actions without a fresh code.';
