-- =====================================================================
-- 214: correcting 212 and 213
--
-- 212 added 'app_user' to the reporting access set on the assumption
-- that those five accounts were staff. They are not. The portal's own
-- definition, in src/services/api.ts, is:
--
--     isStaffRole = owner | supervisor | admin | staff
--
-- and ClientEntry.tsx says of app_user: "never touch the portal shell --
-- they get the app full-screen". It is a client-side mini-app login.
-- ReportingApp.tsx refuses anyone who fails isStaffRole before a single
-- query is made, so widening the database achieved nothing except to
-- disagree with the front end -- which is worse than either answer on
-- its own.
--
-- The rule is now the same in both places. If a person needs the
-- reporting app, they are given a staff role on the users screen; that
-- is a decision about the person, made once, in the place the portal
-- already keeps it -- not a widening of what "staff" means.
-- =====================================================================

set search_path to reporting, public;

create or replace function is_reporting_staff() returns boolean
language sql stable security definer set search_path = reporting, public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.active
       and p.role in ('owner', 'supervisor', 'admin', 'staff')
  );
$$;

comment on function is_reporting_staff() is
  'The same four roles as isStaffRole() in src/services/api.ts. Keep the two in step.';

create or replace function staff_can_access(cid bigint) returns boolean
language sql stable security definer set search_path = reporting, public as $$
  select is_reporting_staff();
$$;

comment on function staff_can_access(bigint) is
  'Staff-only phase: any staff account may work on any client; client and app_user accounts are excluded. P6 adds the per-client term for the client-facing view: is_reporting_staff() or public.user_can_access_client(cid).';

drop policy if exists templates_scoped on templates;
create policy templates_scoped on templates
  for all
  using (client_id is null and is_reporting_staff() or client_id is not null and staff_can_access(client_id))
  with check (client_id is null and is_reporting_staff() or client_id is not null and staff_can_access(client_id));

drop policy if exists report_lines_scoped on report_lines;
create policy report_lines_scoped on report_lines
  for all
  using (is_reporting_staff() and exists (
    select 1 from templates t
     where t.id = report_lines.template_id
       and (t.client_id is null or staff_can_access(t.client_id))))
  with check (is_reporting_staff() and exists (
    select 1 from templates t
     where t.id = report_lines.template_id
       and (t.client_id is null or staff_can_access(t.client_id))));

drop policy if exists mapping_master_read on mapping_master;
create policy mapping_master_read on mapping_master
  for select using (is_reporting_staff());

drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log
  for select
  using (client_id is null and is_reporting_staff() or client_id is not null and staff_can_access(client_id));
