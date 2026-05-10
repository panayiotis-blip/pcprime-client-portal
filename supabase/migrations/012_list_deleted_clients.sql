-- =============================================================
-- Migration 012: list_deleted_clients() helper
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Soft-deleted clients are hidden by RLS for everyone, including
-- admins (so the dashboard doesn't accidentally surface them).
-- This SECURITY DEFINER function gives admins a controlled way to
-- list them so we can restore from the UI.
--
-- Restore itself uses the existing admin UPDATE policy on clients
-- (set deleted_at = null) — no extra DB change needed.
-- =============================================================

begin;

create or replace function public.list_deleted_clients()
returns setof public.clients
language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
    select * from public.clients
    where deleted_at is not null
    order by deleted_at desc;
end $$;

revoke execute on function public.list_deleted_clients() from public, anon;
grant   execute on function public.list_deleted_clients() to authenticated;

commit;
-- =============================================================
-- End of migration 012.
-- =============================================================
