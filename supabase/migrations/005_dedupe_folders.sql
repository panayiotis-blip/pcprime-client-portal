-- Fix duplicate system folders: dedupe existing rows, then prevent future dupes.
-- Safe to re-run.

begin;

-- Re-point any documents currently pointing at about-to-be-deleted duplicate folders
-- to the canonical (earliest) folder for the same (client_id, category_key).
with ranked as (
  select id, client_id, category_key,
         row_number() over (partition by client_id, category_key order by id) as rn,
         first_value(id) over (partition by client_id, category_key order by id) as keep_id
  from public.folders
  where is_system = true
)
update public.documents d
set folder_id = r.keep_id
from ranked r
where d.folder_id = r.id
  and r.rn > 1;

-- Re-parent any non-system subfolders that hang off a duplicate system folder
with ranked as (
  select id, client_id, category_key,
         row_number() over (partition by client_id, category_key order by id) as rn,
         first_value(id) over (partition by client_id, category_key order by id) as keep_id
  from public.folders
  where is_system = true
)
update public.folders f
set parent_id = r.keep_id
from ranked r
where f.parent_id = r.id
  and r.rn > 1;

-- Delete the duplicate rows
with ranked as (
  select id,
         row_number() over (partition by client_id, category_key order by id) as rn
  from public.folders
  where is_system = true
)
delete from public.folders
where id in (select id from ranked where rn > 1);

-- Prevent future dupes: one system row per (client_id, category_key)
create unique index if not exists ux_folders_client_category_system
  on public.folders (client_id, category_key)
  where is_system = true;

commit;
