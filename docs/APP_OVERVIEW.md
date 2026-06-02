# PC Prime Portal — App Overview

A snapshot/backup document of what's been built. Keep this with the code so a future you (or anyone you hand the project to) can pick it up without having to reverse-engineer everything.

> Last updated: 2026-06-02. Current commit on `main`: `d540bac`.

---

## 1. What this app is

A **client portal for PC Prime & Calculate Consultants Ltd** (Cyprus accounting firm). Two sides:

- **Staff side** — accountants and admins manage clients, scan & post supplier invoices, bill clients, track deadlines, etc.
- **Client side** — engaged clients log in to see their account, send messages, upload expenses (with AI auto-fill), run their own invoicing, view reports the firm publishes for them.

Production URL: **https://portal.primeandcalculate.com**
Repository: **https://github.com/panayiotis-blip/pcprime-client-portal** (branch `main`)

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Routing | React Router v6 |
| Charts | recharts |
| Backend / DB / Auth | Supabase (Postgres + Row-Level Security + Edge Functions + Storage) |
| Hosting | Vercel (frontend) + Supabase (backend) |
| Email | CloudMailin (outbound active; inbound paused on paid plan) |
| AI | Anthropic Claude `claude-haiku-4-5-20251001` for document extraction |
| Error tracking | Sentry (scaffolded; activate via `VITE_SENTRY_DSN`) |
| MFA | TOTP via Supabase Auth, enforced for staff |

---

## 3. Top-level structure

```
.
├── docs/                              ← human docs (this file, restore runbook)
├── public/                            ← static assets (logo, favicon)
├── src/
│   ├── App.tsx                        ← top-level routes + auth gates
│   ├── main.tsx                       ← React entry + Sentry init
│   ├── index.css                      ← global styles
│   ├── components/                    ← all UI
│   │   ├── Admin/                     ← staff admin (User mgmt, Reports, Cal, etc.)
│   │   ├── Auth/                      ← LoginPage, MFA, Terms gate, etc.
│   │   ├── Billing/                   ← firm-side invoicing
│   │   ├── Client/                    ← client-side screens (My Expenses, My Reports, etc.)
│   │   ├── Documents/                 ← per-client documents tree
│   │   ├── Invoice/                   ← scanned-invoice editor
│   │   ├── Layout/                    ← AppShell (sidebar/header), FAB
│   │   ├── Public/                    ← /signup, /privacy, landing, tax calc
│   │   ├── Scanner/                   ← document scan + camera capture
│   │   ├── Dashboard.tsx              ← staff dashboard + client dashboard v2
│   │   ├── shared/PrintToolbar.tsx    ← Close · Export ▾ · Print bar
│   │   └── ui/                        ← reusable primitives (Modal, Button, ...)
│   ├── context/                       ← AuthContext, AppContext, ScanContext, ...
│   ├── hooks/                         ← useInactivityTimeout, ...
│   └── services/
│       ├── api.ts                     ← every server call — read this first
│       ├── dates.ts                   ← formatDate / formatDateTime (dd/mm/yyyy)
│       ├── documentPdf.tsx            ← PDF/Word/Excel export helpers
│       └── ocr/                       ← pdfRenderer, invoiceParser, ocrService
├── supabase/
│   ├── migrations/                    ← 91 numbered SQL files (each one applied once)
│   └── functions/                     ← Edge Functions (Deno)
│       ├── admin-users/               ← create/reset/delete users (staff)
│       ├── extract-document/          ← AI extraction (Claude vision)
│       ├── inbound-email/             ← CloudMailin → portal Emails tab (deployed when paid plan active)
│       ├── notify-new-message/        ← Emails firm on a new client message
│       ├── send-email/                ← Outbound mail via CloudMailin (staff-only)
│       └── submit-application/        ← Public /signup form (Turnstile-gated)
├── vercel.json
├── package.json
└── tsconfig.json
```

---

## 4. Major features (what's been built)

### Staff side

- **Clients** — full CRUD, KYC, Directors, Contacts, Tax Registrations, Credentials Vault (MFA-gated), Documents, Emails, Audit log.
- **Smart Import** — bulk client import from spreadsheets.
- **Scanned invoices** — drag-drop or camera → AI extracts fields → review screen → post (creates `invoices` + `journal_lines`). Confidence flagging + duplicate detection + zoom/rotate preview controls.
- **Billing** — issue invoices to clients, receipts (auto-numbered), statements, age analysis, sales reports with PDF/Word/Excel export, recurring invoice templates.
- **Tasks** — staff task board with templates, return-call workflow, task badges.
- **Compliance / Tax Filings** — calendar, deadline tracking, audit-log alerting.
- **Messages** — per-client topics/threads with after-hours auto-reply (configurable), email notifications.
- **Client Expenses** — review queue for client-submitted expenses; "Allocate" opens the scan editor prefilled from the expense + its file, creating a real invoice and linking the expense.
- **Calendar, Timesheet, Phone Log, Documents tree, Reports, Export** — supporting modules.
- **Administration** — Users (with MFA step-up), Applications (approve signups), Audit log, Company Settings, Deleted Clients (soft-delete recovery), **AI Usage** (token cost tracking).

### Client side

- **Dashboard v2** — greeting, 4 KPI tiles (Income / Expenses this month, Owed to you, Balance with us), 6-month Income vs Expenses bar chart, 3 preview cards (Latest messages, Recent expenses, Upcoming deadlines), quick-action buttons. Favourites in the sidebar.
- **My business**
  - **My Company** — own company profile / invoicing identity (logo, VAT, address).
  - **Customers** — their customer list.
  - **Sales Invoices** — issue invoices to their own customers (per-client numbering, print, PDF).
  - **Debtors** — aged debtors of their own customers.
  - **My Expenses** — scan/upload purchase invoices with AI auto-fill, tag expense type + project, submit.
  - **Reports** — Profit & Loss + VAT report (period picker monthly/annual), plus reports the firm publishes to them.
- **Accountant**
  - **My Account** — billing position with the firm.
  - **Deadlines** — their tax filings.
  - **Documents** — their folders.
  - **Messages** — topics/threads with the firm.

### Cross-cutting

- **Auth & MFA** — Email/magic-link login; TOTP enrolment forced for staff; trusted-device tokens; MFA step-up modal for sensitive actions.
- **Terms of Service** acceptance gate at first login.
- **Document Categories master** + **Storage Folder Names master** in Company Settings (rename propagates to all clients).
- **Dates** — dd/mm/yyyy app-wide via `src/services/dates.ts`.
- **Print everywhere** — shared PrintToolbar (PDF / Word / Excel / Print).

---

## 5. Database — the big pieces

(See `supabase/migrations/` for the canonical schema; this is the mental map.)

| Table | Role |
|---|---|
| `profiles` | One per auth user; role, full_name, tos_accepted_version |
| `clients` | Firm's client list (engagement clients + portal-only signups) |
| `user_clients` | Many-to-many: which auth users belong to which client |
| `contacts`, `directors`, `kyc_records`, `tax_registrations`, `platform_credentials` | Client metadata |
| `invoices`, `invoice_files`, `journal_lines` | Scanned/posted supplier invoices |
| `client_invoices`, `receipts`, `recurring_invoices` | Firm's billing of clients |
| `customer`, `customer_invoice`, `customer_invoice_line`, `customer_receipt` | Client's OWN billing (sub-tenant) |
| `client_company_profile` | Client's invoicing identity / letterhead |
| `client_expense` | Client-uploaded expenses (with `invoice_id` link when allocated) |
| `advisor_report` | Firm-uploaded finished reports for clients |
| `client_messages`, `message_thread` | Messaging (topics + thread) |
| `client_emails`, `client_email_attachments` | Inbound email (when CloudMailin live) |
| `staff_tasks`, `task_templates` | Internal task board |
| `compliance_tasks`, `client_tax_filings` | Deadlines |
| `time_entries`, `staff_service_rates` | Timesheet |
| `phone_calls` | Phone log + return-call workflow |
| `documents`, `folders` | Client document tree |
| `document_categories`, `folder_template` | Master lists (rename here, propagates to all clients) |
| `client_categories`, `cities` | Lookup tables |
| `portal_applications` | Self-signup queue |
| `user_favourites` | Pinned menu items / clients |
| `company_settings` | Single-row firm settings (logo, VAT, brand colours, auto-reply config) |
| `ai_usage` | Per-scan token + cost log |
| `audit_log`, `audit_log_alerts` | Audit trail + automated alerts (pg_cron) |

**Security model:** All client-scoped reads gated by `user_can_access_client(client_id)` (staff OR linked via `user_clients`). Writes go through security-definer RPCs. Sensitive actions require `aal2` (`require_aal2()` helper).

---

## 6. Edge Functions (Deno, deployed in Supabase)

| Function | Auth | Purpose |
|---|---|---|
| `admin-users` | Staff | Create / reset password / delete auth users (MFA step-up required for the caller). |
| `extract-document` | Any authenticated | Claude vision extraction for scanned invoices/receipts. Cyprus + Greek aware. |
| `inbound-email` | HTTP Basic Auth from CloudMailin (Verify JWT OFF) | Files inbound email against the matching client. **Deployed when CloudMailin paid plan is active.** |
| `notify-new-message` | Authenticated client | Emails the firm's contact address when a client posts a message. |
| `send-email` | Staff only | Outbound mail via CloudMailin. |
| `submit-application` | Public (Verify JWT OFF) | Public signup form; Turnstile-verified. |

---

## 7. Migrations

The schema is built by running `supabase/migrations/NNN_*.sql` in order. **91 migrations** as of this snapshot. Each is idempotent / safe to re-run individually. New work always adds a new migration — never edits an old one. The most recent of note:

- `086_ai_usage.sql` — token cost log
- `087_configurable_autoreply.sql` — moveable office hours / message
- `088_message_threads.sql` — topics + threads on client messages
- `089_tos_acceptance.sql` — Terms acceptance per user
- `090_fix_get_client_threads.sql` — RPC fix
- `091_folder_templates.sql` — master list of storage-folder names

---

## 8. Secrets / environment variables

**Vercel (frontend build):**
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable/anon key
- `VITE_TURNSTILE_SITE_KEY` (optional) — enables /signup captcha
- `VITE_SENTRY_DSN` (optional) — enables Sentry error tracking
- `VITE_VERCEL_GIT_COMMIT_SHA` (optional) — release-tags Sentry events

**Supabase Edge Function secrets:**
- `ANTHROPIC_API_KEY` — for `extract-document`
- `CLOUDMAILIN_OUTBOUND_USERNAME` + `CLOUDMAILIN_OUTBOUND_TOKEN` + `CLOUDMAILIN_FROM` — for `send-email` and `notify-new-message`
- `CLOUDMAILIN_AUTH_USER` + `CLOUDMAILIN_AUTH_PASS` — for `inbound-email`
- `TURNSTILE_SECRET_KEY` (optional) — enables /signup captcha verification
- `PORTAL_URL` (optional) — link target in `notify-new-message`

---

## 9. How to recover the app from this backup

If GitHub or Vercel disappear and all you have is the source archive:

1. **Restore the code** — unzip the source archive (see commit log/git bundle) into a folder.
2. **Install dependencies** — `npm install` (Node 20+).
3. **Set up Supabase** — create a new project; run every `supabase/migrations/NNN_*.sql` in order; create the storage buckets referenced in the migrations (`client-expenses`, `advisor-reports`, `client-email-attachments`, `client-logos`, `invoice-files`, `kyc-documents`, `company-assets`). If a PITR snapshot exists, restore that instead.
4. **Deploy edge functions** — paste each `supabase/functions/*/index.ts` into the Supabase dashboard and deploy (Verify JWT OFF for `inbound-email`, `submit-application`, and `extract-document`).
5. **Configure secrets** — set Edge Function secrets (section 8).
6. **Set up Vercel** — connect repo, set env vars (section 8), deploy.
7. **Point DNS** — repoint `portal.primeandcalculate.com` to Vercel.
8. **First login** — create a staff/owner row via Supabase Auth + a `profiles` row with role `owner`.

See **`docs/restore-runbook.md`** for the database-side recovery details (PITR + verification checklist).

---

## 10. What's still open / known follow-ups

These are documented in `~/.claude/projects/.../memory/project_backlog.md` (working notes). Highlights:

- **iOS Chrome hamburger bug on the client dashboard** — defer until we can connect Safari Web Inspector from a Mac (every CSS guess has failed).
- **AI prefill tuning v2** — iterate the prompt if specific document types still misread (currently calibrated for Cyprus EN/EL invoices and receipts).
- **Inbound email activation** — code ready, awaiting CloudMailin paid plan + MX records.
- **Activation switches** — Turnstile keys, Sentry DSN, Anthropic spend cap. None essential for normal operation.
- **Future Terms text** — current text in `src/components/Auth/terms.tsx` is a DRAFT placeholder; replace with the lawyer-approved wording and bump `CURRENT_TOS_VERSION` to re-prompt everyone.

---

## 11. Operating principles baked into the codebase

- **Migrations are append-only.** Never edit a numbered migration; add a new one.
- **All writes go through security-definer RPCs.** Direct table writes are blocked by RLS.
- **Tables ending in `_template` / `_categories`** are firm-wide masters; renames propagate.
- **Dates are dd/mm/yyyy everywhere** via `src/services/dates.ts`. Don't reach for `Date.prototype.toLocaleDateString()` ad-hoc.
- **Print pages** use `PrintToolbar` + a `.print-page` (or other) wrapper so every printable view gets PDF/Word/Excel for free.
- **Staff sidebar uses `STAFF_GROUPS`**, client sidebar uses `CLIENT_GROUPS` (both in `src/components/Layout/AppShell.tsx`). Sidebar badges and group expansion state are persisted per user.

---

That's the app. The code is the source of truth; this document is the map.
