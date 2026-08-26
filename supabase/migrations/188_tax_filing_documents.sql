-- =============================================================
-- Migration 188: the filed return and the assessment, attached to the year
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- WHY. Most returns before 2023 were filed long ago and are being recorded
-- after the fact — dates, references, amounts. The paperwork exists as PDFs
-- that had nowhere to live next to the year they belong to, so "was this filed,
-- and where is the proof" needed two places to check.
--
-- Each filing row gets two slots: the RETURN as filed, and the ASSESSMENT when
-- it comes back. Two named slots rather than a free list, so a glance down the
-- years shows which are missing which — the thing that actually matters while
-- back-filling.
--
-- NOT A NEW FILE STORE. Both point at rows in `documents`, so an attached PDF
-- is an ordinary client document: it appears in the Documents tab, obeys the
-- same access rules, and is already covered by the nightly Storage backup to
-- the NAS. Uploading here writes one documents row (bucket `documents`,
-- category `tax`) and links it.
--
-- ON DELETE SET NULL, not CASCADE: deleting the PDF must never take the filing
-- record with it. Losing the note that a 2019 return was filed on a given date
-- because someone tidied up a document would be far worse than a dangling slot.
-- =============================================================

begin;

alter table public.client_tax_filings
  add column if not exists return_document_id     bigint references public.documents(id) on delete set null,
  add column if not exists assessment_document_id bigint references public.documents(id) on delete set null;

-- "Which years still have no return attached" is the query this feature exists
-- to answer, and it runs down one client's filings.
create index if not exists idx_tax_filings_return_doc
  on public.client_tax_filings(client_id) where return_document_id is null;

commit;

-- =============================================================
-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'client_tax_filings' and column_name like '%document_id';
-- =============================================================
-- End of migration 188.
-- =============================================================
