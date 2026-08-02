-- =============================================================
-- Migration 173: preview an app template from the library
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Since migration 172 an app's HTML is only reachable through the variant
-- token of a client's allocation. That is what closed the public read — but it
-- also means a template that is not allocated to anyone cannot be looked at at
-- all, so the firm has to allocate an app to a client just to see what it is.
--
-- Each template now carries its own unguessable preview token, and
-- app_frame_html() answers to it as well: allocation token first (a client's
-- own copy), otherwise a template preview. Same posture as before — the token
-- is the secret, nothing can be enumerated, and what comes back is app UI code
-- with no client data in it. The preview host hands the app an EMPTY document
-- and discards saves, so previewing never touches anyone's records.
-- =============================================================

begin;

alter table public.app_templates
  add column if not exists preview_token text;

update public.app_templates
   set preview_token = replace(gen_random_uuid()::text, '-', '')
 where preview_token is null;

alter table public.app_templates
  alter column preview_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists app_templates_preview_token_idx
  on public.app_templates (preview_token) where preview_token is not null;

comment on column public.app_templates.preview_token is
  'Unguessable token that serves this template through /api/app-frame for preview (migration 173). Readable only by signed-in staff, since app_templates itself is behind RLS.';

-- Allocation first, then a template preview. Unchanged for every existing
-- caller: a variant token still resolves exactly as it did.
create or replace function public.app_frame_html(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(ca.html_override, ca.pinned_html, t.html)
       from public.client_apps ca
       left join public.app_templates t on t.key = ca.app_key and t.active
      where ca.variant_token = p_token and ca.enabled
      limit 1),
    (select t.html from public.app_templates t
      where t.preview_token = p_token and t.active
      limit 1)
  );
$$;

revoke all on function public.app_frame_html(text) from public;
grant execute on function public.app_frame_html(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- Verify:
--   select key, name, (preview_token is not null) as has_preview from public.app_templates;
--   -- a preview token returns the template's html:
--   select length(public.app_frame_html((select preview_token from public.app_templates limit 1)));
--   -- an allocation token still wins for that client:
--   select length(public.app_frame_html((select variant_token from public.client_apps limit 1)));
--   -- and an unknown token is still null:
--   select public.app_frame_html('nope');
-- =============================================================
-- End of migration 173.
-- =============================================================
