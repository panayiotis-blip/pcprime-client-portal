# PC Prime Client Portal — Project State (handover doc)

Last updated: 2026-06-11.

> **How to use this file**: paste the whole thing into a fresh Claude
> conversation as the first message. It contains everything a new session
> needs to understand the codebase, conventions, recent work, and
> outstanding issues so you can pick up where the last session left off
> without re-explaining the whole project.

---

## 1. What this is

A multi-tenant client portal + practice management system for a
Cyprus-based accounting firm (PC Prime & Calculate Consultants Ltd).
Run by **Panayiotis Savvas** (owner, supervisor role). Used internally
by staff and exposed to clients who log in to see their own data.

**Primary purposes:**
- Staff: manage clients, tax returns, tasks, billing, scheduled
  workflows, document scanning, engagement letters.
- Clients: scan/upload documents, see their billing/deadlines/messages,
  customer-side billing of their own customers.
- Public: tax calculator, sign-up application, click-to-accept
  engagement letter page.

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React + TypeScript |
| Hosting (frontend) | Vercel |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions + Vault) |
| Auth | Supabase email/password + MFA (TOTP) |
| Storage | Supabase Storage (documents, logos, expense files) |
| PDF generation | jsPDF + bundled Roboto fonts (so Greek renders) |
| Email (outbound) | Edge Function `send-via-outlook` → user's own SMTP (Outlook / Gmail / custom). Per-user creds in `user_smtp_settings` (pgcrypto + Vault key). |
| OCR | Claude (haiku-4-5) vision via Edge Function `extract-document`, Tesseract fallback |
| AI | Anthropic API (extraction, ad-hoc helpers) |

### Working directory
- Local: `C:\Users\Dell\OneDrive\Desktop\btms-invoice-scanner`
- Platform: Windows 10, PowerShell + Bash via Claude Code
- Git remote: `github.com/panayiotis-blip/pcprime-client-portal`
- Main branch: `main` (deployed to Vercel on push)

---

## 3. Database — migrations 001–113

Migrations live in `supabase/migrations/` and are run manually in the
Supabase Dashboard SQL editor. They are NEVER auto-applied. The user
runs them and confirms with "ran NNN" before we proceed.

**Numbered milestones (latest in each area shown):**

- **001** — phase 1 core: clients + users + profiles + roles (`is_admin()`,
  `user_can_access_client()`)
- **003** — invoices, journal lines, chart of accounts (per-client `accounts`)
- **004** — documents, folders, `platform_credentials` (per-client)
- **007** — security helpers, audit trigger `tg_audit()`
- **010** — `staff_tasks`
- **011** — pgcrypto + Vault for encrypted secrets
- **014** — role tiers (`is_supervisor_or_higher`, `is_owner`)
- **018 / 063** — `task_templates` + items + seed
- **031** — clients V2 — name fields, soft delete, year-end, services
- **032 / 035 / 054 / 055 / 060** — bulk + smart import RPCs
- **045–047** — timesheet
- **046** — `company_settings` (single row, id=1)
- **050** — `document_categories`
- **078** — client billing (customers, invoices, receipts)
- **088** — message threads
- **091–092** — folder templates
- **093** — client_type individual/company split
- **094 / 095** — `tax_returns` (per-client TD1 storage + `form_type`)
- **096** — `user_smtp_settings` (per-user encrypted SMTP creds for outbound mail)
- **097** — `master_accounts` (firm-level Chart of Accounts catalogue
  + RPCs to apply to one or all clients + trigger that auto-seeds every
  new client)
- **098–101** — client services scheduler:
  - `service_definitions`, `service_stages`, `service_email_templates`,
    `client_services`, `client_service_stage_overrides`, `service_runs`
  - 4 seeded services: Payroll, VAT Return, Annual Accounts, Bookkeeping
  - 099 expands Payroll into 6 stages (info request, execution,
    payment, SI payment, PAYE payment, TD7 filing)
  - 100 adds Individual Tax Return + Tax Payments services and the
    `active_months int[]` mechanism for non-monthly cadences (e.g.
    `{7,12}` for provisional tax instalments)
  - 101 adds filter args (`p_service_id`, `p_client_ids[]`) + preview RPC
- **102** — soft delete on `staff_tasks` (`deleted_at`)
- **104** — `engagement_letters` (versioned per client, status workflow,
  services snapshot, accept tracking) + `next_engagement_letter_version()`
  + `supersede_prior_engagement_letters()`
- **105** — engagement letter V2: `fee_mode`, `annual_estimate`, hourly
  rates, `discount_percent`, `min_monthly_fee`, `engagement_leader`,
  `cover_letter_text`, plus firm defaults on `company_settings`
  (`engagement_leader_default`, `hourly_rate_director/manager/support`,
  `default_discount_percent`, `default_min_monthly_fee`,
  `default_cover_letter_text`, `default_sow_intro_text`,
  `default_terms_text`). Defaults seeded from the firm's actual sample
  letter ("Provision of Services and Statement of Work").
- **106** — `service_deliverables` (sub-bullets under each service on
  engagement letters) + adds Consulting Services service
- **107** — engagement_type ('annual' | 'one_off') on engagement_letters
- **108** — `staff_tasks.completion_data jsonb` + `service_stage_id` FK
  so per-stage completion modals can capture payment date / amount /
  receipt / confirmation method
- **109** — soft-delete + restore RPCs are supervisor-only
  (`soft_delete_staff_task`, `restore_staff_task` SECURITY DEFINER)
- **110** — `platform_sites` table (firm-level URL catalogue) + per-row
  URL override on `platform_credentials`
- **111** — `client_notes` (timestamped feed) + `source_note_id` FK on
  `staff_tasks` (notes can be promoted to tasks)
- **112** — `engagement_letters.accept_token` + public RPCs
  `get_engagement_letter_for_acceptance(token)` and
  `accept_engagement_letter_by_token(token, signature)` for the
  public click-to-accept page
- **113** — `signature_html` + `signature_text` on `user_smtp_settings`
  (auto-appended by send-via-outlook)

### RLS conventions

- `public.is_admin()` = any internal staff role (owner / supervisor /
  admin / staff). Most internal tables read = `is_admin()`.
- `public.is_supervisor_or_higher()` = owner + supervisor only. Used
  for destructive / firm-wide writes (delete clients, soft-delete
  tasks, edit service catalogue, edit master CoA).
- `public.is_owner()` = owner only (the user, in practice).
- `public.user_can_access_client(client_id)` = client-portal users can
  only see their own client_id.

### Audit
- `tg_audit()` trigger from migration 007 fires on insert/update/delete
  for many tables. Don't bypass it.
- Audit-log alerts (migration 026) run via pg_cron every 15 min.

---

## 4. Major frontend features (and where they live)

| Feature | Path |
|---|---|
| Client list + filters + Print/Export modal | `src/components/Client/ClientManager.tsx` |
| Client detail tabs | `src/components/Client/ClientDetail.tsx` + `tabs/*.tsx` |
| Tabs: Info, Contacts, Registrations, Services, KYC, Directors, Credentials, Documents, Invoices, Financials, Customer Billing, Reports, Compliance, Tax Filings, Emails, Time, Notes, Audit, Chart of Accounts, Vendor Patterns | one file per tab |
| Engagement letters: list + builder + acceptance | `EngagementLettersList.tsx`, `EngagementLetterBuilder.tsx`, `Public/EngagementAcceptPage.tsx` |
| Engagement letter PDF | `src/services/engagementLetterPdf.ts` |
| Client notes feed | `ClientNotesFeed.tsx` |
| Tax calculator (public + per-client embed) | `CyprusTaxCalculator.jsx` |
| Tax returns per client | `tabs/ClientTaxReturnTab.tsx` |
| Document scanning (bulk batch) | `Scanner/ScannerPage.tsx` |
| Invoice review after scan | `Invoice/InvoiceEditor.tsx` |
| Staff Tasks page | `Admin/StaffTasks.tsx` |
| Task completion modal (payment data per stage) | `Admin/TaskCompletionModal.tsx` |
| Run schedules modal (scheduler) | `Admin/RunSchedulesModal.tsx` |
| Send pending emails modal | `Admin/SendPendingEmailsModal.tsx` |
| Service catalogue editor | `Admin/ServiceSettings.tsx` |
| Master CoA admin | `Admin/MasterChartOfAccounts.tsx` |
| Company Settings page | `Admin/CompanySettings.tsx` (includes Platform Sites, Engagement defaults, Email signpost sub-sections) |
| Email settings + signature | `Settings/EmailSettings.tsx` |
| Sidebar / shell | `Layout/AppShell.tsx` |
| Routes | `src/App.tsx` |

### Key React patterns
- `FieldCtx` shared form context for the multi-tab client edit form
  (`Client/fieldContext.tsx`).
- jsPDF + Roboto: each PDF call does `registerRobotoFont(doc)` after
  `new jsPDF()` so Greek chars render. Don't rely on global font
  registration — Vite tree-shakes the side-effect away in prod.
- `EmbeddedContext` lets the public Tax Calculator and the embedded
  per-client Tax Return reuse the same component with different
  theming / scope.
- All admin pages with destructive actions check
  `isSupervisorOrHigher(user)` from `services/api.ts`.

---

## 5. Edge Functions

In `supabase/functions/`:

| Function | Purpose |
|---|---|
| `admin-users` | Create / edit users with service-role key |
| `extract-document` | Claude vision OCR for invoice scanning |
| `poll-gmail` | Inbound capture via the Gmail API. Scheduled poll of the Google Workspace capture mailbox → files into `client_emails`. Cursor in `email_sync_state` (migration 114). See `docs/PHASE2_INBOUND_GMAIL.md`. |
| `inbound-email` | LEGACY CloudMailin webhook (incoming client mail), superseded by `poll-gmail`. Delete after Gmail capture is verified live. |
| `send-via-outlook` | The single outbound path: sends via the staff member's own SMTP credentials. Generic — works with Outlook / Gmail / custom SMTP. |
| `submit-application` | Public sign-up endpoint |

**Deploy** via Supabase Dashboard → Edge Functions → Edit/Create. Most
need **Verify JWT OFF** (they do their own auth inside so OPTIONS
preflights work).

---

## 6. Outstanding issues (known, prioritised)

### #1 (BLOCKING right now) — outbound HTML emails arrive as gibberish on Gmail

**Symptoms:** subject + body show as raw quoted-printable / raw HTML
tags. PDF attachment missing. Confirmed user trace shows
`=?utf-8?Q?Engagement Letter =e2=80=94 ...` with literal spaces
inside the Q-encoded section — that's invalid per RFC 2047.

**Root cause:** denomailer 1.6.0 (Deno SMTP library used in the
send-via-outlook function) has a broken Q-encoder for non-ASCII
headers AND a broken multipart/alternative builder when
content + html + attachments are all set. Several attempted
workarounds didn't fix it:
- ASCII-sanitise the subject (replaces em-dash etc with hyphens) — kept
- Wrap HTML in full `<!doctype html>` doc with charset — kept
- Switch attachment to base64 string + encoding: 'base64' — kept
- HTML-only mode (skip content when html is set) — kept but still broken

**Next step (mid-flight when this doc was written):** rewrite the
function using raw SMTP (`Deno.connect` + `Deno.startTls` + raw MIME
string built manually) so we control every byte. Skip denomailer
entirely. About 80 lines of code.

Pseudocode:
```ts
async function rawSmtpSend(host, port, secure, user, password, from, to, mimeMessage) {
  const conn = secure ? Deno.connectTls(...) : Deno.connect(...);
  // read 220 greeting
  // EHLO
  // STARTTLS if !secure → Deno.startTls(conn, {hostname: host})
  // EHLO again
  // AUTH LOGIN → base64(user) / base64(password)
  // MAIL FROM:<from>
  // RCPT TO:<to>
  // DATA → mimeMessage + \r\n.\r\n
  // QUIT
}

function buildMime({ from, to, subject, html, attachments }) {
  const boundary = `=_b_${Date.now()}=`;
  // Headers with Content-Type: multipart/mixed; boundary="..."
  // Part 1: text/html; charset=UTF-8 + base64-encoded html
  // Part N: each attachment with proper Content-Disposition + base64
}
```

### #2 — OCR invoice misread

User reported one specific invoice wasn't read correctly by the scanner.
**Need from user:** the offending invoice file (PDF / JPG) dropped at
the project root, plus what was wrong (vendor name? amount? Greek
chars?). Without the file we can't diagnose.

### #3 — Editable preview before send (task #94)

Both EngagementLetterBuilder and SendPendingEmailsModal currently fire
emails without a review step. The user wants a preview-and-edit modal
between "click Send" and the actual dispatch so subjects / body /
attachment list can be tweaked. Not started.

### Minor / deferred

- Backend role gates for client delete / merge (UI gate already in
  place, defence-in-depth follow-up).
- TD63 payroll-certificate-specific OCR extraction.
- Retry-failed action on scan batch.
- Server-side merge of split PDFs.
- Quarterly VAT date calculation refinement (works via `active_months`
  but could be more ergonomic).

---

## 7. Conventions / what to do

- **Commit messages**: 1-line subject + blank line + paragraph body
  explaining the WHY. Co-author trailer is
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Don't push to remote unless asked** — but for this user, push is
  expected after most commits. They've been opting in throughout.
- **Migrations are run by the user** in the Supabase dashboard. Write
  the migration, commit it, push, then say "Run migration NNN in
  Supabase." Wait for "ran NNN" before continuing.
- **Edge Functions are deployed via the Supabase Dashboard** by pasting
  in the updated code (Verify JWT OFF). The user does this manually
  each time we change one. Tell them clearly when a function changes
  and needs re-deploying.
- **Type-check** with `npx tsc --noEmit` before committing. There's
  one persistent harmless warning about `Roboto-Regular-normal.js`
  having no `.d.ts` — ignore it.
- **PowerShell + Bash both available**. Bash is more ergonomic for
  multi-line commands and is what's been used throughout.
- **The font registration pattern** (`registerRobotoFont(doc)` after
  `new jsPDF()`) is required for ANY PDF that may contain Greek
  characters. Don't try to register globally.
- **For new client-facing pages** that need to be public (no auth),
  add the route under `Always-public routes` in `src/App.tsx`
  (currently `/tax`, `/privacy`, `/signup`, `/accept-engagement/:token`).

---

## 8. User profile (what to remember about Panayiotis)

- Cyprus accountant, owner of PC Prime & Calculate Consultants Ltd.
- Email: `psavvas1974@gmail.com`. Uses **Gmail / Google Workspace** for outbound (NOT Outlook — even though the legacy function is called `send-via-outlook`).
- Terse and fast-moving. Asks for what he wants, expects me to ship.
- Prefers short, actionable replies and concrete commit-by-commit progress.
- Direct push to main and migration-on-his-side are the cadence.
- Won't tolerate big plan-mode discussions when there's clear work to do.
- Tests in production / on the deployed app, not locally.
- When something doesn't work, give a focused diagnostic checklist
  (3 things max) so he can paste back the answer that matters.

---

## 9. What the user is most likely about to ask

In rough priority based on recent conversation:

1. **Fix the email gibberish.** This is actively blocking him.
2. **Editable preview before send** for engagement letters (task #94).
3. **OCR diagnosis** for the misread invoice he mentioned a while ago.
4. **Adjustments to existing features** as he uses them with real data.
5. **New features** as new ideas come up (always keep it minimal,
   never over-engineer — he prefers tight, incremental commits over
   big multi-step features).
