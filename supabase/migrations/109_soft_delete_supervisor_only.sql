-- Migration 109: lock task soft-delete + restore behind supervisor role
-- =======================================================================
-- Anyone with staff role could previously set staff_tasks.deleted_at via
-- the existing "staff_tasks write" RLS policy. This adds two SECURITY
-- DEFINER RPCs that wrap the soft-delete and restore actions with an
-- explicit is_supervisor_or_higher() check. The UI calls these instead
-- of issuing a raw UPDATE, so even if a non-supervisor crafted a request
-- the DB will reject it.

create or replace function public.soft_delete_staff_task(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'not authorized: only supervisors can delete tasks';
  end if;
  update public.staff_tasks
    set deleted_at = now()
    where id = p_id and deleted_at is null;
end$$;

revoke all on function public.soft_delete_staff_task(bigint) from public;
grant execute on function public.soft_delete_staff_task(bigint) to authenticated;

create or replace function public.restore_staff_task(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_supervisor_or_higher() then
    raise exception 'not authorized: only supervisors can restore tasks';
  end if;
  update public.staff_tasks
    set deleted_at = null
    where id = p_id;
end$$;

revoke all on function public.restore_staff_task(bigint) from public;
grant execute on function public.restore_staff_task(bigint) to authenticated;
