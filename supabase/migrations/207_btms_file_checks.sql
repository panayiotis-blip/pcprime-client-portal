-- =====================================================================
-- Migration 207: what was checked when a file was saved
--
-- Staff save their BTMS exports into the client's folder at the end of a
-- posting session. The reporting application reads them later, on its
-- own, and a file exported the wrong way does not announce itself: it
-- imports quietly and the figures come out wrong. By then the person who
-- exported it has moved on.
--
-- So every file is parsed against the control totals BTMS prints inside
-- it BEFORE it is stored, and the verdict is kept. Two reasons to keep
-- it rather than just act on it:
--
--   1. Reviewing staff work is the point. "Every file for July passed"
--      is a fact somebody can act on; re-opening eleven spreadsheets to
--      find out is not.
--   2. A file that passed in July and is questioned in November can be
--      answered from what was recorded at the time, rather than from
--      re-running today's checks against today's code.
--
-- The facts column holds the file's own figures -- postings, debits,
-- credits, record counts -- because those are what a reviewer compares
-- against, and they cost nothing to keep.
--
-- Superseding: a feed replaces the previous file of the same kind and
-- period rather than sitting beside it. Pete's point -- the journal
-- listing is re-saved every session, and the folder must not grow a copy
-- each time. Evidence (bank statements and the like) is NOT superseded:
-- two statements for the same month are two statements.
-- =====================================================================

set search_path to reporting, public;

create table if not exists btms_file_checks (
  document_id  bigint primary key references public.documents(id) on delete cascade,
  client_id    bigint not null references public.clients(id) on delete cascade,
  kind         text   not null,
  -- 'YYYY-MM', 'YYYY', or a range for a listing spanning months. Text
  -- because a journal listing covers a span and a chart covers none.
  period       text,
  verdict      text   not null check (verdict in ('ok', 'warning', 'blocked')),
  problems     text[] not null default '{}',
  warnings     text[] not null default '{}',
  facts        jsonb  not null default '{}'::jsonb,
  -- sha256 of the content. The same export saved twice is the same file,
  -- whatever it was named the second time.
  digest       text,
  checked_at   timestamptz not null default now(),
  checked_by   uuid default auth.uid()
);

create index if not exists btms_file_checks_client_idx
  on btms_file_checks (client_id, kind, period);
create index if not exists btms_file_checks_digest_idx
  on btms_file_checks (client_id, digest);

comment on table btms_file_checks is
  'What the gate found when a BTMS export was saved into a client folder: the file''s own control figures, and whether it agreed with them. Kept so staff work can be reviewed without re-opening the spreadsheets.';

alter table btms_file_checks enable row level security;

drop policy if exists btms_file_checks_staff on btms_file_checks;
create policy btms_file_checks_staff on btms_file_checks
  for all to authenticated
  using (staff_can_access(client_id))
  with check (staff_can_access(client_id));

-- ---------------------------------------------------------------------
-- What is in a client's folder, period by period, with its verdict.
-- This is the review: one row per file, newest first, and what it proved
-- about itself at the time it was saved.
-- ---------------------------------------------------------------------
create or replace function btms_folder_review(p_client bigint)
returns table (
  document_id bigint,
  file_name   text,
  kind        text,
  period      text,
  verdict     text,
  problems    text[],
  warnings    text[],
  facts       jsonb,
  uploaded_at timestamptz,
  uploaded_by uuid,
  superseded  boolean
)
language sql stable security definer set search_path = reporting, public as $$
  -- staff_can_access is asked once, for the client, rather than once per
  -- document. The fifth time that mattered in this build is documented
  -- in 206; this is the sixth place it would have.
  select d.id,
         d.file_name,
         coalesce(k.kind, 'unknown'),
         k.period,
         coalesce(k.verdict, 'warning'),
         coalesce(k.problems, '{}'),
         coalesce(k.warnings, '{}'),
         coalesce(k.facts, '{}'::jsonb),
         d.created_at,
         d.uploaded_by,
         d.deleted_at is not null
    from public.documents d
    left join btms_file_checks k on k.document_id = d.id
   where d.client_id = p_client
     and d.category = 'btms'
     and staff_can_access(p_client)
   order by d.created_at desc;
$$;

comment on function btms_folder_review(bigint) is
  'One row per file in a client''s BTMS folder with the verdict recorded when it was saved, superseded files included. What a reviewer reads instead of re-opening the spreadsheets.';

revoke all on function btms_folder_review(bigint) from public;
grant execute on function btms_folder_review(bigint) to authenticated;
