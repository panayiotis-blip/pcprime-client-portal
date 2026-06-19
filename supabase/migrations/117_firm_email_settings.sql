-- =============================================================
-- Migration 117: Firm sending identity (info@primeandcalculate.com)
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- A single shared SMTP account the whole firm sends client-facing mail
-- through, so everything goes out as info@ and replies land in the shared
-- Inbox. Mirrors the per-user user_smtp_settings model (migration 096) but as
-- a singleton, reusing the SAME Vault encryption key.
--
-- Two access paths:
--   • Admin RPCs (users.write-gated) — for the Firm Email settings screen.
--   • get_firm_smtp_password_internal() — granted ONLY to service_role, so the
--     send-via-outlook Edge Function can decrypt the firm password server-side
--     to send. It is NOT callable by any browser/end-user, so ordinary staff
--     can send AS the firm without ever being able to read its password.
-- =============================================================

begin;

-- Singleton row (id is always 1).
create table if not exists public.firm_email_settings (
  id                int primary key default 1 check (id = 1),
  smtp_host         text    not null default 'smtp.gmail.com',
  smtp_port         integer not null default 587,
  smtp_secure       boolean not null default false,
  smtp_user         text,                              -- info@primeandcalculate.com
  smtp_password_enc bytea,                             -- pgcrypto-encrypted app password
  from_name         text    default 'PC Prime & Calculate Consultants Ltd',
  is_active         boolean not null default true,
  signature_html    text,
  signature_text    text,
  updated_at        timestamptz not null default now()
);

drop trigger if exists firm_email_settings_updated_at on public.firm_email_settings;
create trigger firm_email_settings_updated_at before update on public.firm_email_settings
  for each row execute function public.tg_set_updated_at();

-- Seed the singleton so upserts always target id=1.
insert into public.firm_email_settings (id) values (1) on conflict (id) do nothing;

-- ---- Admin RPCs (users.write-gated) — for the settings screen ----
create or replace function public.admin_get_firm_email_settings()
returns table (
  smtp_host text, smtp_port integer, smtp_secure boolean, smtp_user text,
  from_name text, is_active boolean, has_password boolean,
  signature_html text, signature_text text, updated_at timestamptz
) language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  return query
    select s.smtp_host, s.smtp_port, s.smtp_secure, s.smtp_user, s.from_name,
           s.is_active, (s.smtp_password_enc is not null),
           s.signature_html, s.signature_text, s.updated_at
      from public.firm_email_settings s where s.id = 1;
end $$;
revoke execute on function public.admin_get_firm_email_settings() from public, anon;
grant   execute on function public.admin_get_firm_email_settings() to authenticated;

create or replace function public.admin_upsert_firm_email_settings(
  p_smtp_host text, p_smtp_port integer, p_smtp_secure boolean, p_smtp_user text,
  p_from_name text, p_is_active boolean, p_signature_html text, p_signature_text text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  update public.firm_email_settings set
    smtp_host = coalesce(p_smtp_host, 'smtp.gmail.com'),
    smtp_port = coalesce(p_smtp_port, 587),
    smtp_secure = coalesce(p_smtp_secure, false),
    smtp_user = p_smtp_user,
    from_name = p_from_name,
    is_active = coalesce(p_is_active, true),
    signature_html = p_signature_html,
    signature_text = p_signature_text
  where id = 1;
end $$;
revoke execute on function public.admin_upsert_firm_email_settings(text, integer, boolean, text, text, boolean, text, text) from public, anon;
grant   execute on function public.admin_upsert_firm_email_settings(text, integer, boolean, text, text, boolean, text, text) to authenticated;

create or replace function public.admin_set_firm_email_password(p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_users_write();
  if p_password is null or p_password = '' then
    update public.firm_email_settings set smtp_password_enc = null where id = 1;
  else
    update public.firm_email_settings
       set smtp_password_enc = extensions.pgp_sym_encrypt(p_password, public._user_smtp_key())
     where id = 1;
  end if;
end $$;
revoke execute on function public.admin_set_firm_email_password(text) from public, anon;
grant   execute on function public.admin_set_firm_email_password(text) to authenticated;

-- ---- Send-path decrypt — service_role ONLY (not callable by any end-user) ----
create or replace function public.get_firm_smtp_password_internal()
returns text language sql security definer set search_path = '' as $$
  select extensions.pgp_sym_decrypt(smtp_password_enc, public._user_smtp_key())
    from public.firm_email_settings where id = 1
$$;
revoke execute on function public.get_firm_smtp_password_internal() from public, anon, authenticated;
grant   execute on function public.get_firm_smtp_password_internal() to service_role;

-- ---- RLS: lock the table; access only via the functions above ----
alter table public.firm_email_settings enable row level security;
-- (No policies → invisible to authenticated/anon. service_role bypasses RLS.)

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify (as a user holding users.write):
--   select * from public.admin_get_firm_email_settings();
-- =============================================================
