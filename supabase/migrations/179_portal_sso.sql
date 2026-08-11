-- =============================================================
-- Migration 179: single sign-on from the mobile app into the web portal
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The app hands people across to portal.primeandcalculate.com for the things
-- it does not do. Until now that meant signing in a second time, on a phone
-- keyboard, having already signed in a minute earlier.
--
--   * portal_sso_code — a one-time code, good for ninety seconds, that the
--                       portal trades for a session.
--
-- WHY A CODE AND NOT THE SESSION. The obvious shortcut is to put the access
-- and refresh tokens in the hand-off URL. Those are the keys to the account
-- and they last for days; a URL is copied, logged, put in a Referer header and
-- kept in browser history. So the URL carries something close to worthless
-- instead: an opaque code, single use, expiring in a minute and a half, that
-- buys a session only when posted back over HTTPS. The tokens themselves are
-- never in a URL at all. This is the shape of the OAuth authorization-code
-- flow, for the same reason.
--
-- It rides in the fragment (#sso=…) rather than the query string, so it is not
-- sent to the server, does not reach the host's access logs, and is not
-- included in a Referer header.
--
-- ONLY ONCE, AND ONLY BRIEFLY. The redeem below flips used_at in the same
-- statement that reads the row, so two racing redemptions cannot both win.
-- Only the hash is stored: someone who reads this table learns nothing they
-- could present.
--
-- WHO SEES IT. Nobody. RLS is on with no policies — only the service role,
-- which the two Edge Functions hold and no user does, can touch it.
--
-- MFA still applies. The exchanged session starts at aal1, so a user with an
-- authenticator enrolled is challenged again by the portal. That is correct:
-- clearing a second factor on the phone should not silently clear it on the
-- web.
-- =============================================================

begin;

create extension if not exists pg_cron;

create table if not exists public.portal_sso_code (
  -- SHA-256 of the code, hex. The code itself exists exactly once, in the
  -- response to the app that asked for it.
  code_hash   text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists portal_sso_code_expiry_idx on public.portal_sso_code (expires_at);

alter table public.portal_sso_code enable row level security;
-- Deliberately no policies: service role only.

-- -------------------------------------------------------------
-- Redeem
-- -------------------------------------------------------------
-- Returns the user the code belongs to, or null if it never existed, has
-- already been spent, or has expired. The caller cannot tell those apart, and
-- should not be able to.
create or replace function public.redeem_portal_sso_code(p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  -- Read and spend in one statement: two requests racing with the same code
  -- cannot both come away with a session.
  update public.portal_sso_code
     set used_at = now()
   where code_hash = p_code_hash
     and used_at is null
     and expires_at > now()
  returning user_id into v_user_id;

  return v_user_id;
end $$;
revoke all on function public.redeem_portal_sso_code(text) from public, authenticated, anon;
grant   execute on function public.redeem_portal_sso_code(text) to service_role;

-- -------------------------------------------------------------
-- Tidy up
-- -------------------------------------------------------------
-- Spent and expired codes are of no use to anyone. Keeping them would only
-- build a log of who opened the portal and when.
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'portal-sso-cleanup' loop
    perform cron.unschedule(jid);
  end loop;
end$$;

select cron.schedule('portal-sso-cleanup', '17 3 * * *', $cron$
  delete from public.portal_sso_code where expires_at < now() - interval '1 day';
$cron$);

commit;

-- =============================================================
-- Deploy both functions before anyone uses the hand-off:
--
--   supabase functions deploy sso-mint                    -- verifies the JWT
--   supabase functions deploy sso-exchange --no-verify-jwt -- no JWT to verify
--
-- sso-mint must NOT be --no-verify-jwt: minting a code is exactly the
-- privilege being handed out, so the caller has to prove who they are.
--
-- Verify:
--   select count(*) filter (where used_at is null) as unused,
--          count(*) filter (where used_at is not null) as spent
--     from public.portal_sso_code;
-- =============================================================
