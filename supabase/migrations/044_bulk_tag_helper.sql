-- 044_bulk_tag_helper.sql
-- One small RPC for bulk-adding a tag to a list of clients. The unique-array
-- merge logic is awkward to do client-side; doing it server-side in one call
-- is cleaner and atomic.

begin;

create or replace function public.bulk_add_tag_to_clients(p_ids bigint[], p_tag text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_role       text;
  v_tag        text;
  v_count      int := 0;
begin
  perform public.require_aal2();
  select role into v_role from public.profiles where id = v_user_id;
  if coalesce(v_role, '') not in ('owner', 'supervisor', 'admin', 'staff') then
    raise exception 'Staff only';
  end if;

  v_tag := nullif(trim(coalesce(p_tag, '')), '');
  if v_tag is null then return 0; end if;

  with u as (
    update public.clients
    set tags = (
      select array_agg(distinct elem)
      from unnest(coalesce(tags, '{}'::text[]) || array[v_tag]) elem
    )
    where id = any(p_ids)
      and not (coalesce(tags, '{}'::text[]) @> array[v_tag])
    returning 1
  )
  select count(*) into v_count from u;

  select email into v_user_email from auth.users where id = v_user_id;
  insert into public.audit_log (actor_id, actor_email, action, target_type, target_id, summary)
  values (v_user_id, v_user_email, 'clients.bulk_add_tag', 'clients', null,
          jsonb_build_object('tag', v_tag, 'updated', v_count, 'requested', array_length(p_ids, 1)));

  return v_count;
end $$;

revoke all on function public.bulk_add_tag_to_clients(bigint[], text) from public;
grant   execute on function public.bulk_add_tag_to_clients(bigint[], text) to authenticated;

commit;
