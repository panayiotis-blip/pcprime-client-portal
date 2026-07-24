-- =============================================================
-- Migration 141: Dedicated landing-page logo + About-section photo
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The firm uses different logos for different materials: the app/login
-- logo, the letterhead (print) logo, and the public website logo are
-- not necessarily the same file. This adds a landing-page-specific logo
-- so it can be set independently of company_settings.logo_url (print).
-- Falls back to the bundled /logo.png in the app when unset.
--
-- Also adds a second landing photo: landing_about_image_url, shown to the
-- right of the "About our company" text as a framed block.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists landing_logo_url        text,
  add column if not exists landing_about_image_url text;

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
    'landing_logo_url',      cs.landing_logo_url,
    'landing_headline',      cs.landing_headline,
    'landing_subtext',       cs.landing_subtext,
    'landing_about',         cs.landing_about,
    'landing_hero_image_url',cs.landing_hero_image_url,
    'landing_about_image_url',cs.landing_about_image_url,
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
-- End of migration 141.
-- =============================================================
