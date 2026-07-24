-- =============================================================
-- Migration 140: Editable landing service cards + social links
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Extends the editable landing page (migration 139) so the owner can
-- also edit the "Our Services" cards and the social links, instead of
-- them being hardcoded in the page.
--
--   * landing_services : jsonb array of { "title": "...", "text": "..." }
--   * facebook_url / instagram_url / linkedin_url : text
--
-- get_landing_content() is re-created to surface these too. It stays a
-- SECURITY DEFINER function exposing only safe, public marketing fields.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists landing_services jsonb not null default '[]'::jsonb,
  add column if not exists facebook_url     text,
  add column if not exists instagram_url    text,
  add column if not exists linkedin_url     text;

create or replace function public.get_landing_content()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name',                  cs.name,
    'tagline',               cs.tagline,
    'logo_url',              cs.logo_url,
    'landing_headline',      cs.landing_headline,
    'landing_subtext',       cs.landing_subtext,
    'landing_about',         cs.landing_about,
    'landing_hero_image_url',cs.landing_hero_image_url,
    'landing_services',      cs.landing_services,
    'facebook_url',          cs.facebook_url,
    'instagram_url',         cs.instagram_url,
    'linkedin_url',          cs.linkedin_url,
    'email',                 cs.email,
    'phone',                 cs.phone,
    'website',               cs.website,
    'address_line1',         cs.address_line1,
    'address_line2',         cs.address_line2,
    'city',                  cs.city,
    'postal_code',           cs.postal_code
  )
  from public.company_settings cs
  where cs.id = 1;
$$;

revoke all on function public.get_landing_content() from public;
grant execute on function public.get_landing_content() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 140.
-- =============================================================
