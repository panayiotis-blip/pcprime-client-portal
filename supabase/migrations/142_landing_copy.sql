-- =============================================================
-- Migration 142: Full landing-page copy + heading alignment
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Makes ALL remaining landing text editable without touching code, and
-- adds a heading-alignment control. Rather than a column per text bit,
-- the long tail of copy lives in one jsonb blob (landing_copy), keyed by
-- the names in src/components/Public/landingDefaults.ts (DEFAULT_COPY):
--   heading_align, nav_*, cta_*, about_heading, services_heading,
--   promo_heading/text/button, footer_*_heading, hours_line1/2.
--
-- get_landing_content() is re-created to surface landing_copy too.
-- =============================================================

begin;

alter table public.company_settings
  add column if not exists landing_copy jsonb not null default '{}'::jsonb;

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
    'landing_copy',          cs.landing_copy,
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
-- End of migration 142.
-- =============================================================
