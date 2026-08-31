-- =====================================================================
-- Migration 209: the trial balance rows say what is actually held
--
-- The third time in this build, and the second in two days:
--
--   194  covers_to for the ledger, written from the file rather than
--        from the postings
--   208  last_file for the ledger, naming the last file uploaded rather
--        than the one that made the ledger current
--   209  both, for the trial balance
--
-- The Data import screen read:
--
--   Trial balance, monthly | a&f tb 01 2026.xls | Covers to Jan 26
--
-- What is actually held is a JULY 2026 monthly trial balance. January was
-- loaded after July, so the row took January's name and January's date,
-- and the screen understated coverage by six months on the very screen
-- used to decide what to load next.
--
-- Worse, January is not held at all -- see below.
--
-- The application now derives this row (writeTrialBalanceFeedStatus):
-- the latest period held of each kind, and the file that supplied it.
-- This corrects the rows already written the old way.
--
-- ---------------------------------------------------------------------
-- The data loss this uncovered
-- ---------------------------------------------------------------------
-- imports_checksum_idx is unique on (client_id, feed, checksum) WHERE
-- status = 'committed'. commitTrialBalanceImport used to:
--
--   1. insert the import as 'staged'      (index does not apply)
--   2. DELETE the period's existing rows  (to make way)
--   3. insert the new rows
--   4. flip status to 'committed'         (index applies -- can fail)
--   5. on failure, delete the new rows and mark the import rejected
--
-- Re-importing a file that was already committed fails at 4 and takes
-- both copies with it: the old rows went at 2 and the new ones at 5.
-- A&F's January 2026 trial balance was destroyed exactly this way --
-- imports 19 and 21, both 'a&f tb 01 2026.xls', both rejected on
-- imports_checksum_idx at 17:50 on 30 August. Import 11 still stands
-- 'committed' with eighty rows that no longer exist.
--
-- The order is now: write, commit, and only then remove the previous
-- copy -- so every step that can fail happens while the old balances are
-- still there. A duplicate checksum is settled before anything is
-- written. Nothing here can restore January; the file has to be loaded
-- again, and now it can be.
-- =====================================================================

set search_path to reporting, public;

-- The latest period held of each kind, and the import behind it.
with latest as (
  select distinct on (t.client_id, t.is_annual)
         t.client_id, t.is_annual, t.period_month, t.import_id
    from trial_balance t
   order by t.client_id, t.is_annual, t.period_month desc
)
update feed_status f
   set last_import = i.id,
       last_file   = i.original_filename,
       uploaded_at = coalesce(i.committed_at, i.uploaded_at),
       uploaded_by = i.uploaded_by,
       covers_to   = l.period_month
  from latest l
  join imports i on i.id = l.import_id
 where f.client_id = l.client_id
   and f.feed = case when l.is_annual then 'trial_balance_annual'::feed_kind
                     else 'trial_balance_monthly'::feed_kind end;

-- A feed row claiming a trial balance that is not held claims a fact
-- nobody can point at. January's row was one; it goes rather than lies.
delete from feed_status f
 where f.feed in ('trial_balance_monthly', 'trial_balance_annual')
   and not exists (
     select 1 from trial_balance t
      where t.client_id = f.client_id
        and t.is_annual = (f.feed = 'trial_balance_annual')
   );

-- Import 11 is recorded as committed and its balances are gone. Left
-- alone it blocks its own file from ever being loaded again, because
-- the checksum index counts it. Withdrawn, not rejected: it was a good
-- import once, and losing its rows is not the same as being refused.
update imports i
   set status = 'withdrawn',
       notes  = 'Withdrawn by migration 209: recorded as committed but its balances were no longer held.'
 where i.feed = 'trial_balance'
   and i.status = 'committed'
   and not exists (select 1 from trial_balance t where t.import_id = i.id);
