-- =============================================================
-- Migration 089: Terms-of-Service acceptance (go-live)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Records which version of the Terms each user has accepted. The app gates
-- the portal behind acceptance of the CURRENT_TOS_VERSION; bumping that version
-- (e.g. when final legal text replaces the placeholder) re-prompts everyone.
-- =============================================================

begin;

alter table public.profiles
  add column if not exists tos_accepted_version int not null default 0,
  add column if not exists tos_accepted_at      timestamptz;

-- Record acceptance for the logged-in user only.
create or replace function public.accept_tos(p_version int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.profiles
     set tos_accepted_version = p_version, tos_accepted_at = now()
   where id = auth.uid();
end $$;
revoke all on function public.accept_tos(int) from public;
grant   execute on function public.accept_tos(int) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 089.
-- =============================================================
