# Future Roadmap

Features captured but **not yet built**. Pull from this list when planning a new task. Status keys: ❌ not started · 🔄 in progress · ⏸ paused.

---

## Deferred from the UI Polish task (2026-05-15)

### Multi-Window Tabs (Phase 6 — E6) ❌

Multi-tab workspace for fast switching between open clients.

- Click "Open" on a client → adds it as a tab at the top of the main content area
- Max 8 concurrent tabs
- Tab shows truncated client name (20 chars) + ✕ to close
- Persisted in user prefs (`user_dashboard_preferences.open_client_tabs` jsonb, or a new column)
- Middle-click → close
- Right-click → context menu: Close · Close Others · Close All
- New per-user setting: "Restore tabs on login" (default: Yes)

**Why deferred**: the existing Prev / Next navigation in `ClientHeader` covers most of the value; the tab UI is its own substantial surface (drag-reorder, persistence, keyboard shortcuts) and deserves its own task.

**Effort**: Medium

---

## Items captured from earlier sessions (not started)

### Helpdesk / Tickets ❌
Internal ticketing for client requests outside the standard task flow.

### Schedule Hub (2-way Google Calendar) ❌
Bi-directional sync between portal Calendar and Google Calendar per staff member.

### Proposals & Engagement Letters Generator ❌
Template-driven generation for new client onboarding documents.

### Form Flow / Lead Capture ❌
Public-facing intake forms feeding directly into the prospects pipeline.

### Customer Portal Self-Service extension ❌
Beyond the current Documents / Invoices read access — let clients upload, comment, request services.

### Workflow Automation ❌
Rule-based "when X happens, do Y" — e.g. auto-create task when invoice scanned.

### AI-Suggested Email Replies ❌
LLM drafts replies based on incoming email + client context.

### AI Invoice Categorisation ❌
Auto-classify scanned invoices into journals/categories beyond vendor patterns.

### AI Compliance Risk Flags ❌
Flag clients with unusual patterns (sudden VAT spike, late filings cluster).

### Services / Rate Card Module ❌
Standalone module for formalised service offerings + price list. Currently per-service rates exist in Company Settings but not a full rate-card.

### Contracts Module ❌
Track engagement contracts, renewal dates, signed copies.

### Projects Module ❌
Group work into named projects spanning multiple clients (e.g. an audit campaign).

### Customer Statement Auto-Generation ❌
Periodic account-statement PDFs sent to clients.

### Data Anonymization ❌
For demo accounts / test exports.

### Multi-Currency ❌
All amounts hardcoded €. Add currency field on clients + invoices + time entries.

### Drop Legacy Address Columns ❌
After migration 049, `clients.address` / `city` / `postal_code` / `country` are deprecated. Once all readers (BulkImportV3, Billing fallback, etc.) use `client_addresses` cleanly, drop them in a follow-up migration.

### Bulk Import — is_vendor column (UI Polish v2, Part 6E) ❌
Deferred from Part 6. Add an `is_vendor` (Y/N) column to the bulk-import template and have the importer set the flag. Needs the `bulk_import_v3` RPC modified (a new migration). Low priority — vendors are added via the invoice-editor quick-create or the Clients-list "Mark as Vendor" bulk action.

### Smart Import — director rows ❌
Deferred from Smart Import Phase 6. The field registry already lets you map director columns (name, role, ID, nationality, shareholding %, appointed date), but the `smart_import` RPC does not yet write them to `client_directors`. To add: per imported row with director data, insert a `client_directors` row (`director_client_id` left null → linked later via the Unlinked Directors tool). Mapped director columns are currently skipped with an on-screen warning at the import step.

### Email Integration (CloudMailin) ⏸
Code shipped, awaiting paid signup + DNS + secrets. See `memory/project_open_followups.md` for the step-by-step.

### Sentry Frontend Error Tracking ⏸
No DSN wired. ~30 min job once you decide on the provider.

### Force MFA Enrolment at Signup ❌
Currently optional. Could be required for internal-firm roles via a trigger or app-level redirect.

### Phase 2 RLS Migration ❌
~15 RLS policies still gate on legacy `is_admin()` / `is_supervisor_or_higher()` rather than `has_permission(...)`. Explicitly deferred by user (2026-05-09).

### Automated Tests ❌
No tests anywhere. Highest single technical risk per the status report.

---

## Captured 2026-05-18

### Supabase CLI — native Windows install ❌
`npx supabase` segfaults on Windows, so `functions deploy` / `functions list`
can't be run locally. Install the native binary instead (Scoop, or a GitHub
release download). **Effort:** 15–30 min. Unblocks local `supabase functions`
commands.

### CloudMailin — take account live ❌
CloudMailin is currently in **Test mode**. Before relying on outbound email:
verify the outbound billing tier, send a self-test to
`panayiotis@primeandcalculate.com` to check rendering, and check spam-folder
behaviour. (Follows on from "Email Integration (CloudMailin)" above.)

### Email subject polish — duplicated title ❌
Appointment notification emails use the subject `Meeting: <title>`; when the
appointment is itself titled "Meeting" it reads "Meeting: Meeting". Cosmetic —
drop or condition the prefix. Low priority.

### CloudMailin outbound API key — rotate ❌
The outbound API key was briefly visible during setup. Low risk (send-only,
private chat) — rotate at convenience: delete + recreate the outbound account
in CloudMailin, then update the `CLOUDMAILIN_OUTBOUND_*` Supabase secrets.

### Branded email layouts ❌
Outbound emails currently send as bare HTML. CloudMailin supports "Default
Layout" templates — wrap transactional emails in a branded layout (logo,
footer, brand colours from `company_settings`).

---

## Accounting — billing module expansion

Captured 2026-05-19. Extends the existing client-invoicing module. Three
phases, planned and built one at a time.

### Recurring invoices ❌
Per-client recurring billing (monthly) for clients invoiced the same each
month. Generates the invoices automatically each period — most likely as
drafts to review then issue. New table + generation logic + UI.

### Receipts ❌
Issue a numbered receipt to the client when an invoice is paid — its own
record, receipt numbering, and a printable template (like the invoice print).

### Statements & age analysis ❌
Printable per-client statement (all invoices + payments, running balance)
and an aged-debtors report (outstanding invoices bucketed current / 30 /
60 / 90+ days). Mostly reporting — the lightest of the three.

---

## Working agreement

### Code-change approval cycle
Required style for any code change: **inspect → propose plan → name the files
that will change → wait for explicit approval**, before editing. A feature
request is not itself approval to start. (Flagged after commit `a4d33bf` was
edited/committed/pushed without it.)

---

## Pre-go-live admin (handled outside this file)

See `memory/project_go_live_checklist.md` for: PITR toggle, Supabase DPA, lawyer T&Cs, custom SMTP for invites, restore drill, separate staging Supabase project.
