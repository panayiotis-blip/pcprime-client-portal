-- =============================================================
-- Migration 096: Per-user Outlook SMTP credentials
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Each staff user can connect their own Outlook (Microsoft 365 or
-- outlook.com) account to send emails from the app via SMTP. The
-- app password is encrypted at rest using a Supabase Vault-stored
-- key, mirroring the pattern from migration 011 (platform_credentials).
--
-- The plaintext password is never returned via a normal table read —
-- only the SECURITY DEFINER get_user_smtp_password() function can
-- decrypt it, and that function is restricted to the calling user's
-- own row via auth.uid(). The intended caller is the Edge Function
-- that sends mail; it runs as the user so the decryption only ever
-- works for that user's own credentials.
-- =============================================================

begin;

create extension if not exists pgcrypto;

-- 1. Vault-stored encryption key (random 256-bit, base64-encoded).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'user_smtp_enc_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'user_smtp_enc_key',
      'Encryption key for user_smtp_settings.smtp_password_enc — DO NOT DELETE'
    );
  end if;
end $$;

-- 2. Private helper to fetch the key from Vault. Not granted to anon /
-- authenticated — only the SECURITY DEFINER functions below can call it.
create or replace function public._user_smtp_key()
returns text language sql security definer set search_path = '' stable as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'user_smtp_enc_key' limit 1
$$;
revoke execute on function public._user_smtp_key() from public, anon, authenticated;

-- 3. Per-user settings table.
create table if not exists public.user_smtp_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  smtp_host         text    not null default 'smtp.office365.com',
  smtp_port         integer not null default 587,
  smtp_secure       boolean not null default false,  -- STARTTLS on 587; true for SSL on 465
  smtp_user         text    not null,                -- Outlook email used as both From and SMTP login
  smtp_password_enc bytea,                            -- pgcrypto-encrypted app password (never plaintext)
  from_name         text,                             -- optional display name shown on outgoing messages
  is_active         boolean not null default true,
  last_used_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists user_smtp_settings_updated_at on public.user_smtp_settings;
create trigger user_smtp_settings_updated_at before update on public.user_smtp_settings
  for each row execute function public.tg_set_updated_at();

-- 4. SECURITY DEFINER functions for password set / get.
-- The caller can only act on their own row (auth.uid() match).
create or replace function public.set_user_smtp_password(p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  if p_password is null or p_password = '' then
    update public.user_smtp_settings set smtp_password_enc = null where user_id = auth.uid();
  else
    update public.user_smtp_settings
       set smtp_password_enc = extensions.pgp_sym_encrypt(p_password, public._user_smtp_key())
     where user_id = auth.uid();
  end if;
end $$;
revoke execute on function public.set_user_smtp_password(text) from public, anon;
grant   execute on function public.set_user_smtp_password(text) to authenticated;

-- Returns plaintext password for the calling user only. Intended for the
-- send-mail Edge Function. Regular table reads still see only the ciphertext.
create or replace function public.get_user_smtp_password()
returns text language sql security definer set search_path = '' as $$
  select extensions.pgp_sym_decrypt(smtp_password_enc, public._user_smtp_key())
    from public.user_smtp_settings where user_id = auth.uid()
$$;
revoke execute on function public.get_user_smtp_password() from public, anon;
grant   execute on function public.get_user_smtp_password() to authenticated;

-- 5. RLS — each user reads / writes only their own row.
alter table public.user_smtp_settings enable row level security;
drop policy if exists "user_smtp own select" on public.user_smtp_settings;
drop policy if exists "user_smtp own insert" on public.user_smtp_settings;
drop policy if exists "user_smtp own update" on public.user_smtp_settings;
drop policy if exists "user_smtp own delete" on public.user_smtp_settings;
create policy "user_smtp own select" on public.user_smtp_settings
  for select using (user_id = auth.uid());
create policy "user_smtp own insert" on public.user_smtp_settings
  for insert with check (user_id = auth.uid());
create policy "user_smtp own update" on public.user_smtp_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_smtp own delete" on public.user_smtp_settings
  for delete using (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 096.
-- =============================================================
