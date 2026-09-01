-- =============================================================
-- Migration 176: consultation requests from the mobile app
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The mobile app offers the free 30-minute consultation, but a client had no
-- way to ask for one. Appointments are staff-only by design (migration 020:
-- "Client role users see nothing") and that stays true — a client must not be
-- able to write into the firm's diary, or read anyone else's.
--
-- So a request is its own thing, and it is a request, not a booking:
--
--   * consultation_request — what the client asked for: topic, the day and time
--                            they picked, where they want it. Status moves
--                            pending → confirmed | declined | cancelled as the
--                            firm deals with it.
--
-- WHO SEES WHAT. A client reads and creates requests for a client they are
-- linked to, and nothing else. Only firm staff may change one — a client
-- cannot confirm their own consultation, and cannot edit a request after
-- sending it (cancelling goes through the RPC below so the transition is
-- checked rather than trusted).
--
-- CONFIRMING. When staff confirm a request they create the appointment in the
-- usual way and stamp its id here, so the diary stays the single source of
-- truth for what is actually booked. Nothing is auto-created: an appointment
-- appears only when a person agrees to it.
--
-- Slots. request_slots() returns the firm's standard consultation times for the
-- next fortnight, minus anything already taken in the diary. It is a
-- SECURITY DEFINER read over appointments precisely so a client can be told
-- "10:00 is gone" without being able to see whose appointment took it.
-- =============================================================

begin;

create table if not exists public.consultation_request (
  id            bigserial primary key,
  client_id     bigint not null references public.clients(id) on delete cascade,
  requested_by  uuid references auth.users(id) on delete set null,

  topic         text not null,
  starts_at     timestamptz not null,
  duration_min  integer not null default 30 check (duration_min between 15 and 240),
  mode          text not null default 'office' check (mode in ('office', 'video')),
  note          text,

  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  -- Set when staff confirm and the real diary entry exists.
  appointment_id bigint references public.appointments(id) on delete set null,
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decline_reason text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists consultation_request_client_idx
  on public.consultation_request (client_id, created_at desc);
create index if not exists consultation_request_pending_idx
  on public.consultation_request (starts_at) where status = 'pending';

drop trigger if exists consultation_request_updated_at on public.consultation_request;
create trigger consultation_request_updated_at before update on public.consultation_request
  for each row execute function public.tg_set_updated_at();

-- -------------------------------------------------------------
-- RLS — a client reads their own; only staff decide
-- -------------------------------------------------------------
alter table public.consultation_request enable row level security;

drop policy if exists "consultation_request read" on public.consultation_request;
create policy "consultation_request read" on public.consultation_request
  for select using (public.user_can_access_client(client_id));

drop policy if exists "consultation_request staff write" on public.consultation_request;
create policy "consultation_request staff write" on public.consultation_request
  for all using (public.is_admin()) with check (public.is_admin());

-- Clients create through the RPC below, which pins client_id and status.

-- -------------------------------------------------------------
-- Ask for a consultation
-- -------------------------------------------------------------
create or replace function public.request_consultation(
  p_client_id bigint,
  p_topic     text,
  p_starts_at timestamptz,
  p_mode      text default 'office',
  p_note      text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id bigint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_topic is null or btrim(p_topic) = '' then raise exception 'Topic is empty'; end if;
  if p_starts_at is null then raise exception 'No time chosen'; end if;
  if p_starts_at < now() then raise exception 'That time is in the past'; end if;
  if coalesce(p_mode, 'office') not in ('office', 'video') then
    raise exception 'Unknown mode';
  end if;

  -- Staff book through the diary; this path is for the client's own request.
  if not public.user_can_access_client(p_client_id) then
    raise exception 'Not allowed';
  end if;

  -- One live request at a time, so a stuck tap does not queue five of them.
  if exists (
    select 1 from public.consultation_request
     where client_id = p_client_id and status = 'pending'
  ) then
    raise exception 'You already have a consultation request waiting for us';
  end if;

  insert into public.consultation_request (client_id, requested_by, topic, starts_at, mode, note)
    values (p_client_id, v_uid, btrim(p_topic), p_starts_at, coalesce(p_mode, 'office'), p_note)
    returning id into v_id;

  return v_id;
end $$;
revoke all on function public.request_consultation(bigint, text, timestamptz, text, text) from public;
grant   execute on function public.request_consultation(bigint, text, timestamptz, text, text) to authenticated;

-- -------------------------------------------------------------
-- Withdraw one you have not been answered on yet
-- -------------------------------------------------------------
create or replace function public.cancel_consultation_request(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_client bigint; v_status text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select client_id, status into v_client, v_status
    from public.consultation_request where id = p_id;
  if v_client is null then raise exception 'Request not found'; end if;
  if not public.user_can_access_client(v_client) then raise exception 'Not allowed'; end if;
  if v_status <> 'pending' then raise exception 'That request has already been answered'; end if;

  update public.consultation_request
     set status = 'cancelled', decided_at = now(), decided_by = v_uid
   where id = p_id;
end $$;
revoke all on function public.cancel_consultation_request(bigint) from public;
grant   execute on function public.cancel_consultation_request(bigint) to authenticated;

-- -------------------------------------------------------------
-- What is still free
-- -------------------------------------------------------------
-- Weekday slots at the firm's standard consultation times, from tomorrow for
-- p_days ahead, with anything the diary has already taken removed. Times are
-- generated in Cyprus local time so 09:00 means 09:00 in the office.
create or replace function public.consultation_slots(p_days integer default 14)
returns table (starts_at timestamptz)
language sql security definer set search_path = '' stable as $$
  with hours as (
    select unnest(array['09:00', '09:30', '10:00', '11:30', '14:00', '15:30']::time[]) as at
  ),
  days as (
    select generate_series(
      (now() at time zone 'Europe/Nicosia')::date + 1,
      (now() at time zone 'Europe/Nicosia')::date + greatest(least(p_days, 60), 1),
      interval '1 day'
    )::date as on_day
  ),
  candidates as (
    select ((d.on_day + h.at) at time zone 'Europe/Nicosia') as starts_at
      from days d cross join hours h
     -- The office does not take consultations at the weekend.
     where extract(isodow from d.on_day) < 6
  )
  select c.starts_at
    from candidates c
   where not exists (
     select 1 from public.appointments a
      where a.status <> 'cancelled'
        and a.starts_at < c.starts_at + interval '30 minutes'
        and a.ends_at   > c.starts_at
   )
     and not exists (
     select 1 from public.consultation_request r
      where r.status = 'pending' and r.starts_at = c.starts_at
   )
   order by c.starts_at;
$$;
revoke all on function public.consultation_slots(integer) from public;
grant   execute on function public.consultation_slots(integer) to authenticated;

commit;
