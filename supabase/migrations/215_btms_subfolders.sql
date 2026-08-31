-- =====================================================================
-- Migration 215: a subfolder per report inside the client's BTMS data
--
-- The partner's own words:
--
--   "All I wanted extra, so as to avoid confusion, was to save the client
--    CSV file for the data in the client's folder on the portal. In that
--    BTMS folder I wanted subfolders for journal listings, for ledgers,
--    for TB and whatever other reports like payroll. It would be easier
--    to ID the reports if I selected the type of report and the period I
--    was saving -- easier for the app to upload from."
--
-- Migration 204 made the BTMS data folder. This puts ten subfolders under
-- it, one per kind of report, so a person opening the Documents tab finds
-- the journal listings together and the trial balances together rather
-- than one flat list of exports named by checksum.
--
-- public.folders already carries parent_id, is_system and category_key,
-- so there is nothing new to build: this is folders inside folders, made
-- on demand by the same function that makes the parent.
--
-- Every subfolder's category_key begins 'btms', which is what the portal
-- keys the document-type list off: inside these folders the types offered
-- are the BTMS feeds, and everywhere else in the portal the general list
-- is unchanged.
--
-- documents.period_end is the one column added, and it exists for exactly
-- one feed. A stock valuation is a count taken on a day; that date is
-- nowhere in the BTMS export and nobody can recover it afterwards, so it
-- is asked for at upload and kept with the file. year and month already
-- carry every other period.
-- =====================================================================

set search_path to public;

alter table documents
  add column if not exists period_end date;

comment on column documents.period_end is
  'The exact date a document is at, where a year and a month cannot say it. Used by the stock valuation, which is a count taken on a day that no BTMS export contains.';

-- ---------------------------------------------------------------------
-- The subfolders, in the order a person reads them.
-- ---------------------------------------------------------------------
create or replace function btms_subfolders()
returns table (category_key text, name text, sort_order int)
language sql immutable as $$
  select * from (values
    ('btms_ledger',  'Journal listings', 1),
    ('btms_detail',  'Ledgers',          2),
    ('btms_tb',      'Trial balances',   3),
    ('btms_coa',     'Chart of accounts',4),
    ('btms_vat',     'VAT',              5),
    ('btms_payroll', 'Payroll',          6),
    ('btms_stock',   'Stock',            7),
    ('btms_sales',   'Sales',            8),
    ('btms_bank',    'Bank',             9),
    ('btms_other',   'Other',           10)
  ) as t(category_key, name, sort_order);
$$;

comment on function btms_subfolders() is
  'The ten kinds of BTMS report a client folder holds, and the folder each one lives in. One list, so the portal and the reporting application cannot disagree about where a file goes.';

grant execute on function btms_subfolders() to authenticated;

-- ---------------------------------------------------------------------
-- The client's BTMS data folder, and everything under it.
--
-- Replaces the body of 204. The parent is still created on demand and
-- still returns the same id; what is new is that the subfolders are
-- ensured at the same time, so a folder cannot exist half-made.
-- ---------------------------------------------------------------------
create or replace function btms_data_folder(p_client bigint)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_id bigint;
  r    record;
begin
  -- The portal's own access model decides whether this client may be
  -- touched at all; this function adds nothing to it and defers entirely.
  if not user_can_access_client(p_client) then
    raise exception 'no access to client %', p_client;
  end if;

  select id into v_id
    from folders
   where client_id = p_client and category_key = 'btms'
   order by id
   limit 1;

  if v_id is null then
    insert into folders (client_id, parent_id, name, category_key, is_system)
    values (p_client, null, 'BTMS data', 'btms', true)
    returning id into v_id;
  end if;

  -- Made if missing, left alone if there. A folder somebody renamed keeps
  -- its name: category_key is what the application reads, and the name is
  -- the person's to change.
  for r in select * from btms_subfolders() loop
    if not exists (
      select 1 from folders
       where client_id = p_client and category_key = r.category_key
    ) then
      insert into folders (client_id, parent_id, name, category_key, is_system)
      values (p_client, v_id, r.name, r.category_key, true);
    end if;
  end loop;

  return v_id;
end $$;

comment on function btms_data_folder(bigint) is
  'The client''s BTMS data folder and its ten subfolders, created the first time they are asked for. Where the BTMS exports live, so that the folder identifies the client and the subfolder identifies the report, and nothing has to be typed into a file name.';

grant execute on function btms_data_folder(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Which subfolder a given report belongs in.
--
-- Asked by the uploader so that the answer is in one place rather than
-- repeated in the portal's Documents tab and again in the reporting
-- application. Returns the parent folder for anything it does not know,
-- which is the honest fallback: the file is kept with the client either
-- way, and 'Other' is a decision somebody made rather than a shrug.
-- ---------------------------------------------------------------------
create or replace function btms_folder_for(p_client bigint, p_kind text)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_parent bigint;
  v_key    text;
  v_id     bigint;
begin
  v_parent := btms_data_folder(p_client);   -- also ensures the subfolders

  v_key := case p_kind
    when 'ledger'         then 'btms_ledger'
    when 'detailed_ledger' then 'btms_detail'
    when 'trial_balance'  then 'btms_tb'
    when 'trial_balance_wide' then 'btms_tb'
    when 'chart'          then 'btms_coa'
    when 'vat_summary'    then 'btms_vat'
    when 'vat_return'     then 'btms_vat'
    when 'payroll_cost'   then 'btms_payroll'
    when 'payroll_sheet'  then 'btms_payroll'
    when 'stock'          then 'btms_stock'
    when 'sales_listing'  then 'btms_sales'
    when 'bank_statement' then 'btms_bank'
    when 'other'          then 'btms_other'
    else null
  end;

  if v_key is null then
    return v_parent;
  end if;

  select id into v_id
    from folders
   where client_id = p_client and category_key = v_key
   order by id
   limit 1;

  return coalesce(v_id, v_parent);
end $$;

comment on function btms_folder_for(bigint, text) is
  'The subfolder a BTMS report of this kind belongs in. One mapping, asked by both ways in, so a file cannot land in one place from the portal and another from the report.';

grant execute on function btms_folder_for(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Backfill: every client that already has a BTMS data folder gets the
-- subfolders now, rather than the next time somebody happens to upload.
-- ---------------------------------------------------------------------
do $$
declare
  c record;
  r record;
begin
  for c in select id, client_id from folders where category_key = 'btms' loop
    for r in select * from btms_subfolders() loop
      if not exists (
        select 1 from folders
         where client_id = c.client_id and category_key = r.category_key
      ) then
        insert into folders (client_id, parent_id, name, category_key, is_system)
        values (c.client_id, c.id, r.name, r.category_key, true);
      end if;
    end loop;
  end loop;
end $$;
