-- =============================================================
-- Migration 131: Timesheet edit/delete rules — own-draft + owner-only-post-review
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Tightens the UPDATE/DELETE gate on public.time_entries that migration 047
-- introduced. Old behaviour: ANY internal-firm user could correct/delete ANY
-- draft row, and once approved the approver OR an owner could change it.
--
-- New behaviour (per firm policy):
--   1. Corrections & deletions of a DRAFT entry are limited to the staff
--      member who ENTERED it (their own row). Colleagues can no longer touch
--      each other's drafts.
--   2. Once an entry has been REVIEWED (approval_status = 'approved') it is
--      locked: only the OWNER may edit or delete it. Supervisors — even the
--      one who approved it — cannot delete an approved entry. They keep
--      approve/unlock via the security-definer RPCs (unchanged); unlocking an
--      entry returns it to 'draft', after which its author (or the owner) can
--      correct it again.
--
-- The owner retains a full override at every stage (edit/delete anything).
--
-- INSERT is unchanged (any internal-firm user logs their own time). The
-- approve_time_entries / unlock_time_entries RPCs from migration 047 are
-- unchanged and still owner+supervisor only.
-- =============================================================

begin;

-- Replace only the UPDATE and DELETE policies; leave "time_entries insert"
-- and "time_entries read" (from migrations 045/047) in place.
drop policy if exists "time_entries update" on public.time_entries;
drop policy if exists "time_entries delete" on public.time_entries;

-- UPDATE (corrections): own draft row, or owner override.
create policy "time_entries update" on public.time_entries
  for update using (
    public.is_admin() and (
      (approval_status = 'draft' and user_id = auth.uid())
      or public.is_owner()
    )
  )
  with check (
    public.is_admin() and (
      (approval_status = 'draft' and user_id = auth.uid())
      or public.is_owner()
    )
  );

-- DELETE: own draft row, or owner override. After review (approved) this
-- resolves to owner-only — supervisors cannot delete approved entries.
create policy "time_entries delete" on public.time_entries
  for delete using (
    public.is_admin() and (
      (approval_status = 'draft' and user_id = auth.uid())
      or public.is_owner()
    )
  );

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 131.
-- =============================================================
