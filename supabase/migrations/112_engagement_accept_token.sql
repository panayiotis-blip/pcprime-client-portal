-- Migration 112: Public click-to-accept for engagement letters
-- ==============================================================
-- Adds an unguessable accept_token to each letter. The token is the
-- only piece of state in the public URL the client receives in the
-- email. Two public RPCs let an anonymous browser load the letter
-- and stamp it accepted without ever exposing the table directly.

alter table public.engagement_letters
  add column if not exists accept_token text unique;

create index if not exists engagement_letters_accept_token_idx
  on public.engagement_letters (accept_token)
  where accept_token is not null;

-- -----------------------------------------------------------------
-- Public RPC: load a letter by token (read-only).
-- Returns enough data for the public page to render the letter and
-- regenerate the PDF client-side using the existing generator.
-- Anyone with the token can read; that's the trust model for the
-- email-link flow.
-- -----------------------------------------------------------------
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
  firm_iban text, firm_bank_name text, firm_logo_url text
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
           cs.iban as firm_iban, cs.bank_name as firm_bank_name, cs.logo_url as firm_logo_url
    from public.engagement_letters el
    join public.clients c on c.id = el.client_id
    join public.company_settings cs on cs.id = 1
    where el.accept_token = p_token
      and el.status in ('sent', 'accepted');
end$$;

grant execute on function public.get_engagement_letter_for_acceptance(text) to anon, authenticated;

-- -----------------------------------------------------------------
-- Public RPC: accept a letter by token (typed signature).
-- Idempotent — re-running on an already-accepted letter is a no-op.
-- Supersedes any prior sent/accepted versions for the client.
-- -----------------------------------------------------------------
create or replace function public.accept_engagement_letter_by_token(
  p_token text, p_signature text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_id bigint; v_client_id bigint; v_status text;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('ok', false, 'error', 'missing token');
  end if;
  if p_signature is null or trim(p_signature) = '' then
    return jsonb_build_object('ok', false, 'error', 'signature required');
  end if;

  select id, client_id, status into v_id, v_client_id, v_status
  from public.engagement_letters
  where accept_token = p_token;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'letter not found');
  end if;
  if v_status = 'accepted' then
    return jsonb_build_object('ok', true, 'already_accepted', true);
  end if;
  if v_status <> 'sent' then
    return jsonb_build_object('ok', false, 'error', 'letter is not in sent state');
  end if;

  update public.engagement_letters set
    status = 'accepted',
    accepted_at = now(),
    accepted_method = 'portal_click',
    accepted_signature = p_signature,
    accepted_notes = 'Accepted via public click link'
  where id = v_id;

  -- Supersede older sent/accepted letters for this client. Reuses the
  -- helper that the staff flow uses, so the data model stays consistent.
  perform public.supersede_prior_engagement_letters(v_client_id, v_id);

  return jsonb_build_object('ok', true);
end$$;

grant execute on function public.accept_engagement_letter_by_token(text, text) to anon, authenticated;
