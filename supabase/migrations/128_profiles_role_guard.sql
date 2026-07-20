-- =============================================================
-- Migration 128: block privilege escalation via profiles.role
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- SECURITY FIX (critical). The "profiles admin all" RLS policy (001:122) gates
-- writes on is_admin(), which is true for the lowest 'staff' tier as well as
-- admin/supervisor/owner. That let ANY staff/admin account update its own
-- profiles.role to 'owner' with the ordinary anon key — a full authorization
-- bypass. This adds a BEFORE UPDATE guard so that:
--   • only a supervisor/owner may change a profile's role OR active flag, and
--   • nobody may change their OWN role (no self-promotion), even a supervisor.
-- Direct server-side changes (SQL Editor / service role, where auth.uid() is
-- null) are still allowed, so the bootstrap and manual fixes keep working.
-- =============================================================

begin;

create or replace function public.guard_profile_privileged_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role) or (new.active is distinct from old.active) then
    -- Only owner/supervisor may change role/active (auth.uid() is null for
    -- trusted service-role / SQL-editor operations — those are allowed).
    if auth.uid() is not null and not coalesce(public.is_supervisor_or_higher(), false) then
      raise exception 'Only a supervisor or owner may change a user''s role or active status.'
        using errcode = '42501';
    end if;
    -- No self-promotion: a user (even a supervisor) cannot change their own role.
    if auth.uid() is not null and new.id = auth.uid() and (new.role is distinct from old.role) then
      raise exception 'You cannot change your own role.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_guard_profile_privileged on public.profiles;
create trigger tg_guard_profile_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_changes();

commit;

-- Verify (as a NON-supervisor staff user in the app, this must now fail):
--   update public.profiles set role = 'owner' where id = auth.uid();
--   -- expected: ERROR "Only a supervisor or owner may change a user's role..."
