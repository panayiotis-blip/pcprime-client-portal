-- =============================================================
-- Migration 087: Configurable after-hours auto-reply (Item 3b)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The after-hours auto-reply window (days/hours/timezone), the message text,
-- and an on/off switch are now stored on company_settings instead of being
-- hardcoded in send_client_message. Replaces the function from migration 077;
-- existing grants are preserved by CREATE OR REPLACE.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists autoreply_enabled boolean not null default true,
  add column if not exists office_open_hour  int     not null default 8,
  add column if not exists office_close_hour int     not null default 17,
  add column if not exists office_days        int[]  not null default '{1,2,3,4,5}',  -- dow: 0=Sun … 6=Sat
  add column if not exists office_timezone   text    not null default 'Europe/Nicosia',
  add column if not exists autoreply_message text    not null default
    'Thank you for your message. Our office is currently closed — a member of our team will get back to you during working hours.';

create or replace function public.send_client_message(p_client_id bigint, p_body text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_staff boolean;
  v_id    bigint;
  v_dow   int;
  v_hour  int;
  v_cfg   public.company_settings%rowtype;
  v_open  boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Message is empty'; end if;
  select role into v_role from public.profiles where id = v_uid;
  v_staff := v_role in ('owner', 'supervisor', 'admin', 'staff');
  if not v_staff and not exists (
    select 1 from public.user_clients where user_id = v_uid and client_id = p_client_id
  ) then
    raise exception 'Not allowed to message this client';
  end if;

  insert into public.client_messages
    (client_id, author_id, author_is_staff, body, read_by_staff, read_by_client)
  values
    (p_client_id, v_uid, v_staff, btrim(p_body), v_staff, not v_staff)
  returning id into v_id;

  -- After-hours auto-reply (client senders only).
  if not v_staff then
    select * into v_cfg from public.company_settings where id = 1;

    if coalesce(v_cfg.autoreply_enabled, true) then
      v_dow  := extract(dow  from (now() at time zone coalesce(v_cfg.office_timezone, 'Europe/Nicosia')));
      v_hour := extract(hour from (now() at time zone coalesce(v_cfg.office_timezone, 'Europe/Nicosia')));
      -- "Open" = today is a configured working day AND the hour is within the window.
      v_open := (v_dow = ANY (coalesce(v_cfg.office_days, '{1,2,3,4,5}')))
                and v_hour >= coalesce(v_cfg.office_open_hour, 8)
                and v_hour <  coalesce(v_cfg.office_close_hour, 17);

      if not v_open
         and not exists (
           select 1 from public.client_messages
            where client_id = p_client_id
              and author_id is null
              and created_at > now() - interval '12 hours'
         )
      then
        insert into public.client_messages
          (client_id, author_id, author_is_staff, body, read_by_staff, read_by_client)
        values
          (p_client_id, null, true,
           coalesce(nullif(btrim(v_cfg.autoreply_message), ''),
                    'Thank you for your message. Our office is currently closed — a member of our team will get back to you during working hours.'),
           true, false);
      end if;
    end if;
  end if;

  return v_id;
end $$;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 087.
-- =============================================================
