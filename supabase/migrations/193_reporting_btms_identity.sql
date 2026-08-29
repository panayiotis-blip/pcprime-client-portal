-- =====================================================================
-- Migration 193: which BTMS company a client's books are kept in
--
-- The portal's register and BTMS do not agree on names, and never will:
-- the register carries the legal name a client is invoiced under, BTMS
-- carries whatever the company was set up as, years ago, by whoever set
-- it up. A&F is ANTONIS & FOULIS ELECTRAGORA LTD in one and
-- "Antonis & Foulis Elektragora Ltd" in the other -- a different
-- transliteration, not a typo anybody is going to fix in either place.
--
-- So the link is a CODE, recorded once, not a name match. Name matching
-- across two systems is how the wrong client's ledger ends up on the
-- wrong screen, which is the one thing this application must never do.
--
-- What each name is for, so nothing is guessed later:
--   public.clients.name  -- the register. What a report is addressed to.
--   btms_company_code    -- BTMS's own company code. THE identifier.
--   btms_company_name    -- exactly as BTMS prints it, for the operator
--                           choosing an export, and for checking a file
--                           that does carry a name (the PDF evidence
--                           copy, the VAT summary) against the client
--                           the session is on.
--
-- Account-code fingerprinting (§7.2) stays the control on import. This is
-- a second, cheaper check for the files that do name a company, and the
-- answer to "which company do I pick in BTMS for this client".
-- =====================================================================

alter table reporting.client_settings
  add column if not exists btms_company_code text,
  add column if not exists btms_company_name text,
  -- What the client is called on the face of a report, when the legal
  -- name is not what they should be addressed as. Null means use the
  -- register's name, which is the right default.
  add column if not exists report_name text;

comment on column reporting.client_settings.btms_company_code is
  'The company code this client''s books are kept under in BTMS. The identifier that ties the two systems together.';
comment on column reporting.client_settings.btms_company_name is
  'The company name exactly as BTMS prints it, which is often not the client''s legal name.';
comment on column reporting.client_settings.report_name is
  'What to print on the face of a report, when that is not public.clients.name.';

-- Two clients cannot share one BTMS company: that would mean one set of
-- books reported twice under different names, and an import landing on
-- whichever was picked. Null is free -- most clients are not in BTMS yet.
create unique index if not exists client_settings_btms_code_uniq
  on reporting.client_settings (btms_company_code)
  where btms_company_code is not null;

-- A&F's BTMS name is known: it is what the prototype's own data carries and
-- what BTMS prints on the export. Seeded so the difference between the two
-- registers is recorded from the start rather than discovered again later.
--
-- The CODE is deliberately left null. Nobody has told this build what A&F's
-- company code in BTMS is, and a made-up code is worse than an empty one:
-- it would look authoritative, and the unique index would then hand it to
-- the first client whose real code happened to collide with the guess.
--
-- Finding the client is the whole difficulty in miniature. The register holds
-- the name in GREEK -- ΑΝΤΩΝΗΣ & ΦΟΥΛΗΣ ΗΛΕΚΤΡΑΓΟΡΑ ΛΤΔ -- so a pattern written from the
-- BTMS spelling matches nothing at all, and there is a SECOND client,
-- ΑΝΤΩΝΗΣ ΚΑΙ ΦΟΥΛΗΣ ΜΙΧΑΗΛ ΛΙΜΙΤΕΔ, whose name differs only after the
-- first two words. ΗΛΕΚΤΡΑΓΟΡΑ is the word that separates them.
--
-- So the seed refuses to run on a guess: it counts the clients the pattern
-- reaches and raises unless there is exactly one. A seed that cannot say with
-- certainty which client it means must stop, not pick.
do $$
declare
  v_client  bigint;
  v_matches int;
begin
  select count(*), min(c.id) into v_matches, v_client
    from public.clients c
    join reporting.client_settings s on s.client_id = c.id
   where c.deleted_at is null
     and (c.name ilike '%ΗΛΕΚΤΡΑΓΟΡΑ%'          -- the register, as it actually reads
       or c.name ilike '%ELECTRAGORA%'          -- should it ever be re-keyed in Latin
       or c.name ilike '%ELEKTRAGORA%');

  if v_matches <> 1 then
    raise exception
      'Refusing to seed the BTMS name: expected exactly one reporting client for Elektragora, found %.', v_matches;
  end if;

  -- Null-guarded so a name corrected by hand is never overwritten by a re-run.
  update reporting.client_settings
     set btms_company_name = 'Antonis & Foulis Elektragora Ltd'
   where client_id = v_client
     and btms_company_name is null;
end $$;
