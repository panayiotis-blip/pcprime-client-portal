-- =============================================================
-- Migration 011: Encrypt platform_credentials passwords at rest
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds AES (pgp_sym) encryption to platform_credentials.password.
-- Encryption key lives in supabase_vault and is randomly generated
-- the first time this migration runs (no key value appears in this
-- file or in git).
--
-- After this migration:
--   - Plaintext column dropped.
--   - New bytea column password_enc holds the ciphertext.
--   - Reads/writes go through SECURITY DEFINER functions:
--       set_credential_password(id, plaintext)
--       get_credential_password(id)  -- audit-logged on every call
--   - Both functions are admin-only.
--   - Admin write policy on platform_credentials is restored, so the
--     UI can manage rows again.
--
-- Wrapped in a transaction; rolls back atomically on failure.
-- Safe to re-run.
-- =============================================================

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- 1. Vault-stored encryption key (random 256-bit, base64-encoded).
-- Generated only on the first run; never in the migration file.
-- -------------------------------------------------------------
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'platform_credentials_enc_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'platform_credentials_enc_key',
      'Encryption key for platform_credentials.password_enc — DO NOT DELETE'
    );
  end if;
end $$;

-- -------------------------------------------------------------
-- 2. Private helper to fetch the key from vault.
-- Not granted to authenticated/anon — only the SECURITY DEFINER
-- functions below can call it (they run as the function owner).
-- -------------------------------------------------------------
create or replace function public._platform_creds_key()
returns text language sql security definer set search_path = '' stable as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'platform_credentials_enc_key' limit 1
$$;
revoke execute on function public._platform_creds_key() from public, anon, authenticated;

-- -------------------------------------------------------------
-- 3. Add the ciphertext column + migrate existing plaintext rows.
-- The IF EXISTS guard makes the migration idempotent.
-- -------------------------------------------------------------
alter table public.platform_credentials add column if not exists password_enc bytea;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_credentials' and column_name = 'password'
  ) then
    update public.platform_credentials
       set password_enc = extensions.pgp_sym_encrypt(password, public._platform_creds_key())
     where password_enc is null
       and password is not null
       and password <> '';

    alter table public.platform_credentials drop column password;
  end if;
end $$;

-- -------------------------------------------------------------
-- 4. SECURITY DEFINER functions for password set / get.
-- -------------------------------------------------------------
create or replace function public.set_credential_password(p_id bigint, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_password is null or p_password = '' then
    update public.platform_credentials set password_enc = null where id = p_id;
  else
    update public.platform_credentials
       set password_enc = extensions.pgp_sym_encrypt(p_password, public._platform_creds_key())
     where id = p_id;
  end if;
end $$;
grant execute on function public.set_credential_password(bigint, text) to authenticated;

create or replace function public.get_credential_password(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pwd         text;
  v_client_id   bigint;
  v_actor_email text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select extensions.pgp_sym_decrypt(password_enc, public._platform_creds_key()), client_id
    into v_pwd, v_client_id
  from public.platform_credentials
  where id = p_id;

  -- Record every reveal in the audit log.
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
grant execute on function public.get_credential_password(bigint) to authenticated;

-- -------------------------------------------------------------
-- 5. Restore admin write policy on the table itself so the UI
-- can insert/update/delete metadata rows. The set/get functions
-- above are the only path for password ciphertext.
-- -------------------------------------------------------------
drop policy if exists "platform_creds read only"  on public.platform_credentials;
drop policy if exists "platform_creds admin"      on public.platform_credentials;
drop policy if exists "platform_creds admin write" on public.platform_credentials;

create policy "platform_creds admin write" on public.platform_credentials
  for all using (public.is_admin()) with check (public.is_admin());

commit;
-- =============================================================
-- End of migration 011.
--
-- Verify in the SQL editor:
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'platform_credentials';
--   -- expect: id, client_id, platform, username, notes, password_enc
--   -- (no 'password' column)
--
--   select count(*) as enc_rows from public.platform_credentials
--    where password_enc is not null;
-- =============================================================
