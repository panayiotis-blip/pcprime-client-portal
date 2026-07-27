# Record of Processing Activities (ROPA) — Client Portal

**Controller:** PC Prime & Calculate Consultants Ltd (Cyprus)
**Address:** Dikomou 12, Office 201, Kiti, Larnaca, Cyprus
**Contact:** info@primeandcalculate.com · +357 24 258346
**Company reg. no. / VAT no.:** _______________  *(fill in)*
**Data Protection Officer / contact:** _______________  *(fill in — name, email)*
**Regulator:** Office of the Commissioner for Personal Data Protection (Cyprus)

**Scope:** personal data processed through the firm's client portal (this application) in the course of providing accounting, tax, payroll and consultancy services.
**Legal instrument:** GDPR Art. 30(1) — controller's record of processing activities.
**Status:** *technical draft prepared from the system as built — to be reviewed, corrected and finalised by the firm's DPO/legal adviser.* Legal bases and retention periods must be confirmed against Cyprus law.
**Companion documents:** [`GDPR_SUBPROCESSORS.md`](./GDPR_SUBPROCESSORS.md) (Art. 28 sub-processor register).
**Last reviewed:** _____________

---

## 1. Categories of data subjects

- **Clients** — individuals (sole traders, self-employed, private individuals) and the contact persons of corporate clients.
- **Company officers of clients** — directors, shareholders, secretaries, signatories and ultimate beneficial owners (UBOs).
- **Third parties named in client records** — e.g. suppliers/vendors on purchase invoices, correspondents in emails.
- **Firm staff** — portal users (owner, supervisors, staff/admins) whose accounts, roles and activity are recorded.

## 2. Purposes of processing

1. Providing accounting, bookkeeping, VAT and tax-return, payroll and Social-Insurance services.
2. Statutory tax and regulatory filings (e.g. TAXISnet, Social Insurance, Registrar of Companies).
3. Client due diligence — KYC/AML checks and record-keeping (anti-money-laundering obligations).
4. Client relationship, engagement management, billing and collections.
5. Secure document exchange and correspondence with clients.
6. Internal administration — staff task management, timesheets, audit and security monitoring.

## 3. Categories of personal data

| Group | Examples (fields/tables in the system) |
|---|---|
| **Identity** | Name, trading name, date of birth, nationality, ID number, passport number |
| **Tax / statutory identifiers** | Tax Identification Code (TIC), VAT number, registration number, employer number, Ergani number, Social Insurance number |
| **Contact** | Address(es), city, postal code, country, phone, mobile, fax, email, website |
| **KYC / AML (sensitive)** | Risk level, PEP status, source of funds, beneficial-owner details, KYC review dates and notes |
| **Financial / accounting records** | Invoices (sales & purchase), receipts, journal lines, tax returns/filings, billing, fees, timesheets |
| **Documents** | Uploaded files (bank statements, invoices, statutory documents) — *may incidentally contain special-category data* |
| **Correspondence** | Inbound/outbound emails and attachments, portal messages, phone-call logs |
| **Credentials** | Clients' third-party portal logins — **encrypted at rest**, decrypted only on demand |
| **Staff account data** | User identity, role/permissions, MFA/trusted devices, activity in the audit log |
| **Technical / usage** | IP address and request metadata (hosting logs), AI-usage metering, error diagnostics |

> **Special categories (Art. 9):** the firm does not intentionally process Art. 9 data. KYC/AML fields and identity documents are sensitive but not special-category per se; uploaded documents may incidentally contain such data. Handle on the legal-obligation / substantial-public-interest basis and minimise.

## 4. Legal bases (Art. 6) — *to be confirmed by DPO*

- **Contract (6(1)(b))** — performing the engagement/services for the client.
- **Legal obligation (6(1)(c))** — Cyprus accounting, tax and **AML** (Prevention and Suppression of Money Laundering Laws) record-keeping and reporting duties.
- **Legitimate interests (6(1)(f))** — firm administration, security/audit logging, fraud prevention (balanced against data-subject rights).

## 5. Recipients / categories of recipients

- **Public authorities** — Cyprus Tax Department (TAXISnet), Social Insurance Services, Registrar of Companies, and other authorities as legally required.
- **Processors (sub-processors)** — see [`GDPR_SUBPROCESSORS.md`](./GDPR_SUBPROCESSORS.md): Supabase (backend, EU), Vercel (hosting, EU `fra1`), Google Workspace/Gmail (email, EU-configurable), Sentry (error monitoring, EU), **Anthropic (AI document extraction, US)**.
- No sale of personal data; no processing for marketing or automated decision-making with legal effect.

## 6. Third-country transfers (Art. 44–49)

| Recipient | Country | Safeguard | Control |
|---|---|---|---|
| **Anthropic PBC** (AI document extraction) | **United States** | Anthropic **DPA + SCCs**, zero-data-retention / no-training *(to be signed/verified by DPO)* | Firm-wide **on/off toggle** in Company Settings → *AI & data transfers*; when off, extraction stays on-device (Tesseract OCR) and **no data leaves EU infrastructure** |
| Supabase, Vercel, Google, Sentry | Data resident in **EU**; US parent companies | Respective **DPA + SCCs** for any support access | EU region enforced/configured |

All other processing occurs within EU-resident infrastructure.

## 7. Retention (storage limitation)

Accounting, tax and AML records are retained for the legally required period (**~6–7 years** in Cyprus) *(confirm exact periods with DPO)*, after which client personal data is erased/anonymised. Operational and log data is aged out automatically per the configurable **retention schedule** (Company Settings → *Data retention*), applied nightly:

| Data | Default retention |
|---|---|
| OCR scratch text on invoices | 90 days (invoice itself kept) |
| Automation run log, AI-usage log, security alerts, actioned access requests | 365 days |
| Audit trail, phone/call logs, emails | Kept until explicitly configured otherwise |
| **Accounting / client records** | **Kept for the legal period — never auto-purged** |

**Erasure:** on a valid erasure request (or at end of the retention period), the *Erase client (GDPR)* action anonymises the client's identifiers and deletes personal ancillary data (addresses, notes, emails, credentials, directors, messages, intake) while retaining the accounting records required by law, now de-identified. All erasures are audit-logged.

## 8. Technical & organisational security measures (Art. 32)

- **Access control** — row-level security (RLS) isolates each client's data; role-based permissions (owner/supervisor/staff/client); least-privilege.
- **Authentication** — multi-factor authentication (MFA / AAL2) required for staff; trusted-device management.
- **Encryption** — data encrypted in transit (TLS/HTTPS, HSTS) and at rest (Supabase); third-party credentials encrypted in an application vault; secrets in the Supabase Vault.
- **Application hardening** — strict Content-Security-Policy and security headers; HTML sanitisation (DOMPurify) on all rendered email/document content; no inline scripts.
- **Auditability** — comprehensive audit log of data access and changes; security alerting; per-client GDPR data-export (access/portability) and erasure tooling.
- **Data minimisation** — AI extraction sends only document images with a generic prompt (no client account context); error monitoring is PII-scrubbed; OCR scratch text purged.
- **Vulnerability management** — dependencies patched (0 known vulnerabilities at last review); periodic security review.

## 9. Data-subject rights — how they are met

| Right | Mechanism |
|---|---|
| Access / portability (Art. 15/20) | *Export data (GDPR)* action → structured JSON of the client's data (audit-logged) |
| Rectification (Art. 16) | Staff edit the client record directly |
| Erasure (Art. 17) | *Erase client (GDPR)* action — anonymise & keep accounting records (audit-logged) |
| Restriction / objection | Handled operationally by the firm *(document process with DPO)* |

---

## Open items for the DPO / firm

- Fill in company reg./VAT numbers and the DPO contact.
- Confirm the **legal bases** and exact **statutory retention periods** against current Cyprus law.
- Sign and file the **DPA** for each sub-processor; verify the **Anthropic SCCs + zero-retention** before relying on the AI feature (or keep the toggle off).
- Ensure the **client-facing privacy notice** reflects this ROPA — especially the Anthropic (US) transfer.
- Define the operational process for restriction/objection requests and breach notification (Art. 33–34).
- Review this record at least annually and on any change to processing, sub-processors or systems.

*Prepared as a technical draft from the client-portal system. Binding legal wording and sign-off are the responsibility of the firm's DPO/legal adviser.*
