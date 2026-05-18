# Backlog Review — 2026-05-18

Structured review of `future-roadmap.md` (Prompt 2). Planning only — no code changed.
Roadmap has **29 items** across the dated sections.

---

## A) Items grouped by value/effort + B) dependencies

### 🟢 Quick wins — high value, low effort

| Item | Dependency |
|---|---|
| CloudMailin — take account live (#26) | Independent. Unblocks the already-built calendar email — emails currently send but don't deliver. |
| Supabase CLI — native Windows install (#25) | Independent. Enabler — unblocks deploying Edge Functions locally. |
| Sentry frontend error tracking (#21) | Independent. ~30 min. |
| CloudMailin API key rotation (#28) | Independent. Security hygiene. |
| `pdfRenderer.ts` type errors (not on roadmap — see C) | Independent. |

### 🔵 Major projects — high value, high effort

| Item | Dependency |
|---|---|
| Automated Tests (#24) | Independent. Roadmap calls it "highest single technical risk." |
| Phase 2 RLS Migration (#23) | Independent. Deferred by user (2026-05-09); go-live-relevant. |
| Email Integration — inbound (#20) | Dependent on CLI / Edge-Function deploy. (Outbound is now done — see D.) |
| Force MFA at signup (#22) | Independent. Medium effort. |
| Branded email layouts (#29) | Dependent on #26 being live. |

### 🟡 Polish — low value, low effort

| Item | Dependency |
|---|---|
| Email subject polish — "Meeting: Meeting" (#27) | Independent. ~5 min. |
| Data Anonymization (#15) | Independent. |
| Bulk Import `is_vendor` column (#18) | Independent. Roadmap itself marks it low priority. |
| Drop legacy address columns (#17 — needs re-scoping, see D) | Dependent — verify all readers first. |
| Smart Import — director rows (#19) | Dependent on the `smart_import` RPC. |

### ⚪ Defer — post-go-live / SaaS-pivot phase

High effort; value is real but future, not "low". All independent of each other; none block go-live.

Multi-Window Tabs (#1), Helpdesk/Tickets (#2), Schedule Hub / 2-way Google Calendar (#3),
Proposals & Engagement Letters (#4), Form Flow / Lead Capture (#5), Customer Portal
Self-Service (#6), Workflow Automation (#7), AI Email Replies (#8), AI Invoice
Categorisation (#9), AI Compliance Flags (#10), Rate Card Module (#11), Contracts Module
(#12), Projects Module (#13), Customer Statements (#14), Multi-Currency (#16).

---

## C) TODOs / FIXMEs / dead code in the codebase

- **No `TODO`/`FIXME`/`HACK` markers** of substance anywhere in `src/` — the codebase is clean on that front.
- **One real known issue, not on the roadmap:** `src/services/ocr/pdfRenderer.ts` has **2 TypeScript errors** (pdfjs-dist v5 `canvas`/`RenderParameters` mismatch). They have been present and silently filtered out of every type-check. Recommend adding to the roadmap and fixing — a type error in production code is a latent risk.
- The previously-"deferred" stub functions in `api.ts` (`importExcel`, `mergeClient`, bulk-import) are gone — built or removed.

---

## D) Roadmap items already done / needing update

- **#20 Email Integration (CloudMailin)** — the **outbound** half is now built + deployed (the `send-email` function + calendar notifications). Only the **inbound** half (receiving client email) remains. Action: split the entry — outbound = done (pending the delivery fix in #26); inbound = still pending.
- **#17 Drop Legacy Address Columns** — `clients.city` is now actively synced from `client_addresses` (migration 066) and used by the Clients list. It is no longer a "drop" candidate. Action: revise — only `clients.address` / `postal_code` / `country` remain droppable.

---

## E) Recommended order — top 10

Given the context (testing → internal go-live → later SaaS pivot), prioritise go-live readiness:

1. **CloudMailin — take live + fix delivery (#26)** — the calendar email is built but not delivering; finish it or it's dead weight.
2. **Supabase CLI native install (#25)** — small; needed to deploy the inbound-email function and any future ones.
3. **`pdfRenderer.ts` type errors (C)** — clear the standing type errors so the build is genuinely clean.
4. **Sentry error tracking (#21)** — see production errors before real client data lands.
5. **Phase 2 RLS Migration (#23)** — security rules should be correct/granular before real data; revisit now go-live is close.
6. **Automated Tests (#24)** — start a smoke-test baseline on critical paths (auth, client CRUD, invoicing).
7. **Force MFA at signup (#22)** — lock down auth for the internal go-live.
8. **Pre-go-live checklist** (`project_go_live_checklist.md` — PITR, Supabase DPA, EU region, staging project).
9. **Quick hygiene bundle** — CloudMailin key rotation (#28) + email subject polish (#27).
10. **Drop legacy address columns (#17, revised)** — low-urgency cleanup.

Everything in the ⚪ Defer bucket comes after internal go-live — once the firm is running day-to-day on the portal, real usage will show which modules earn their place (and which matter for the SaaS pivot).
