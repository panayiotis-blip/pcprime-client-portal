-- =============================================================
-- Migration 017: Fix ambiguous "permission" reference in
-- get_user_permissions().
-- =============================================================
-- The function's RETURNS TABLE declares an output column named
-- `permission`, which conflicts with the unqualified `permission`
-- references inside subqueries (the table also has that column).
-- Qualifying every reference with a table alias removes the
-- ambiguity.
-- =============================================================

begin;

create or replace function public.get_user_permissions(p_user_id uuid)
returns table (permission text, granted_by_default boolean, override boolean)
language plpgsql security definer set search_path = '' stable as $$
declare
  v_role text;
begin
  if not public.has_permission('roles.write') then
    raise exception 'roles.write permission required';
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = p_user_id;
  if v_role is null then raise exception 'user not found or has no role'; end if;

  return query
  select
    p.perm,
    exists(
      select 1 from public.role_permission_defaults d
       where d.role = v_role and d.permission = p.perm
    ) as granted_by_default,
    (select up.granted from public.user_permissions up
      where up.user_id = p_user_id and up.permission = p.perm) as override
  from (
    select distinct rpd.permission as perm from public.role_permission_defaults rpd
  ) p
  order by p.perm;
end $$;

commit;
