-- =====================================================================
-- Migration 196: the chart of accounts is a feed like any other
--
-- feed_kind (191, what feed_status uses) has always had
-- 'chart_of_accounts'. feed_type (190, what imports and period_status
-- use) does not, so a chart could be parsed but not recorded as an
-- import -- no file name, no checksum, no who and when, and no evidence
-- copy tied to a row. Everything this platform loads is recorded the
-- same way or the audit trail has a hole in exactly the shape of the
-- file that defines every account.
--
-- Nothing here uses the new value. ALTER TYPE ... ADD VALUE cannot be
-- used in the same transaction that adds it, so the code that writes an
-- import of this feed is necessarily a later statement, in a later
-- transaction. That is why this migration does one thing.
-- =====================================================================

alter type reporting.feed_type add value if not exists 'chart_of_accounts';
