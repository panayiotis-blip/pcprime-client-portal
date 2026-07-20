# Sub-processor Register — Client Portal

**Controller:** PC Prime & Calculate Consultants Ltd (Cyprus)
**Scope:** third parties that process personal data on the firm's behalf via the client portal.
**Purpose:** supports the firm's Record of Processing Activities (GDPR Art. 30), sub-processor disclosure (Art. 28), and privacy notice (Art. 13–14).
**Status:** *technical draft — to be reviewed/finalised by the firm's DPO/legal adviser. Verify each DPA is signed and each transfer mechanism is in place.*
**Last reviewed:** _____________  (keep current; update on any integration change)

---

## Active sub-processors

### 1. Supabase (Supabase, Inc.)
- **Purpose:** primary database, authentication, file storage, serverless (Edge) functions, encrypted secrets vault — the portal's core backend.
- **Personal data processed:** effectively all portal data — client identity (name, T.I.C., ID/passport, date of birth), contact details, financial records (invoices, tax returns, billing), uploaded documents, email correspondence, and encrypted platform/SMTP credentials.
- **Location / residency:** data at rest in the **EU** (project is provisioned in an EU region).
- **Transfer safeguard:** Supabase is US-incorporated; rely on the **Supabase DPA + SCCs** for any support/engineering access.
- **Action:** sign/retain the Supabase DPA; confirm the project region is EU.

### 2. Vercel (Vercel, Inc.)
- **Purpose:** hosting and delivery of the web application (build, CDN, edge serving).
- **Personal data processed:** technical only — IP address, request/device metadata, access logs.
- **Location / residency:** compute region **`fra1` (Frankfurt, EU)**.
- **Transfer safeguard:** US-incorporated; **Vercel DPA + SCCs**.
- **Action:** accept/retain the Vercel DPA; confirm no application PII is written to server logs.

### 3. Google (Google Workspace / Gmail API)
- **Purpose:** the firm's shared mailbox (`info@`) send/receive via the Gmail API, and per-staff SMTP sending.
- **Personal data processed:** email content and attachments (client correspondence — may contain PII and financial data), sender/recipient addresses.
- **Location / residency:** Google Workspace; **EU data residency is configurable** in the Admin console.
- **Transfer safeguard:** **Google Workspace/Cloud DPA + SCCs**; confirm the contracting entity (Google Ireland Ltd for EU customers).
- **Action:** sign the Workspace DPA; enable EU data region where available; review the Gmail API scopes granted (read/modify/send) for least privilege.

### 4. Sentry (Functional Software, Inc.)
- **Purpose:** application error monitoring / crash reporting.
- **Personal data processed:** error events — **now PII-scrubbed** (no IP address, email, cookies, headers, or request body; URLs query-stripped). Residual: technical stack traces, browser/OS, page path.
- **Location / residency:** **EU** — ingest is pinned to `*.ingest.de.sentry.io` (CSP-enforced).
- **Transfer safeguard:** US parent; **Sentry DPA + SCCs**.
- **Action:** confirm the Sentry project sits in an **EU-region** organisation (DSN host `.de.sentry.io`); sign the Sentry DPA.

### 5. Anthropic (Anthropic PBC) — ⚠ third-country transfer
- **Purpose:** AI extraction of data from uploaded documents (the `extract-document` function / Claude API).
- **Personal data processed:** document images/content submitted for extraction — **may contain client PII and financial data**.
- **Location / residency:** **United States** (Claude API).
- **Transfer safeguard:** this is an **EU→US transfer** — requires the **Anthropic DPA + SCCs**, and **zero-data-retention / no-training** enabled.
- **Action (priority):** sign the Anthropic DPA + Commercial Terms; enable **zero retention**; **disclose this US transfer in the client privacy notice**; assess whether client consent or an EU-hosted alternative is preferable for document extraction.

---

## Decommissioned (remove from records once confirmed disconnected)
- **CloudMailin** — former inbound-email capture; **cancelled**. Confirm the integration is removed and no data is retained there.

---

## Maintenance notes
- Update this register whenever an integration is **added, removed, or changes region/purpose**.
- Ensure the client-facing **privacy notice** names these sub-processors and explicitly discloses the **Anthropic (US) transfer**.
- Pair this with a signed **DPA** per active sub-processor and record the transfer mechanism (adequacy/SCCs) in your ROPA.
- This document is a technical draft; the binding legal wording and DPA sign-off are for the firm's DPO/legal adviser.
