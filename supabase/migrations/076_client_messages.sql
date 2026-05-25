-- =============================================================
-- Migration 076: Client ↔ firm messaging
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- One ongoing conversation per client. Clients message the firm and see
-- replies; staff reply from an inbox. SELECT is scoped by
-- user_can_access_client (staff see all, a client sees only their own
-- thread). All writes go through security-definer RPCs.
-- =============================================================

begin;

create table if not exists public.client_messages (
  id              bigserial primary key,
  client_id       bigint not null references public.clients(id) on delete cascade,
  author_id       uuid references auth.users(id) on delete set null,
  author_is_staff boolean not null,
  body            text not null,
  read_by_client  boolean not null default false,
  read_by_staff   boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists client_messages_client_idx on public.client_messages (client_id, created_at);

alter table public.client_messages enable row level security;
drop policy if exists "client_messages read" on public.client_messages;
create policy "client_messages read" on public.client_messages
  for select to authenticated
  using (public.user_can_access_client(client_id));
-- No insert/update policies — all writes go through the RPCs below.

-- ---------- send a message ----------
create or replace function public.send_client_message(p_client_id bigint, p_body text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_staff boolean;
  v_id    bigint;
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
  return v_id;
end $$;
revoke all on function public.send_client_message(bigint, text) from public;
grant   execute on function public.send_client_message(bigint, text) to authenticated;

-- ---------- mark the other side's messages read for the viewer ----------
create or replace function public.mark_messages_read(p_client_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_staff boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles where id = v_uid;
  v_staff := v_role in ('owner', 'supervisor', 'admin', 'staff');
  if not v_staff and not exists (
    select 1 from public.user_clients where user_id = v_uid and client_id = p_client_id
  ) then
    raise exception 'Not allowed';
  end if;
  if v_staff then
    update public.client_messages set read_by_staff = true
     where client_id = p_client_id and author_is_staff = false and read_by_staff = false;
  else
    update public.client_messages set read_by_client = true
     where client_id = p_client_id and author_is_staff = true and read_by_client = false;
  end if;
end $$;
revoke all on function public.mark_messages_read(bigint) from public;
grant   execute on function public.mark_messages_read(bigint) to authenticated;

-- ---------- staff inbox: one row per client with a thread ----------
create or replace function public.get_message_inbox()
returns table (client_id bigint, client_name text, client_code text,
               last_at timestamptz, last_body text, unread int)
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid()
                    and role in ('owner', 'supervisor', 'admin', 'staff') and active) then
    raise exception 'Staff only';
  end if;
  return query
    select cm.client_id, c.name, c.client_code,
           max(cm.created_at) as last_at,
           (array_agg(cm.body order by cm.created_at desc))[1] as last_body,
           count(*) filter (where not cm.author_is_staff and not cm.read_by_staff)::int as unread
      from public.client_messages cm
      join public.clients c on c.id = cm.client_id
     group by cm.client_id, c.name, c.client_code
     order by max(cm.created_at) desc;
end $$;
revoke all on function public.get_message_inbox() from public;
grant   execute on function public.get_message_inbox() to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 076.
-- =============================================================
