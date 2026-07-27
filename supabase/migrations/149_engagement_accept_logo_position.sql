-- =============================================================
-- Migration 149: Engagement accept page honours the logo layout
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The public accept-page PDF ignored the firm's letterhead logo position/
-- height (it defaulted to logo-right) because the token RPC didn't return
-- them. Firm details are served live from company_settings, so we just add
-- the two fields to the RPC output; the page then passes them to the PDF
-- generator, matching the staff preview and every other printed document.
-- =============================================================

begin;

create or replace function public.get_engagement_letter_for_acceptance(p_token text)
returns table (
  -- Letter
  id bigint, version int, status text,
  effective_from date, effective_to date,
  engagement_type text, fee_mode text, annual_estimate numeric,
  services jsonb, currency text,
  hourly_rate_director numeric, hourly_rate_manager numeric, hourly_rate_support numeric,
  discount_percent numeric, min_monthly_fee numeric, annual_review_notice_days int,
  engagement_leader text, cover_letter_text text, intro_text text, terms_text text,
  sent_at timestamptz, accepted_at timestamptz, accepted_signature text,
  -- Client
  client_id bigint, client_name text, client_legal_name text,
  client_address text, client_city text, client_country text,
  client_tax_number text, client_vat_number text, client_registration_number text,
  client_id_number text,
  -- Firm (company_settings)
  firm_name text, firm_legal_name text, firm_registration_number text,
  firm_tax_id text, firm_vat_number text,
  firm_address_line1 text, firm_address_line2 text,
  firm_city text, firm_postal_code text, firm_country text,
  firm_phone text, firm_email text, firm_website text,
  firm_iban text, firm_bank_name text, firm_logo_url text,
  firm_logo_position text, firm_logo_height text
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if p_token is null or p_token = '' then return; end if;
  return query
    select el.id, el.version, el.status,
           el.effective_from, el.effective_to,
           el.engagement_type, el.fee_mode, el.annual_estimate,
           el.services, el.currency,
           el.hourly_rate_director, el.hourly_rate_manager, el.hourly_rate_support,
           el.discount_percent, el.min_monthly_fee, el.annual_review_notice_days,
           el.engagement_leader, el.cover_letter_text, el.intro_text, el.terms_text,
           el.sent_at, el.accepted_at, el.accepted_signature,
           c.id as client_id, c.name as client_name, c.legal_name as client_legal_name,
           c.address as client_address, c.city as client_city, c.country as client_country,
           c.tax_number as client_tax_number, c.vat_number as client_vat_number,
           c.registration_number as client_registration_number, c.id_number as client_id_number,
           cs.name as firm_name, cs.legal_name as firm_legal_name,
           cs.registration_number as firm_registration_number,
           cs.tax_id as firm_tax_id, cs.vat_number as firm_vat_number,
           cs.address_line1 as firm_address_line1, cs.address_line2 as firm_address_line2,
           cs.city as firm_city, cs.postal_code as firm_postal_code, cs.country as firm_country,
           cs.phone as firm_phone, cs.email as firm_email, cs.website as firm_website,
           cs.iban as firm_iban, cs.bank_name as firm_bank_name, cs.logo_url as firm_logo_url,
           cs.letterhead_logo_position as firm_logo_position,
           cs.letterhead_logo_height   as firm_logo_height
    from public.engagement_letters el
    join public.clients c on c.id = el.client_id
    join public.company_settings cs on cs.id = 1
    where el.accept_token = p_token
      and el.status in ('sent', 'accepted');
end$$;

grant execute on function public.get_engagement_letter_for_acceptance(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
-- =============================================================
-- End of migration 149.
-- =============================================================
