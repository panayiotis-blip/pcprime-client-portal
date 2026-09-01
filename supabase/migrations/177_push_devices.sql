-- =============================================================
-- Migration 177: push notification devices
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Push is the reason the mobile app exists rather than a mobile web page:
-- a deadline reminder, "we have your document", "your accountant replied".
-- Sending one means knowing where to send it, which is what this table is.
--
--   * push_device — one row per install: the Expo push token, which user it
--                   belongs to, and enough about the device to tell two
--                   installs apart in a support conversation.
--
-- WHO SEES WHAT. A row belongs to exactly one user and only that user may read
-- or write it. Nobody enumerates anyone else's devices — not even staff,
-- because a push token is a way to reach a person's phone.
--
-- The send side runs as an Edge Function with the service role, which bypasses
-- RLS; it is the only thing that reads across users. It should delete any token
-- Expo reports as DeviceNotRegistered rather than retrying it forever.
--
-- Tokens move. The same physical device gets a new token after a reinstall, and
-- a token can be reassigned to a different user if two people share a handset,
-- so the token is the primary key and re-registering simply reclaims it.
-- =============================================================

begin;

create table if not exists public.push_device (
  token        text primary key,           -- ExponentPushToken[...]
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  device_name  text,
  app_version  text,
  -- Bumped every time the app registers, so a stale install can be aged out.
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists push_device_user_idx on public.push_device (user_id);

alter table public.push_device enable row level security;

drop policy if exists "push_device own read" on public.push_device;
create policy "push_device own read" on public.push_device
  for select using (user_id = auth.uid());

drop policy if exists "push_device own write" on public.push_device;
create policy "push_device own write" on public.push_device
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -------------------------------------------------------------
-- Register this install
-- -------------------------------------------------------------
-- Upsert on the token: if it already belongs to someone else — a shared
-- handset, or a reinstall — it moves to the caller rather than erroring, so
-- the previous owner stops receiving notifications meant for the new one.
create or replace function public.register_push_device(
  p_token       text,
  p_platform    text,
  p_device_name text default null,
  p_app_version text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_token is null or btrim(p_token) = '' then raise exception 'No push token'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'Unknown platform'; end if;

  insert into public.push_device (token, user_id, platform, device_name, app_version)
    values (btrim(p_token), v_uid, p_platform, p_device_name, p_app_version)
  on conflict (token) do update
    set user_id      = excluded.user_id,
        platform     = excluded.platform,
        device_name  = excluded.device_name,
        app_version  = excluded.app_version,
        last_seen_at = now();
end $$;
revoke all on function public.register_push_device(text, text, text, text) from public;
grant   execute on function public.register_push_device(text, text, text, text) to authenticated;

-- -------------------------------------------------------------
-- Forget it on sign-out
-- -------------------------------------------------------------
-- Signing out should stop the notifications. Scoped to the caller so one user
-- cannot unregister another's device.
create or replace function public.unregister_push_device(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  delete from public.push_device where token = btrim(p_token) and user_id = v_uid;
end $$;
revoke all on function public.unregister_push_device(text) from public;
grant   execute on function public.unregister_push_device(text) to authenticated;

commit;
