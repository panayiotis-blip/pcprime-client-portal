-- =============================================================
-- Migration 015: Trusted devices (skip MFA on this device for X days)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Lets a user mark their browser as "trusted" after a successful
-- MFA challenge. Future logins from that device skip the MFA prompt
-- (password is still required) and the inactivity timeout extends.
--
-- Storage:
--   trusted_devices.token_hash = SHA-256 hex of the cleartext token.
--   The cleartext token is returned ONCE to the browser (stored in
--   localStorage). DB never holds the cleartext.
--
-- Functions are SECURITY DEFINER so RLS doesn't apply to the inserts/
-- deletes; admin checks live inside the functions.
--
-- Wrapped in a transaction; rolls back on failure. Safe to re-run.
-- =============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token_hash    text not null,
  device_label  text,
  user_agent    text,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create        index if not exists trusted_devices_user_idx       on public.trusted_devices(user_id);
create unique index if not exists trusted_devices_token_hash_idx on public.trusted_devices(token_hash);

alter table public.trusted_devices enable row level security;

drop policy if exists "trusted_devices read own"        on public.trusted_devices;
drop policy if exists "trusted_devices read supervisor" on public.trusted_devices;

create policy "trusted_devices read own" on public.trusted_devices
  for select using (user_id = auth.uid());

create policy "trusted_devices read supervisor" on public.trusted_devices
  for select using (public.is_supervisor_or_higher());

-- No INSERT/UPDATE/DELETE policies → only SECURITY DEFINER functions write.

-- Audit trigger so device additions/revocations show up in audit_log.
drop trigger if exists tg_audit_trusted_devices on public.trusted_devices;
create trigger tg_audit_trusted_devices
  after insert or update or delete on public.trusted_devices
  for each row execute function public.tg_audit();

-- -------------------------------------------------------------
-- trust_this_device — generate a new token, store its hash,
-- return the cleartext token for the browser.
-- -------------------------------------------------------------
create or replace function public.trust_this_device(p_label text, p_user_agent text, p_days int default 30)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_hash  text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then p_days := 30; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'base64');
  v_hash  := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.trusted_devices (user_id, token_hash, device_label, user_agent, expires_at)
  values (auth.uid(), v_hash, p_label, p_user_agent, now() + (p_days || ' days')::interval);

  return v_token;
end $$;
revoke execute on function public.trust_this_device(text, text, int) from public, anon;
grant   execute on function public.trust_this_device(text, text, int) to authenticated;

-- -------------------------------------------------------------
-- verify_trusted_device — true if the token belongs to the calling
-- user and hasn't expired. Bumps last_used_at.
-- -------------------------------------------------------------
create or replace function public.verify_trusted_device(p_token text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_id   uuid;
begin
  if auth.uid() is null or p_token is null or p_token = '' then return false; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.trusted_devices
     set last_used_at = now()
   where user_id    = auth.uid()
     and token_hash = v_hash
     and expires_at > now()
  returning id into v_id;

  return v_id is not null;
end $$;
revoke execute on function public.verify_trusted_device(text) from public, anon;
grant   execute on function public.verify_trusted_device(text) to authenticated;

-- -------------------------------------------------------------
-- revoke_trusted_device — owner of the device OR supervisor+.
-- -------------------------------------------------------------
create or replace function public.revoke_trusted_device(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.trusted_devices
   where id = p_id
     and (user_id = auth.uid() or public.is_supervisor_or_higher());
end $$;
revoke execute on function public.revoke_trusted_device(uuid) from public, anon;
grant   execute on function public.revoke_trusted_device(uuid) to authenticated;

-- -------------------------------------------------------------
-- cleanup_expired_trusted_devices — admin maintenance helper.
-- -------------------------------------------------------------
create or replace function public.cleanup_expired_trusted_devices()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if not public.is_supervisor_or_higher() then raise exception 'supervisor or owner only'; end if;
  with deleted as (
    delete from public.trusted_devices where expires_at <= now() returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end $$;
revoke execute on function public.cleanup_expired_trusted_devices() from public, anon;
grant   execute on function public.cleanup_expired_trusted_devices() to authenticated;

commit;
-- =============================================================
-- End of migration 015.
-- =============================================================
