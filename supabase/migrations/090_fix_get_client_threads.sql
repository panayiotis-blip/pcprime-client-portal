-- =============================================================
-- Migration 090: fix "column reference 'id' is ambiguous" in
-- get_client_threads (introduced in migration 088)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The function returns a table with a column named `id`, and the inner
-- `select role from profiles where id = v_uid` used an UNQUALIFIED `id`,
-- which Postgres treats as ambiguous (could be the OUT param or the column).
-- Fix: qualify the column reference, and add a #variable_conflict directive
-- as a belt-and-braces guard against the same pattern recurring.
-- Same signature as 088, so CREATE OR REPLACE swaps it in place.
-- =============================================================

begin;

create or replace function public.get_client_threads(p_client_id bigint)
returns table (id bigint, subject text, status text, created_at timestamptz,
               last_at timestamptz, last_body text, unread int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_role text; v_staff boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.profiles p where p.id = v_uid;
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

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 090.
-- =============================================================
