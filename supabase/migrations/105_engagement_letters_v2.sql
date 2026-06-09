-- Migration 105: Engagement letters v2 — fee model + firm defaults
-- ==================================================================
-- Aligns the engagement-letter system with PC Prime's actual template
-- ("Provision of Services and Statement of Work"): adds a flat-annual
-- fee mode billed monthly (the default in practice), hourly rates,
-- discount %, minimum monthly fee, and an Engagement Leader name.
--
-- Firm-wide defaults for those fields live on company_settings so new
-- letters pre-fill — only the per-client bits need typing.

-- ------------------------------------------------------------------
-- 1. engagement_letters: new columns
-- ------------------------------------------------------------------
-- fee_mode: 'flat' = one annual estimate (billed monthly);
--           'per_service' = sum of per-service annual fees.
alter table public.engagement_letters
  add column if not exists fee_mode text not null default 'flat'
    check (fee_mode in ('flat', 'per_service'));

alter table public.engagement_letters
  add column if not exists annual_estimate numeric;
alter table public.engagement_letters
  add column if not exists engagement_leader text;
alter table public.engagement_letters
  add column if not exists hourly_rate_director numeric;
alter table public.engagement_letters
  add column if not exists hourly_rate_manager numeric;
alter table public.engagement_letters
  add column if not exists hourly_rate_support numeric;
alter table public.engagement_letters
  add column if not exists discount_percent numeric;
alter table public.engagement_letters
  add column if not exists min_monthly_fee numeric;
alter table public.engagement_letters
  add column if not exists annual_review_notice_days int default 30;
-- Cover letter body (page 1 of the PDF). Editable per letter.
alter table public.engagement_letters
  add column if not exists cover_letter_text text;

-- ------------------------------------------------------------------
-- 2. company_settings: firm-wide defaults
-- ------------------------------------------------------------------
alter table public.company_settings
  add column if not exists engagement_leader_default text;
alter table public.company_settings
  add column if not exists hourly_rate_director numeric;
alter table public.company_settings
  add column if not exists hourly_rate_manager numeric;
alter table public.company_settings
  add column if not exists hourly_rate_support numeric;
alter table public.company_settings
  add column if not exists default_discount_percent numeric;
alter table public.company_settings
  add column if not exists default_min_monthly_fee numeric;
-- Pre-filled body text for new letters. Editable per letter afterwards.
alter table public.company_settings
  add column if not exists default_cover_letter_text text;
alter table public.company_settings
  add column if not exists default_sow_intro_text text;
alter table public.company_settings
  add column if not exists default_terms_text text;

-- ------------------------------------------------------------------
-- 3. Seed firm defaults from the PC Prime sample (only if blank).
-- ------------------------------------------------------------------
update public.company_settings set
  engagement_leader_default = coalesce(engagement_leader_default, 'Mr. Panayiotis Savva'),
  hourly_rate_director      = coalesce(hourly_rate_director,      250),
  hourly_rate_manager       = coalesce(hourly_rate_manager,       150),
  hourly_rate_support       = coalesce(hourly_rate_support,       65),
  default_discount_percent  = coalesce(default_discount_percent,  25),
  default_min_monthly_fee   = coalesce(default_min_monthly_fee,   200),
  default_cover_letter_text = coalesce(default_cover_letter_text,
    'Further to our discussions regarding the provision of accounting and advisory services to {{client_name}}, '
    'we set out below and in the Statement of Work the terms of business which will govern our agreement for the '
    'provision of such services.' || E'\n\n' ||
    '1. The Services' || E'\n' ||
    'The services described in the agreement will comprise the provision of accounting and advisory services and '
    'in particular in overviewing the accounting function and the maintenance of proper accounting records by the '
    'above Company. The scope of our services and our respective responsibilities are set out in the Statement of Work.' || E'\n\n' ||
    '2. Engagement Leader' || E'\n' ||
    '{{engagement_leader}} will have the overall responsibility for the conduct and the provision of the services on our behalf.' || E'\n\n' ||
    '3. Fees' || E'\n' ||
    'Our fees are generally based on the level of staff and the time required for completing the assignment having regard '
    'to the degree of responsibility and complexity of the assignment. The fees will be subject to review by us each year '
    'and will vary for a number of factors including the extent of the assistance we expect from you and/or from persons '
    'assigned by you.' || E'\n\n' ||
    '4. Confirmation of agreement' || E'\n' ||
    'Please confirm your acceptance of the agreement by signing on the appropriate space below and returning the enclosed '
    'copy to us. For any further information or explanations you may require in connection with the above, please refer to '
    '{{engagement_leader}} who will act as the Engagement Leader.'
  ),
  default_sow_intro_text = coalesce(default_sow_intro_text,
    'PC Prime & Calculate Consultants Ltd is pleased to confirm its engagement for the provision of accounting, payroll, '
    'taxation, and business advisory services to {{client_name}}. Any additional Services to supplement those described '
    'in this Statement of Work would normally require a separate Statement of Work / Agreement. The Services under this '
    'Agreement will be provided in accordance with the professional standards governing our profession. All accounting '
    'work or advice will be based upon information furnished by you or by people authorised by you.'
  ),
  default_terms_text = coalesce(default_terms_text,
    '1. Your obligations' || E'\n' ||
    'To be of greatest assistance to you, we should be advised in advance of any major transactions you may propose to '
    'undertake. Unless specific advice was sought from us with respect to such matters, we cannot assume responsibility '
    'for any advice with respect to the consequences of the transactions entered into.' || E'\n\n' ||
    '2. Additional terms and conditions' || E'\n' ||
    'The scope of our work is restricted to the specific terms of the engagement we are called to do. Any advice will be '
    'based on the laws and regulations as they stand at the time the advice is provided.' || E'\n\n' ||
    '3. Confidentiality' || E'\n' ||
    '(i) Confidential Information — Both parties agree to use the other''s confidential information only in relation to '
    'the services, and not to disclose it without the other''s written consent, except where required by law or regulation '
    'or by a professional body of which we are a member. Confidential information shall mean any information disclosed by '
    'one party to the other party in connection with the services, which is of a confidential nature irrespective of '
    'whether it is marked as such.' || E'\n\n' ||
    '(ii) Performing services for others — You agree that we may perform services for your competitors or other parties '
    'whose interests may conflict with yours, as long as we do not disclose any confidential information and we comply '
    'with our ethical obligations. Where we identify a conflict, we will contact you for it to be mutually resolved.' || E'\n\n' ||
    '4. Data Protection' || E'\n' ||
    'We comply with applicable data protection laws including GDPR. We will process personal data only as necessary for '
    'service delivery, implement appropriate security measures, assist you in responding to data-subject requests, notify '
    'you of any data breaches within 24 hours, and return or delete personal data upon contract termination.' || E'\n\n' ||
    '5. Force Majeure' || E'\n' ||
    'Neither party shall be liable for failure to perform obligations if prevented by circumstances beyond reasonable '
    'control, including natural disasters, government actions, war or civil unrest, cyber attacks, pandemics, or power / '
    'telecommunications failures.' || E'\n\n' ||
    '6. Jurisdiction and Governing Law' || E'\n' ||
    'This agreement is governed by Cyprus law. Any disputes shall be subject to the exclusive jurisdiction of the Cyprus courts.'
  )
where id = 1;
