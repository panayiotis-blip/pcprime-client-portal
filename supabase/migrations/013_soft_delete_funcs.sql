-- =============================================================
-- Migration 013: SECURITY DEFINER soft-delete + restore helpers
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The .update({ deleted_at: now() }) path was hitting an RLS edge
-- case where the post-update row state appears to fail one of the
-- permissive UPDATE policies' WITH CHECK clause (the linked-user
-- policy requires deleted_at IS NULL after the update). Routing
-- soft-delete and restore through admin-only SECURITY DEFINER
-- functions removes the ambiguity entirely.
--
-- Same pattern used elsewhere (set_credential_password,
-- list_deleted_clients).
-- =============================================================

begin;

-- ---------- clients ----------
create or replace function public.soft_delete_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.clients set deleted_at = now() where id = p_id;
end $$;
revoke execute on function public.soft_delete_client(bigint) from public, anon;
grant   execute on function public.soft_delete_client(bigint) to authenticated;

create or replace function public.restore_client(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.clients set deleted_at = null where id = p_id;
end $$;
revoke execute on function public.restore_client(bigint) from public, anon;
grant   execute on function public.restore_client(bigint) to authenticated;

-- ---------- documents ----------
create or replace function public.soft_delete_document(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.documents set deleted_at = now() where id = p_id;
end $$;
revoke execute on function public.soft_delete_document(bigint) from public, anon;
grant   execute on function public.soft_delete_document(bigint) to authenticated;

create or replace function public.restore_document(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.documents set deleted_at = null where id = p_id;
end $$;
revoke execute on function public.restore_document(bigint) from public, anon;
grant   execute on function public.restore_document(bigint) to authenticated;

commit;
-- =============================================================
-- End of migration 013.
-- =============================================================
