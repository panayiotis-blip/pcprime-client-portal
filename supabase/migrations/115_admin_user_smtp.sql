-- =============================================================
-- Migration 115: Admin-managed per-user SMTP credentials
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Migration 096 made user_smtp_settings strictly own-row: RLS limits every
-- read/write to auth.uid(), and set/get_user_smtp_password() only ever touch
-- the caller's own row. That is correct for staff managing their own email,
-- but the firm owner also needs to set up email FOR another staff user from
-- User Management.
--
-- These SECURITY DEFINER functions allow that, gated on the caller holding the
-- users.write permission (the same gate the admin-users Edge Function uses).
-- The own-row RLS on the table is left untouched — elevated access flows only
-- through these permission-checked functions. The plaintext app password is
-- never returned to the browser; admin_get_user_smtp_password() exists solely
-- for the send-via-outlook Edge Function to run a test send on the user's behalf.
-- =============================================================

begin;

-- Guard: raise unless the caller holds users.write. auth.uid() resolves to the
-- calling user even inside SECURITY DEFINER, so has_permission() checks them.
create or replace function public._require_users_write()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  if not public.has_permission('users.write') then
    raise exception 'users.write permission required';
  end if;
end $$;
revoke execute on function public._require_users_write() from public, anon;
grant   execute on function public._require_users_write() to authenticated;

-- Read another user's SMTP settings (non-secret fields + a has_password flag).
create or replace function public.admin_get_user_smtp_settings(p_user_id uuid)
returns table (
  smtp_host      text,
  smtp_port      integer,
  smtp_secure    boolean,
  smtp_user      text,
  from_name      text,
  is_active      boolean,
  has_password   boolean,
  last_used_at   timestamptz,
  last_error     text,
  signature_html text,
  signature_text text,
  updated_at     timestamptz
) language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  return query
    select s.smtp_host, s.smtp_port, s.smtp_secure, s.smtp_user,
           s.from_name, s.is_active, (s.smtp_password_enc is not null),
           s.last_used_at, s.last_error, s.signature_html, s.signature_text, s.updated_at
      from public.user_smtp_settings s
     where s.user_id = p_user_id;
end $$;
revoke execute on function public.admin_get_user_smtp_settings(uuid) from public, anon;
grant   execute on function public.admin_get_user_smtp_settings(uuid) to authenticated;

-- Create/update another user's SMTP settings (excluding the password).
create or replace function public.admin_upsert_user_smtp_settings(
  p_user_id        uuid,
  p_smtp_host      text,
  p_smtp_port      integer,
  p_smtp_secure    boolean,
  p_smtp_user      text,
  p_from_name      text,
  p_is_active      boolean,
  p_signature_html text,
  p_signature_text text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  if p_smtp_user is null or p_smtp_user = '' then
    raise exception 'smtp_user (email address) is required';
  end if;
  insert into public.user_smtp_settings as s
      (user_id, smtp_host, smtp_port, smtp_secure, smtp_user,
       from_name, is_active, signature_html, signature_text)
  values
      (p_user_id,
       coalesce(p_smtp_host, 'smtp.office365.com'),
       coalesce(p_smtp_port, 587),
       coalesce(p_smtp_secure, false),
       p_smtp_user,
       p_from_name,
       coalesce(p_is_active, true),
       p_signature_html,
       p_signature_text)
  on conflict (user_id) do update set
      smtp_host      = excluded.smtp_host,
      smtp_port      = excluded.smtp_port,
      smtp_secure    = excluded.smtp_secure,
      smtp_user      = excluded.smtp_user,
      from_name      = excluded.from_name,
      is_active      = excluded.is_active,
      signature_html = excluded.signature_html,
      signature_text = excluded.signature_text;
end $$;
revoke execute on function public.admin_upsert_user_smtp_settings(uuid, text, integer, boolean, text, text, boolean, text, text) from public, anon;
grant   execute on function public.admin_upsert_user_smtp_settings(uuid, text, integer, boolean, text, text, boolean, text, text) to authenticated;

-- Set/clear another user's encrypted app password (mirrors set_user_smtp_password).
create or replace function public.admin_set_user_smtp_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  if p_password is null or p_password = '' then
    update public.user_smtp_settings set smtp_password_enc = null where user_id = p_user_id;
  else
    update public.user_smtp_settings
       set smtp_password_enc = extensions.pgp_sym_encrypt(p_password, public._user_smtp_key())
     where user_id = p_user_id;
  end if;
end $$;
revoke execute on function public.admin_set_user_smtp_password(uuid, text) from public, anon;
grant   execute on function public.admin_set_user_smtp_password(uuid, text) to authenticated;

-- Decrypt another user's password — server-side use only (send-via-outlook test
-- send on the user's behalf). Never call this from the browser.
create or replace function public.admin_get_user_smtp_password(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  return (
    select extensions.pgp_sym_decrypt(smtp_password_enc, public._user_smtp_key())
      from public.user_smtp_settings where user_id = p_user_id
  );
end $$;
revoke execute on function public.admin_get_user_smtp_password(uuid) from public, anon;
grant   execute on function public.admin_get_user_smtp_password(uuid) to authenticated;

-- Remove another user's SMTP settings entirely.
create or replace function public.admin_delete_user_smtp_settings(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  delete from public.user_smtp_settings where user_id = p_user_id;
end $$;
revoke execute on function public.admin_delete_user_smtp_settings(uuid) from public, anon;
grant   execute on function public.admin_delete_user_smtp_settings(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 115.
-- Verify (as a user holding users.write):
--   select * from public.admin_get_user_smtp_settings('<some-user-uuid>');
-- =============================================================
