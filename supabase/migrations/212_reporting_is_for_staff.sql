-- =====================================================================
-- 212: widen the reporting app beyond admins  [SUPERSEDED BY 214]
--
-- Kept so the repo and the database tell the same story. This migration
-- added 'app_user' to the reporting access set on the assumption that
-- those accounts were staff. They are not -- see 214, which puts the
-- rule back in step with isStaffRole() in src/services/api.ts.
-- =====================================================================

set search_path to reporting, public;

create or replace function staff_can_access(cid bigint) returns boolean
language sql stable security definer set search_path = reporting, public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.active
       and p.role in ('owner', 'supervisor', 'admin', 'staff', 'app_user')
  );
$$;
