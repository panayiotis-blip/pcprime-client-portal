> **`STATUS.md` is the record of what exists.** All four work orders are built;
> this file is kept for what it asked for and why.

> **`STATUS.md` says where the build stands.** This file is a work order that is
> finished: §0–§5 are all built and deployed. It is kept as the record of what was
> asked for and why.

# The fix order — read this before BUILD.md, STATUS.md or NEXT.md

This file outranks the other three. Do what is in here, in this order.

The partner's own words, which are the whole specification:

> I want an app like the one we designed for the reporting and internal audits,
> and I want to be able to upload data. It must tell me what data is uploaded and
> allow me to add new data to it. If I upload the same month or period or
> whatever, it must give me a warning and allow me to override the old upload.
>
> All I wanted extra, so as to avoid confusion, was to save the client CSV file
> for the data in the client's folder on the portal. In that BTMS folder I wanted
> subfolders for journal listings, for ledgers, for TB and whatever other reports
> like payroll. It would be easier to ID the reports if I selected the type of
> report and the period I was saving — easier for the app to upload from.

Nothing more than that. Five things: **one app · upload in it · it says what is
loaded · a warning and an override on a repeat · the files kept in the client's
folder, in subfolders, tagged with type and period.**

---

## 0. Ship what is already written — this is why the screen still looks old

Sections 1 to 4 are **done and committed**, and none of it is on the live site.
`git status -sb` reads `main...origin/main [ahead 9]`. Vercel deploys from
`origin/main`, which is still on `f52043b`.

The migrations were applied straight to Supabase, so the ten subfolders appear in
the portal — but `ClientDocuments.tsx`, which puts the BTMS feed list and the
per-feed period control inside those folders, has never been served. That is the
whole reason the upload box still offers Invoice, Credit Note, Receipt and a plain
month box.

**Push `main`, let Vercel build, then look again.** Nothing in §1–§4 needs
rewriting; verify against their acceptance tests once the build is live.

---

## 5. Scope the feed list to the subfolder it is opened in

Real, and separate from the deploy. `ClientDocuments.tsx` renders the whole of
`BTMS_FEEDS` in every folder whose `category_key` starts with `btms`. So standing
in **Journal listings**, under a heading that says *Upload to "Journal listings"*,
a person can pick "Payroll cost analysis" — and `btms_folder_for` will quietly
file it under Payroll instead. The heading and the list disagree.

The subfolder already is the report type. Say so.

Add a `folder` to each entry in `src/reporting/upload/feeds.ts`:

```
btms_ledger    Analytical journal listing
btms_detail    Detail ledger
btms_tb        Trial balance, monthly · Trial balance, annual
btms_coa       Chart of accounts
btms_vat       VAT figures summary · VAT return as filed
btms_payroll   Payroll cost analysis · Payroll paysheet listing
btms_stock     Stock valuation
btms_sales     Sales invoice listing
btms_bank      Bank statement (XML)
btms_other     Other / supporting document
```

Then in the upload form:

- In a **subfolder**, offer only that folder's feeds. Where there is just one —
  Journal listings, Chart of accounts, Stock, Sales, Bank — print the name as
  plain text instead of a dropdown of one, and go straight to the period.
- In the **BTMS data parent**, keep the full list, and say underneath where the
  file will be filed: *"This will be saved in Trial balances."*
- Reset the period whenever the feed changes, as it already does.

**Acceptance:** opening Upload inside Journal listings shows "Analytical journal
listing" and one question — which year the listing covers. Inside Stock it asks
for the count date. Inside Chart of accounts it asks for no period at all. No
folder offers a feed that does not belong in it.

---

## What went wrong

The prototype was never damaged. `public/reporting-template.html` is byte-for-byte
identical to `docs/reporting/prototype.html` — same md5, `a13dfe18…`. Every screen
is still in it, Cash flow, Budget and Monthly audit included.

Four decisions took it apart around the edges:

1. Five sections were **switched off** in `buildPayload.ts`, so their tabs vanish.
2. They were switched off because they were **given no data** — the same file
   passes `[]` and `{}` for cash flow, budget, audit, projects and the whole
   debtor/creditor ageing.
3. The **Upload buttons were cut out** of the Data import table by
   `tools/build-reporting-app.mjs`.
4. **A second application was built in front of the first** — `ReportingApp.tsx`
   and seven page files, with their own rail and their own Data import, reached by
   "Manage the data" and with no way back.

**The rule from here on: there is ONE application, and it is the template.** The
React code signs a person in, picks the client, fetches that client's figures and
hands them over. It renders no screens of its own. If you find yourself writing a
screen in React, you are building the second application again. Stop.

---

## 1. Delete the second application

**Remove** from `src/reporting/pages/`: `DataImport.tsx`, `Reports.tsx`,
`Review.tsx`, `AccountMapping.tsx`, `BuildTemplate.tsx`, `ViewTemplate.tsx`,
`ChooseClient.tsx`, `ChartImportPanel.tsx`, `TrialBalancePanel.tsx`,
`StockPanel.tsx`, `PayrollPanel.tsx`, `FolderPanel.tsx`, `FolderReviewPanel.tsx`,
`MonthChecklist.tsx`, `PortalFolderPanel.tsx`.

**Rewrite** `ReportingApp.tsx` with no left rail, no `Group`, no `Item`. It keeps
the staff guard and the session, and has two routes:

```
/reporting        → ReportHome      (the template, full screen)
/reporting/setup  → ReportingSetup  (many clients at once — the one exception)
```

Delete the "Manage the data" link and the `/reporting/manage` route.

Everything in `src/reporting/lib/` **stays**. The parsers are proved against six
years of real files and against BTMS's own printed totals; they are the code the
template's Upload button will call. Only the screens go.

**Acceptance:** `/reporting` shows the template and nothing else. There is no
second rail anywhere, and no screen a person can reach and not leave.

---

## 2. Give the template the data it is missing, then switch the sections on

`src/reporting/lib/reports/buildPayload.ts`, lines ~444–479. Compute each of
these and set its flag to 1. **Never turn a flag on before its data exists.**

- **Debtors and creditors** — from the postings on the debtor and creditor control
  accounts, aged into the buckets the template already draws, per account, with
  prior months. This is what makes the Overview's "Owed to you" and "You owe" read
  instead of an em dash, and it is the screen that was throwing
  `Cannot read properties of undefined (reading 'map')`.
- **Cash flow** — indirect: profit for the period, adjusted for the movement in
  debtors, creditors, stock and fixed assets, down to the movement on cash and
  bank. It must agree with the balance sheet's own cash figure.
- **Budget** — `reporting.budgets` already exists. Read it. Budgets are **keyed by
  hand after a discussion with the client and never generated**, so the screen
  needs entry, "copy last year" and "clear all", writing back through the host.
- **Monthly audit** — the working papers: the month's checks, who signed each one
  off and when, from `reporting.exception_signoff`, which already exists. A signed
  point is struck through and drops off at the next import.
- **Projects** — leave gated on whether the ledger carries T-Analysis tags. A&F
  has none and the template says so. This one is correctly conditional.

**Acceptance:** A&F shows the same rail as `docs/reporting/prototype.html` —
Overview, Management report, Profit & loss, Balance sheet, Cash flow, Expenses,
Sales analysis, Budget, Statements, Account movements, Transactions, Debtors &
creditors, Stock, Payroll, VAT, Needs attention, Monthly audit, Data import,
Account mapping, Company setup, Client setup — Projects off, every other one
carrying figures.

---

## 3. Upload, inside the app, on the Data import screen

`tools/build-reporting-app.mjs` patch 3 removed the Action column and every
`data-up` button. **Reverse it.** The button was a stub; make it work rather than
delete it.

Keep patches 1 (`D.feeds` — the table shows this client's real files), 2 (`TODAY`
from the clock) and 4 (the ageing guard). Those are right.

**The screen already tells him what is loaded.** The feed table has Feed · What it
is for · Frequency · Last file · Uploaded · How old · Covers to · Status. It works.
Restore the Action column beside it.

**What Upload does, in order:**

1. Posts `{type:'pcp-upload', feed, key}` to the host; the host opens a file
   chooser.
2. **Asks for the period the feed needs** before anything is stored — a year or a
   month range for a journal listing, a month for a trial balance or payroll, a
   quarter for VAT, **the exact count date** for a stock valuation, nothing for a
   chart of accounts. The period and the stock date exist nowhere in the BTMS file
   and cannot be recovered afterwards.
3. **Checks the file before storing it** — parses it, fingerprints its account
   codes against this client's chart of accounts, and reads BTMS's own printed
   control totals. A file that fails is refused with the reason, while the person
   is still at the machine that exported it. It is never stored.
4. **Warns on a repeat.** If this feed already has a file for this period, stop and
   say so, naming the file, when it was uploaded and by whom:

   > **Journal listing, July 2026 is already loaded** — `a&f detailed ledger 01-07
   > 2026.xls`, uploaded 27 Aug 2026 09:14 by P. Savvas.
   > [ Replace it ] [ Keep both ] [ Cancel ]

   **Replace** makes the new file the one the app reads and re-imports that period
   only. **The old file is never deleted** — it stays in the folder, marked
   replaced, as the record of what was reported at the time. A re-export after a
   correction is normal, not an error.
5. Stores it in the client's folder (§4), imports it, and updates the row in place.
   `commit_ledger_import` already replaces only the months a file covers, so
   re-importing one month does not disturb the rest.

**Acceptance:** pressing Upload on "Trial balance, monthly", choosing a file and
answering "July 2026", stores it in the client's folder and moves the row to
LOADED with today's date — without leaving the report. Doing it again with the
same month gives the warning above, and Replace works.

---

## 4. The client's BTMS folder, with a subfolder per report

**One migration, 215.** `public.folders` already has `parent_id`, so this is
folders inside folders and nothing new is needed.

Extend `btms_data_folder(bigint)` (migration 204) so that when it creates or opens
a client's **BTMS data** folder it also ensures these subfolders under it, each
`is_system`, each with its own `category_key`:

```
BTMS data/
  Journal listings      btms_ledger      Analytical journal listing
  Ledgers               btms_detail      Detail ledger, account movements
  Trial balances        btms_tb          Monthly and annual
  Chart of accounts     btms_coa
  VAT                   btms_vat         Figures summary and the return as filed
  Payroll               btms_payroll     Cost analysis and paysheet listing
  Stock                 btms_stock       Valuations, by count date
  Sales                 btms_sales       Invoice listings
  Bank                  btms_bank        camt.053 statements
  Other                 btms_other       Anything kept for the review, not parsed
```

**Type and period name the file, so nothing is typed.** The person picks the
report type and the period; the app writes the `public.documents` row with
`year`, `month` (and a `period_end` date for a stock count), files it in the
matching subfolder, and names it from those. The name is derived, never keyed —
that is what makes a file identifiable, and it is why the app can find the right
one without opening it.

**One store, two ways in.** A file uploaded on the app's Data import screen and a
file filed from the portal's own Documents tab land in exactly the same place,
with the same document row. `portalFolder.ts` is the only code that stores a file.
The five importers stop calling `storage.from('reporting-imports')`; the 17 objects
already in that bucket are moved into their clients' subfolders and the bucket is
left empty.

**Scope the document types to this folder.** Inside BTMS data and its subfolders
the Document Type list is the feeds above, with the period control each one needs.
Every other folder in the portal keeps the general list. Key it off
`folders.category_key like 'btms%'`.

**Acceptance:** opening a client's Documents tab shows BTMS data with ten
subfolders. A journal listing uploaded from inside the report appears under
Journal listings, tagged with its year; a trial balance under Trial balances,
tagged July 2026; a stock valuation under Stock with its count date. Uploading the
same period again warns and offers to replace. `reporting-imports` is empty.

---

## Then, the two remaining things in NEXT.md

The tick on the client record that says whose BTMS a client's books are on, and
the removal of the two bulk buttons on `ReportingSetup.tsx`. Unchanged, still
wanted. §3 of NEXT.md is superseded by §4 above.

---

## Do not touch

- `public/reporting-template.html`. It is the specification. If a screen must
  change, the partner changes the prototype and it is rebuilt from that.
- `reporting.staff_can_access()` / `is_reporting_staff()` — migration 214.
- The VAT sign rule — migration 211.
- `has_stock` / `has_payroll` and their triggers — migration 211.
- Every parser in `src/reporting/lib/btms/`.
