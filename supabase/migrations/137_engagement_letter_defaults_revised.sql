-- =============================================================
-- Migration 137: revised engagement-letter default text
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- Updates the firm-wide engagement-letter DEFAULTS in company_settings
-- (seeded by migration 105) to the revised wording: leader-name typo fix,
-- refreshed cover letter + Statement-of-Work intro, and the full 16-clause
-- Terms of Business.
--
-- SET is unconditional (not coalesce): 105 already seeded these, and we are
-- intentionally replacing them. This affects only NEW letters — each
-- engagement_letters row snapshots its own cover_letter_text/intro_text/
-- terms_text at creation, so already-issued letters are untouched.
--
-- Storage format matters: each clause heading is on its own line and each
-- body/sub-clause is a single un-wrapped line, with a blank line between
-- clauses. The PDF renderer splits on newlines and re-wraps each paragraph;
-- hard-wrapping the bodies here would fragment them.
--
-- report_footer is the firm-wide "Report / printable footer" shared by all
-- printable views (not only engagement letters) — the revised text is a
-- generic confidentiality notice, applied firm-wide by design.
-- =============================================================

begin;

update public.company_settings set
  engagement_leader_default = 'Mr. Panayiotis Savvas',

  default_cover_letter_text = $cover$Further to our discussions regarding the provision of accounting and advisory services to {{client_name}}, we set out below and in the Statement of Work the terms of business which will govern our agreement for the provision of such services.

1. The Services
The services described in this agreement comprise the provision of accounting and advisory services, and in particular overseeing the accounting function and the maintenance of proper accounting records of the Company. The scope of our services and our respective responsibilities are set out in the Statement of Work. Any services not expressly included are outside the scope of this engagement and, if required, will be agreed separately.

2. Engagement Leader
{{engagement_leader}} will have overall responsibility for the conduct and provision of the services on our behalf. Our work will be carried out in accordance with the professional standards, ethical requirements and quality management standards applicable to members of the Institute of Certified Public Accountants of Cyprus (ICPAC), including the IESBA Code of Ethics.

3. Your Responsibilities
You remain responsible for the completeness, accuracy and timely provision of the books, records and information required for our work, for the safeguarding of the Company's assets, and for compliance with the Company's statutory obligations and filing deadlines. Our ability to meet deadlines depends on receiving complete information in good time, and we cannot accept responsibility for consequences arising from information provided late, incompletely or inaccurately.

4. Client Identification (AML)
As a regulated firm we are required under the Prevention and Suppression of Money Laundering Activities Law to obtain and keep updated identification and due-diligence information on our clients, their directors and beneficial owners. You agree to provide such information on request and to notify us of any changes. We may suspend or decline to provide services where the required information is not provided.

5. Fees and Payment
Our fees are based on the level of staff involved and the time required, having regard to the responsibility and complexity of the assignment, and are subject to annual review. Fees are payable within 30 days of invoice. We reserve the right to charge interest on overdue amounts at the statutory rate and to suspend services where invoices remain unpaid, after giving you notice.

6. Confirmation of Agreement
Please confirm your acceptance of this agreement by signing in the space provided and returning a copy to us. Signature by electronic means is valid and binding. For any further information or explanation you may require, please refer to {{engagement_leader}}, who will act as the Engagement Leader.$cover$,

  default_sow_intro_text = $intro$PC Prime & Calculate Consultants Ltd is pleased to confirm its engagement for the provision of accounting, payroll, taxation and business advisory services to {{client_name}}. The specific services covered by this engagement are set out below. Any additional services beyond those described would normally require a separate Statement of Work or agreement. All work and advice will be based on the laws and regulations in force at the time the work is performed and upon information furnished by you or by persons authorised by you.$intro$,

  default_terms_text = $terms$1. Applicability
These Terms of Business, together with the covering letter and the Statement of Work, form the entire agreement between PC Prime & Calculate Consultants Ltd ("the Firm", "we", "us") and {{client_name}} ("the Client", "you") for the provision of the services described. In the event of conflict, the Statement of Work prevails over these Terms. These Terms apply to all services provided unless varied in writing.

2. Professional Standards
We are a firm regulated by the Institute of Certified Public Accountants of Cyprus (ICPAC). Our services are provided in accordance with applicable professional standards, the IESBA Code of Ethics, and ICPAC quality management requirements. Where our professional obligations conflict with your instructions, our professional obligations prevail.

3. Scope of Services and Reliance
(i) The scope of our work is restricted to the services set out in the Statement of Work. Services not expressly included - including, without limitation, audit, investigation for fraud or irregularities, legal advice, and advice on jurisdictions outside Cyprus - are excluded unless separately agreed in writing.
(ii) Our advice is based on the laws, regulations and published practice in force at the time it is given. We are under no obligation to update advice for subsequent changes in law or practice.
(iii) Our advice and deliverables are provided for your use only and for the purpose for which they were prepared. They may not be disclosed to, used by, or relied upon by any third party without our prior written consent. We accept no liability to any third party to whom our work is shown or disclosed.

4. Your Obligations
(i) You are responsible for providing, in good time, complete and accurate books, records, explanations and information required for the performance of the services, and for notifying us promptly of anything that may be relevant to our work.
(ii) To be of greatest assistance to you, we should be advised in advance of any major transactions you propose to undertake. Unless specific advice is sought from us with respect to such matters, we cannot assume responsibility for the consequences of the transactions entered into.
(iii) Responsibility for the management of the business, the safeguarding of assets, the prevention and detection of fraud and error, and compliance with statutory obligations and filing deadlines remains at all times with you and your directors. Our work is not designed to detect fraud or irregularities.
(iv) Where information is provided to us late, incompletely or inaccurately, we cannot accept responsibility for penalties, surcharges, interest or other consequences that result, and additional fees may apply for work performed under compressed timescales.

5. Client Identification and Anti-Money Laundering
As a regulated firm we are obliged under the Prevention and Suppression of Money Laundering and Terrorist Financing Law to obtain, verify and keep updated identification and due-diligence information on our clients, their directors, shareholders and ultimate beneficial owners, and to monitor business relationships on an ongoing basis. You agree to provide such information and documentation on request and to notify us promptly of any changes. We may suspend or decline to provide services, or terminate the engagement, where the required information is not provided. We are legally prohibited from informing you where a disclosure to the authorities has been or may be made.

6. Fees, Expenses and Payment
(i) Our fees are based on the level of staff involved and the time required, having regard to the degree of responsibility and complexity of the assignment, and are subject to review each year. Where hourly rates or fixed fees are agreed, they are set out in the Statement of Work.
(ii) Fees are exclusive of VAT, which will be added where applicable, and of disbursements and government or third-party charges, which are recharged at cost.
(iii) Invoices are payable within 30 days of the invoice date. We reserve the right to charge interest on overdue balances at the statutory rate from the due date, and to suspend some or all services where invoices remain unpaid after notice to you. Time spent on recovery of overdue fees may be charged.
(iv) Work requested outside the agreed scope will be charged in addition, at our prevailing rates, and where practicable agreed with you in advance.

7. Confidentiality
(i) Both parties agree to use the other's confidential information only in relation to the services, and not to disclose it without the other's written consent, except where disclosure is required by law, regulation, or a professional or regulatory body of which we are a member, or to our insurers or professional advisers under equivalent duties of confidence. Confidential information means any information disclosed by one party to the other in connection with the services which is of a confidential nature, irrespective of whether it is marked as such.
(ii) You agree that we may perform services for your competitors or other parties whose interests may conflict with yours, provided we do not disclose your confidential information and we comply with our ethical obligations. Where we identify a conflict of interest, we will contact you for it to be mutually resolved, and where required will implement appropriate safeguards or cease to act.
(iii) We may refer to you by name and to the general nature of services provided as a client reference, unless you instruct us otherwise in writing.

8. Data Protection
(i) We comply with applicable data protection laws, including Regulation (EU) 2016/679 (GDPR) and the Cyprus data protection legislation. Where we process personal data on your behalf, we do so only as necessary for service delivery and on your documented instructions; we implement appropriate technical and organisational security measures; we assist you, so far as reasonably practicable, in responding to data-subject requests and in meeting your own GDPR obligations; we notify you of any personal data breach affecting your data without undue delay after becoming aware of it; and upon termination we return or delete personal data, subject to our legal and professional retention obligations.
(ii) You consent to our use of reputable third-party providers of IT, cloud hosting, communications and specialist software in delivering the services, under appropriate data-processing agreements and safeguards, including providers whose infrastructure may be located within the EU/EEA or in jurisdictions ensuring adequate protection.
(iii) Each party warrants that it has a lawful basis for the personal data it discloses to the other in connection with the services.

9. Communications
You agree that we may communicate with you and with third parties (including authorities, banks and your other advisers, where authorised) by email and other electronic means. Electronic communication carries inherent risks, including delay, non-delivery and interception; we each accept these risks and agree that neither party is liable for loss arising from them, provided reasonable security measures are maintained. Documents signed by electronic means are valid and binding.

10. Documents, Working Papers and Retention
(i) Documents and records provided by you remain your property. Our working papers, files and internal documents, in whatever form, remain the property of the Firm.
(ii) We will retain records for the periods required by law and by professional requirements, after which they may be securely destroyed without further notice.
(iii) To the extent permitted by law and professional rules, we may exercise a right of retention over documents in our possession where fees remain unpaid.

11. Limitation of Liability
(i) Our total aggregate liability to you, arising from or in connection with this engagement, whether in contract, tort (including negligence), breach of statutory duty or otherwise, shall not exceed three (3) times the annual fees paid by you for the services giving rise to the claim.
(ii) We shall not be liable for indirect or consequential loss, loss of profit, loss of opportunity, or loss of goodwill.
(iii) We shall not be liable for loss arising from information or documents that are withheld, concealed from us, or misrepresented to us, nor for the acts or omissions of third parties outside our reasonable control.
(iv) Any claim must be brought within two (2) years of the date on which you became aware, or ought reasonably to have become aware, of the circumstances giving rise to it, and in any event within the period prescribed by law.
(v) Nothing in this agreement excludes or limits liability for fraud or dishonesty, or any liability which cannot lawfully be limited or excluded.
(vi) The services are provided to {{client_name}} alone. No director, officer, employee or shareholder of yours acquires any rights under this agreement, and any claim shall be brought only by the Client against the Firm.

12. Term, Suspension and Termination
(i) This agreement continues until terminated. Either party may terminate by giving one (1) month's written notice.
(ii) We may suspend services or terminate with immediate effect where required by law or professional obligations, where client due-diligence information is not provided, where fees remain unpaid after notice, or where continuing to act would place us in breach of regulatory or ethical requirements.
(iii) Termination does not affect fees due for work performed up to the date of termination, including work in progress, or any accrued rights of either party. On termination we will cooperate reasonably in the orderly transfer of your affairs to a successor firm, subject to payment of outstanding fees and to our professional obligations.
(iv) Clauses relating to confidentiality, data protection, documents and retention, limitation of liability, and governing law survive termination.

13. Force Majeure
Neither party shall be liable for failure to perform obligations if prevented by circumstances beyond reasonable control, including natural disasters, government actions, war or civil unrest, cyber attacks, epidemics or pandemics, or failures of power or telecommunications infrastructure. The affected party shall notify the other and use reasonable endeavours to resume performance.

14. General
(i) If any provision of this agreement is held invalid or unenforceable, the remaining provisions continue in full force.
(ii) A failure or delay in exercising any right is not a waiver of it.
(iii) This agreement may be varied only in writing signed by both parties, save that we may update these Terms for future work by giving you written notice.
(iv) This agreement supersedes all prior agreements and understandings relating to its subject matter.

15. Complaints
If you are dissatisfied with any aspect of our service, please raise the matter first with {{engagement_leader}}. We take complaints seriously and will investigate promptly. If the matter is not resolved to your satisfaction, you may refer it to the Institute of Certified Public Accountants of Cyprus.

16. Jurisdiction and Governing Law
This agreement is governed by the laws of the Republic of Cyprus. Any disputes arising from or in connection with it shall be subject to the exclusive jurisdiction of the courts of the Republic of Cyprus.$terms$,

  report_footer = $footer$This document contains confidential information intended solely for the addressee. Prepared by PC Prime & Calculate Consultants Ltd.$footer$;

commit;

-- =============================================================
-- Verify:
--   select engagement_leader_default,
--          length(default_cover_letter_text)  as cover_len,
--          length(default_sow_intro_text)     as intro_len,
--          length(default_terms_text)         as terms_len
--   from public.company_settings;
--   -- expect leader = 'Mr. Panayiotis Savvas' and terms_len ~ 8500.
-- =============================================================
-- End of migration 137.
-- =============================================================
