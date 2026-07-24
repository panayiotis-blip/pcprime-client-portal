-- =============================================================
-- Migration 139: Editable public landing page content
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The public landing page (/) is served to ANONYMOUS visitors, but
-- company_settings is admin-read only (migration 046). So we:
--
--   1. Add a handful of landing-specific text/image columns to
--      company_settings that the owner can edit under Company Settings.
--   2. Expose a SECURITY DEFINER function get_landing_content() that
--      returns ONLY the safe, meant-to-be-public fields (headline,
--      about text, hero image, public contact details) and GRANT it to
--      anon + authenticated. This keeps sensitive columns (IBAN, bank,
--      tax id, VAT no., service rates, SMTP, etc.) private while still
--      letting the marketing page be edited from the portal.
--
-- The hero image itself lives in the existing public 'company-assets'
-- bucket (migration 046), so no new storage plumbing is needed.
-- =============================================================

begin;

-- ---------- 1. Landing content columns ----------
alter table public.company_settings
  add column if not exists landing_headline        text,
  add column if not exists landing_subtext         text,
  add column if not exists landing_about           text,
  add column if not exists landing_hero_image_url  text;

-- ---------- 2. Public read function ----------
-- Returns a single jsonb object of safe landing fields. NULLs are kept
-- so the client can fall back to sensible built-in defaults.
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

-- Callable by everyone, including unauthenticated visitors.
revoke all on function public.get_landing_content() from public;
grant execute on function public.get_landing_content() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 139.
-- =============================================================
