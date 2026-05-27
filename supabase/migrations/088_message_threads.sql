-- =============================================================
-- Migration 088: Message topics / threads (Item 3b)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Adds a topic layer to client↔firm messaging: each client can have several
-- named conversations. Existing flat messages are backfilled into one
-- "General" topic per client. Replaces send_client_message (now thread-scoped,
-- keeps the configurable after-hours auto-reply from migration 087).
-- =============================================================

begin;

-- ---------- 1. message_thread ----------
create table if not exists public.message_thread (
  id          bigserial primary key,
  client_id   bigint not null references public.clients(id) on delete cascade,
  subject     text not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists message_thread_client_idx on public.message_thread (client_id, created_at desc);

alter table public.message_thread enable row level security;
drop policy if exists "message_thread read" on public.message_thread;
create policy "message_thread read" on public.message_thread
  for select to authenticated using (public.user_can_access_client(client_id));
-- writes go through the RPCs below only

-- ---------- 2. thread_id on client_messages + backfill ----------
alter table public.client_messages
  add column if not exists thread_id bigint references public.message_thread(id) on delete cascade;

do $$
declare r record; v_tid bigint;
begin
  for r in select distinct client_id from public.client_messages where thread_id is null loop
    insert into public.message_thread (client_id, subject) values (r.client_id, 'General')
      returning id into v_tid;
    update public.client_messages set thread_id = v_tid
      where client_id = r.client_id and thread_id is null;
  end loop;
end $$;

alter table public.client_messages alter column thread_id set not null;
create index if not exists client_messages_thread_idx on public.client_messages (thread_id, created_at);

-- ---------- 3. create a topic ----------
create or replace function public.create_message_thread(p_client_id bigint, p_subject text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_staff boolean; v_id bigint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_subject is null or btrim(p_subject) = '' then raise exception 'Subject is empty'; end if;
  select role into v_role from public.profiles where id = v_uid;
  v_staff := v_role in ('owner', 'supervisor', 'admin', 'staff');
  if not v_staff and not exists (
    select 1 from public.user_clients where user_id = v_uid and client_id = p_client_id
  ) then raise exception 'Not allowed'; end if;
  insert into public.message_thread (client_id, subject, created_by)
    values (p_client_id, btrim(p_subject), v_uid) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_message_thread(bigint, text) from public;
grant   execute on function public.create_message_thread(bigint, text) to authenticated;

-- ---------- 4. send a message (now thread-scoped) ----------
-- The first arg is now the THREAD id. The previous version named it
-- p_client_id, and Postgres won't rename an input parameter via REPLACE, so we
-- drop it first (grants are re-applied below).
drop function if exists public.send_client_message(bigint, text);
create or replace function public.send_client_message(p_thread_id bigint, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_role text; v_staff boolean; v_id bigint;
  v_client_id bigint; v_dow int; v_hour int; v_cfg public.company_settings%rowtype; v_open boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Message is empty'; end if;
  select client_id into v_client_id from public.message_thread where id = p_thread_id;
  if v_client_id is null then raise exception 'Thread not found'; end if;
  select role into v_role from public.profiles where id = v_uid;
  v_staff := v_role in ('owner', 'supervisor', 'admin', 'staff');
  if not v_staff and not exists (
    select 1 from public.user_clients where user_id = v_uid and client_id = v_client_id
  ) then raise exception 'Not allowed to message this client'; end if;

  insert into public.client_messages
    (client_id, thread_id, author_id, author_is_staff, body, read_by_staff, read_by_client)
  values
    (v_client_id, p_thread_id, v_uid, v_staff, btrim(p_body), v_staff, not v_staff)
  returning id into v_id;

  -- After-hours auto-reply into the same thread (client senders only).
  if not v_staff then
    select * into v_cfg from public.company_settings where id = 1;
    if coalesce(v_cfg.autoreply_enabled, true) then
      v_dow  := extract(dow  from (now() at time zone coalesce(v_cfg.office_timezone, 'Europe/Nicosia')));
      v_hour := extract(hour from (now() at time zone coalesce(v_cfg.office_timezone, 'Europe/Nicosia')));
      v_open := (v_dow = ANY (coalesce(v_cfg.office_days, '{1,2,3,4,5}')))
                and v_hour >= coalesce(v_cfg.office_open_hour, 8)
                and v_hour <  coalesce(v_cfg.office_close_hour, 17);
      if not v_open and not exists (
        select 1 from public.client_messages
         where thread_id = p_thread_id and author_id is null and created_at > now() - interval '12 hours'
      ) then
        insert into public.client_messages
          (client_id, thread_id, author_id, author_is_staff, body, read_by_staff, read_by_client)
        values
          (v_client_id, p_thread_id, null, true,
           coalesce(nullif(btrim(v_cfg.autoreply_message), ''),
                    'Thank you for your message. Our office is currently closed — a member of our team will get back to you during working hours.'),
           true, false);
      end if;
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.send_client_message(bigint, text) from public;
grant   execute on function public.send_client_message(bigint, text) to authenticated;

-- ---------- 5. mark a thread read for the viewer ----------
create or replace function public.mark_thread_read(p_thread_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_staff boolean; v_client_id bigint;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select client_id into v_client_id from public.message_thread where id = p_thread_id;
  if v_client_id is null then return; end if;
  select role into v_role from public.profiles where id = v_uid;
  v_staff := v_role in ('owner', 'supervisor', 'admin', 'staff');
  if not v_staff and not exists (
    select 1 from public.user_clients where user_id = v_uid and client_id = v_client_id
  ) then raise exception 'Not allowed'; end if;
  if v_staff then
    update public.client_messages set read_by_staff = true
     where thread_id = p_thread_id and author_is_staff = false and read_by_staff = false;
  else
    update public.client_messages set read_by_client = true
     where thread_id = p_thread_id and author_is_staff = true and read_by_client = false;
  end if;
end $$;
revoke all on function public.mark_thread_read(bigint) from public;
grant   execute on function public.mark_thread_read(bigint) to authenticated;

-- ---------- 6. topics list for a client (both sides) ----------
create or replace function public.get_client_threads(p_client_id bigint)
returns table (id bigint, subject text, status text, created_at timestamptz,
               last_at timestamptz, last_body text, unread int)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_staff boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_uid;
  v_staff := v_role in ('owner', 'supervisor', 'admin', 'staff');
  if not v_staff and not exists (
    select 1 from public.user_clients where user_id = v_uid and client_id = p_client_id
  ) then raise exception 'Not allowed'; end if;
  return query
    select t.id, t.subject, t.status, t.created_at,
           coalesce(max(m.created_at), t.created_at) as last_at,
           (array_agg(m.body order by m.created_at desc) filter (where m.body is not null))[1] as last_body,
           count(*) filter (
             where (v_staff     and not m.author_is_staff and not m.read_by_staff)
                or (not v_staff and     m.author_is_staff and not m.read_by_client)
           )::int as unread
      from public.message_thread t
      left join public.client_messages m on m.thread_id = t.id
     where t.client_id = p_client_id
     group by t.id, t.subject, t.status, t.created_at
     order by coalesce(max(m.created_at), t.created_at) desc;
end $$;
revoke all on function public.get_client_threads(bigint) from public;
grant   execute on function public.get_client_threads(bigint) to authenticated;

-- ---------- 7. open / close a topic (staff) ----------
create or replace function public.set_thread_status(p_thread_id bigint, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid()
                    and role in ('owner', 'supervisor', 'admin', 'staff') and active) then
    raise exception 'Staff only';
  end if;
  if p_status not in ('open', 'closed') then raise exception 'Invalid status'; end if;
  update public.message_thread set status = p_status where id = p_thread_id;
end $$;
revoke all on function public.set_thread_status(bigint, text) from public;
grant   execute on function public.set_thread_status(bigint, text) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 088.
-- =============================================================
