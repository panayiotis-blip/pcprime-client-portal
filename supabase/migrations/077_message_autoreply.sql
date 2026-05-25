-- =============================================================
-- Migration 077: After-hours auto-reply on client messages
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Replaces send_client_message (migration 076): when a CLIENT sends a
-- message outside Cyprus working hours (Mon–Fri 08:00–17:00 Europe/Nicosia),
-- the firm auto-acknowledges. At most one auto-reply per 12h so repeated
-- night messages aren't spammed. Existing grants are preserved by REPLACE.
-- =============================================================

begin;

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
    v_dow  := extract(dow  from (now() at time zone 'Europe/Nicosia'));
    v_hour := extract(hour from (now() at time zone 'Europe/Nicosia'));
    if (v_dow = 0 or v_dow = 6 or v_hour < 8 or v_hour >= 17)
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
         'Thank you for your message. Our office is currently closed — a member of our team will get back to you during working hours (Mon–Fri, 08:00–17:00).',
         true, false);
    end if;
  end if;

  return v_id;
end $$;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 077.
-- =============================================================
