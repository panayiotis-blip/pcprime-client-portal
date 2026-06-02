-- =============================================================
-- Migration 092: Add/delete folder templates (v2 of master folder names)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Extends migration 091 with the ability to add new folder templates
-- (auto-seeded for every existing client) and delete them (only when
-- safe — no documents filed inside and no document_category points to
-- them). Rename-only feature from 091 is unchanged.
-- =============================================================

begin;

-- Add a new folder template + seed it on every existing client in one go.
-- Returns the new template id.
create or replace function public.add_folder_template(
  p_name        text,
  p_parent_key  text,    -- null for top-level; otherwise an existing top-level category_key
  p_sort_order  int
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_key text;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role in ('owner', 'supervisor')
       and active
  ) then raise exception 'Owner or supervisor only'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name is empty'; end if;

  -- Parent (if specified) must be an existing TOP-LEVEL template. No nesting deeper than 2.
  if p_parent_key is not null then
    if not exists (
      select 1 from public.folder_template
       where category_key = p_parent_key
         and parent_key is null
    ) then raise exception 'Parent folder must be an existing top-level folder'; end if;
  end if;

  -- Reserve the row with a temp unique key, then promote to 'custom_<id>'.
  insert into public.folder_template (category_key, name, parent_key, sort_order)
  values (gen_random_uuid()::text, btrim(p_name), p_parent_key, coalesce(p_sort_order, 999))
  returning id into v_id;
  v_key := 'custom_' || v_id;
  update public.folder_template set category_key = v_key where id = v_id;

  -- Seed the new folder on every non-deleted client.
  insert into public.folders (client_id, parent_id, name, category_key, is_system)
  select c.id,
         pf.id,                  -- null if p_parent_key is null
         btrim(p_name),
         v_key,
         true
    from public.clients c
    left join public.folders pf
      on pf.client_id = c.id
     and pf.category_key = p_parent_key
     and pf.is_system = true
   where coalesce(c.deleted_at::text, '') = '';   -- defensive: works even if deleted_at is not present per row

  return v_id;
end $$;
revoke all on function public.add_folder_template(text, text, int) from public;
grant   execute on function public.add_folder_template(text, text, int) to authenticated;

-- Delete a template (and the corresponding folder on every client).
-- Blocks if any document is filed in the folder on any client, OR if a
-- document_category points at this folder.
create or replace function public.delete_folder_template(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text; v_doc_count int;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role in ('owner', 'supervisor')
       and active
  ) then raise exception 'Owner or supervisor only'; end if;

  select category_key into v_key from public.folder_template where id = p_id;
  if v_key is null then raise exception 'Folder template not found'; end if;

  -- If a Document Category points at this folder, force the user to fix that first.
  if exists (
    select 1 from public.document_categories where target_folder = v_key
  ) then
    raise exception 'A Document Category targets this folder — re-target or remove that category first.';
  end if;

  -- Block deletion if any document is filed inside this folder on ANY client.
  select count(*) into v_doc_count
    from public.documents d
    join public.folders f on f.id = d.folder_id
   where f.category_key = v_key;
  if v_doc_count > 0 then
    raise exception 'Cannot delete: % document(s) are filed in this folder. Move or delete them first.', v_doc_count;
  end if;

  -- Also block if a sub-folder template depends on this top-level (parent_key references).
  if exists (
    select 1 from public.folder_template where parent_key = v_key
  ) then
    raise exception 'Other folder templates use this as their parent — delete those first.';
  end if;

  -- Safe. Delete the (empty) folder rows on every client, then the template.
  delete from public.folders where category_key = v_key and is_system = true;
  delete from public.folder_template where id = p_id;
end $$;
revoke all on function public.delete_folder_template(bigint) from public;
grant   execute on function public.delete_folder_template(bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 092.
-- =============================================================
