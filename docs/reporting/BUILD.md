# PC Prime client reporting platform — build specification

**Read this file completely before writing any code.** It is the specification for a
production build of an application that already exists as a proven single-file
prototype. Nothing here is speculative: every rule, format and figure in this
document was derived from real BTMS exports for real clients and verified against
those clients' own trial balances, VAT returns and payroll reports.

---

## 1. What is being built

One application that produces the monthly reporting, review and audit pack for
**every client whose books PC Prime & Calculate Consultants Ltd keeps in BTMS**.

It is not a per-client build. It is one application that adapts to each client
through configuration: a chart of accounts, a mapping onto a shared master report
structure, and a set of feature switches. Adding a client is a data exercise, not
a code change.

Three jobs, in order of importance:

1. **Review** — find the errors, duplications and omissions in the client's books
   *before* anything is reported to them, with enough reference detail that a member
   of staff can find the item in BTMS and correct it.
2. **Report** — produce the management pack: profit and loss, balance sheet, cash
   flow, VAT, payroll, stock, debtors and creditors, sales analysis, budgets.
3. **Audit** — a monthly audit review with materiality, testing and signed-off
   working papers.

### The overriding rule

> **The application must never mix up client data or client information.**

This is not a preference. It is the requirement that outranks every other
consideration in this document, and it drives several decisions that would
otherwise look over-engineered: row-level security in the database rather than
filters in the application, a client chosen at sign-in and fixed for the session,
and account-code fingerprinting on every file that is imported.

---

## 2. Ground rules

- **BTMS is the book of record.** The application never issues an invoice number,
  never writes back to BTMS, never invents a posting. It reads exports.
- **No figure is ever keyed by hand** except a budget, which is entered
  deliberately after discussion with the client, and the client's own particulars.
- **Every figure must be traceable** to the posting behind it: journal, journal
  number, batch, account, date, reference.
- **A check that cannot be made honestly is not made.** If a test would produce a
  misleading result on a client's data, say so on screen rather than showing a
  number that looks like a finding. (Worked example: document-sequence testing on
  a client whose sales references are rolling POS numbers produces thousands of
  false "missing" invoices. That test is disabled for such clients and the reason
  is shown.)
- **Reports carry their reconciliation with them.** A statement that has not been
  proved against the trial balance says so.

---

## 3. Stack and layout

This is being built **inside the existing PC Prime portal repository**
(`C:\DATA\PCPrimeAPP`), not in a new project. Match what is already there.

| Layer | What the repo already uses — do not change it |
|---|---|
| Database, auth, storage | **Supabase**, one project, shared with the portal |
| Front end | **Vite + React 19 + TypeScript**, Tailwind v4, deployed on **Vercel** |
| Client | `@supabase/supabase-js` v2 |
| Charts | Inline SVG, no charting library — the prototype's charts are self-contained and port directly |
| File parsing | Supabase **Edge Function** under `supabase/functions/` |

**Migrations are numbered sequentially.** 189 was the last before this work;
the reporting schema is **190** and **191**. Anything further continues at 192.

### Why one Supabase project and two front ends

The reporting application shares the portal's **single** Supabase project and its
own **`reporting` schema**, and reuses the portal's access model wholesale.

- **One database**, because two databases means two client registers and eventually
  a mismatch. The client master lives once, in `public.clients`.
- **One access register.** The portal already has `public.user_clients` and
  `public.user_can_access_client(bigint)` — admin-or-linked. Every reporting policy
  defers to that function. **Do not create a second table of who may see which
  client**: two registers is precisely how the wrong client's data reaches a screen.
- **`public.clients.id` is `bigint`**, not uuid. Every `client_id` in the reporting
  schema is `bigint references public.clients(id)`.
- The portal's client register already holds name, trading name, tax number, VAT
  number, registration number, employer number, social insurance number, contact
  person, director, business type, services and monthly fee. **Company setup reads
  those from `public.clients` and never re-keys them.**
- Ship it as its own route tree in this repo. Whether it is later split to its own
  subdomain is a deployment decision, not a schema one.

### Where things go in this repo

```
supabase/migrations/
  190_reporting_core.sql        # applied and tested — schema, RLS, commit_ledger_import
  191_reporting_modules.sql     # applied and tested — review, VAT, payroll, stock, budgets
docs/reporting/
  BUILD.md                      # this file
  prototype.html                # the working prototype — read it, do not port it verbatim
  isolation_test.sql            # the P0 acceptance test — it already passes
supabase/functions/
  reporting-import/             # receives an upload, parses, fingerprints, stages, commits
  reporting-checks/             # re-runs the review engine after every commit
src/
  reporting/
    pages/                      # one per screen in section 8
    lib/btms/                   # the parsers — see section 6
    lib/reports/                # report-line aggregation, comparatives, period logic
    lib/checks/                 # the review engine
```

## 4. The reference prototype

`docs/reporting/prototype.html` is a **complete, working, single-file
implementation** with two real clients embedded, and it is the
best specification of intended behaviour that exists. Open it, sign in as either
client, and use it before building anything.

It is a prototype in exactly two respects: the data is embedded as JSON rather than
queried, and the per-user state (review sign-offs, notes, budgets, mappings, company
record) sits in browser storage rather than in Postgres. **Everything else — the
layout, the wording, the checks, the reconciliations, the arithmetic — is the
specification.** Port the logic; do not re-derive it.

---

## 5. Data model

`190_reporting_core.sql` and `191_reporting_modules.sql` are in
`supabase/migrations/`. **Both have been applied against a stub of the portal's own
schema and run clean.** Read them before writing anything that touches the database.

Core tables from `190`:

`client_settings` · `coa_accounts` · `templates` · `report_lines` · `mappings` ·
`imports` · `postings` · `postings_staging` · `balances_monthly` · `trial_balance` ·
`period_status` · `audit_log`

Added by `191`:

`company_record` · `exceptions` · `exception_signoff` · `exception_queries` ·
`report_notes` · `budgets` · `vat_periods` · `vat_returns` · `payroll_periods` ·
`payroll_lines` · `stock_valuations` · `feed_status`

### The three names a client has

`193` adds `btms_company_code`, `btms_company_name` and `report_name` to
`client_settings`, because the portal's register and BTMS do not agree on names and
never will — the register carries the legal name a client is invoiced under, BTMS
carries whatever the company was set up as, years ago, by whoever set it up.

| | Holds | Used for |
|---|---|---|
| `public.clients.name` | The register. | Who a report is addressed to. |
| `btms_company_code` | BTMS's own company code. | **The** identifier tying the two systems together. Unique where set. |
| `btms_company_name` | Exactly as BTMS prints it. | Choosing the right company when exporting; checking a file that *does* carry a name. |
| `report_name` | What to print on the face of a report. | Null means use the register's name, which is the right default. |

The link between the two systems is a **code, recorded once** — never a name match.
Name matching across two registers is how the wrong client's ledger ends up on the
wrong screen. `193` is itself the warning: its first draft matched
`'ANTONIS & FOULIS ELECTRAGORA%'` and silently matched nothing, because the register
holds that client in Greek, and a *second* client's name differs from it only after
the first two words.

Account-code fingerprinting (§7.2) stays the control on import. The BTMS name is a
second, cheaper check for the files that do name a company, and the answer to "which
company do I pick in BTMS for this client".

### Row-level security — non-negotiable

Every table carrying `client_id` has RLS enabled and a single policy:

```sql
create policy client_scoped on <table>
  for all using (public.user_can_access_client(client_id))
  with check (public.user_can_access_client(client_id));
```

That function is the portal's own, `security definer`, admin-or-linked through
`public.user_clients`. There is **no service-role query path in the application**. A
query that forgets its client filter returns **zero rows**, not another client's
ledger.

Payroll carries one further grant: `public.user_clients.payroll_access`, added by
191, gating `payroll_periods` and `payroll_lines` through `has_payroll_access()`.

**The acceptance test already exists and already passes** —
`docs/reporting/isolation_test.sql`. It asserts three things as a user granted
client A: an unfiltered select on `postings` returns only A's rows; selecting
`where client_id = <B>` returns **zero rows rather than an error**; and an insert
against B is refused. Run it after any change to a policy, and extend it to each new
table as it is added.

---

## 6. BTMS file formats — hard-won parsing rules

Export everything as **"Microsoft Excel 97-2000 — Data only (XLS)"**. The standard
Excel export is a 66-column picture of the printed report and is unusable. PDF is
kept only as the evidence copy (it is the only export carrying the client name).

### 6.1 Analytical journal listing — the audit trail, the primary feed

**This report is grouped by JOURNAL, not by account.** It has no `Account :-`
section headers — that is the *Detail Ledger*, a different report that this feed
replaces. Every posting row carries its own account code and name as columns.
Getting this wrong is what makes an import fail with "a posting appears before any
account section" and then, as a consequence, "the file carries no account codes at
all".

**Where it is in BTMS:** Reports → Journal Listing. Report Type **Analytical** ·
Journal Class **All** · Journal Type **Normal** · Journal Origin **All** · Status
**All** · Ranges: Period from/to (a full year is fine) · New Page **unticked** ·
Show: **T-Analysis ticked** (without it there are no project or expense tags and
project costing cannot be built) and **Reverse Entries ticked**. Export as
"Microsoft Excel 97-2000 — Data only (XLS)".

**Row types.** Column 0 identifies each one:

| Row | Column 0 | What the other columns hold |
|---|---|---|
| Journal header | `Journal: ` | 1 `SIN  -  Sales Invoices` · 3 journal class · 5 VAT type (`Input`/`Output`/`None`) · 7 origin |
| Journal instance | `Journal No:  ` | 1 journal number · 3 posted `Yes`/`No` · 5 origin · 7 period · 9 year · 11 total debits · 13 total credits · 15 the user who entered it |
| **Posting** | a **number** (the batch number) | see below |
| Journal control total | `Totals For Journal  No : ` | 1 journal number · 2 debits · 3 credits · 4 VAT |
| Journal-code total | `Totals For Journal  : ` | 1 journal name · 2 debits · 3 credits |
| Footer | `Page -1 of 1` | — |

**Posting row columns:**

| Index | Contents |
|---|---|
| 0 | batch number |
| 1 | reference (`SI63027388`, `360883`, …) |
| 2 | transaction date, Excel serial |
| 3 | **account code** |
| 4 | **account name** |
| 5 | debit |
| 6 | credit |
| 7 | narrative |
| 8 | VAT code — **present on the base line only**, blank on the control and VAT legs |
| 9 | VAT rate |
| 10 | VAT amount (0 on rows that carry no VAT) |

**Rows that must be skipped or they corrupt everything:**

- Both `Totals For Journal` rows. Including them produced 134 phantom accounts and
  €1,4m of fake debits in an early build.
- **T-Analysis tag rows.** With T-Analysis ticked, a tag appears as a row with
  **two or fewer filled cells and no account code**. It attaches to the posting
  above it — first tag is the project, second the expense category. Numeric tags
  such as `002` otherwise parse as dates and produce phantom 1900-01-01 postings.

**Two checks the file proves on itself, and both must be enforced at import:**

1. Debits equal credits across the whole file. They will not if BTMS truncated the
   export — it paginates, and a truncated file is the single most dangerous input
   this application can accept.
2. Every `Totals For Journal No` row agrees with the postings beneath it. This is
   BTMS's own control total, per journal, and it catches partial parses that still
   happen to balance.

**A working parser is in the repo: `src/reporting/lib/btms/journalListing.ts`.** It
is type-checked and has been run against the real file — do not rewrite it, extend
it. On A&F 2026 (Jan–Aug) it returns **21.408 postings, 1.206 accounts, debits =
credits = €6.922.666,98, all 1.297 journal control totals agreeing, and 9 unposted
journals**. Unposted journals are a *review finding*, not a parse error: they are
imported and flagged.

### 6.2 Trial balance

Two layouts. Standardise on the one with **debtors and creditors in detail**, not
control totals. Columns: `Code, Name, Type, Opening Bal., Debit, Credit, Closing
Bal.` The last row is `Report Total :`. The residual on the report total is the
prior-year retained earnings, unposted because the audit has not closed and the year
has not been rolled over — **this is expected, not an error**, and the application
must say so rather than flag it.

### 6.3 VAT figures summary

Blocks: an optional `Previous Periods` block, then `Vat Period : mm/yyyy (…)`, each
with `Vat Outputs` and `Vat Inputs` sections listing code, description, rate, base
amount, VAT amount.

**Box mapping, verified against a filed return:**

- Output tax comes from journals whose code **starts with `S`** (`SIN`, `SRT`);
  input tax from everything else (`PIN`, `PRT`, `CAP`, …). Do **not** classify by
  debit/credit sign — a sales return is a debit on a sales journal and belongs on
  the output side, and classifying by sign gets the totals wrong on both sides.
- **Box 1** = output tax on every code except 7 (reverse-charge EU acquisitions).
- **Box 2** = output tax on code 7.
- **Box 3** = 1 + 2. **Box 4** = all input tax. **Box 5** = 3 − 4.
- Reverse-charge codes (7, 9, R) have **no output leg in the journal** — raise the
  notional output equal to the input tax. Codes: 1 standard 19%, 2 reduced 5%,
  3 reduced 9%, 4 EU goods sales, 7 EU acquisitions reverse charge, 9 non-EU reverse
  charge, E exempt, R inland reverse charge, Z/5 zero rated, O outside the scope.
- Prior-period items in the return belong to earlier quarters of the ledger. Compare
  the ledger against the return's **period** figures and show prior-period items as
  a separate reconciling column — comparing against the filed total creates a false
  variance.

### 6.4 Payroll — two reports, each a check on the other

**Cost analysis**: `DEPARTMENT` header, then rows of four column-pairs (earnings,
deductions, contributions, transactions), each period + year-to-date; a summary row
beginning `Earnings` with the department totals and employee count. A final block
headed `* * * * * Totals * * * **`.

**Trap:** the totals block must not be absorbed into the last department. An early
parse did exactly that and doubled the last department's contributions.

**Paysheet listing**: `Employee :` header with `code - NAME`, hourly rate, work
hours, basic salary; rows of three column-pairs; a `Totals` row carrying gross,
deductions, contributions/cost and net.

Cyprus employer rates for the statutory check: Social Insurance 8,8% · Social
Cohesion 2,0% (uncapped) · Redundancy 1,2% · Industrial Training 0,5% · GHS (GESY)
2,9%. Effective rates land within ~0,15 of a point; wider than that is the earnings
cap and is worth showing, not flagging as an error. The **holiday fund does belong**
in the IR.7 declared gross.

### 6.5 Chart of accounts

**Where it is in BTMS:** the account list, exported as XLS. On A&F it is 8.467
accounts and 2,1 MB.

**The header row is offset by two.** Row 0 reads `Phone · Type · Active · Header ·
Report Category · Credit Limit · Disc. %` — seven labels for nine columns, because
the code and the name are not labelled at all. `Phone` names column **2**, not
column 0. Read the columns by position:

| Index | Contents |
|---|---|
| 0 | **account code** |
| 1 | **account name** |
| 2 | phone, on debtor and creditor accounts (`Tel:99850870`) |
| 3 | **type** — `Asset` · `Liability` · `Equity` · `Income` · `Expenditure` · `Debtor` · `Creditor` |
| 4 | active |
| 5 | **header** — 1 means a section heading, not a postable account |
| 6 | **report category** — seeds the suggested mapping |
| 7 | credit limit |
| 8 | discount % |

The last row is `Number Of  Records:` with the count in column 1. It is a footer,
not an account, and it is also a control total: check the parse against it.

**What A&F's chart is made of.** 8.467 accounts, of which 8.113 debtors and 150
creditors — **97,6% is sub-ledger**, one account per customer or supplier. Only
**204** accounts are neither, and those are the chart that identifies the client
(§7.2). Ten are header accounts. Eighteen report categories, and 2.353 accounts
carry none.

**Verified against the ledger.** Every one of the 4.863 accounts posted to across
A&F's six years appears in the chart, with no name disagreeing. 3.604 chart
accounts have never been posted to.

**A file name proves nothing.** Two exports sat side by side named
`a&f chart of accounts.xls` and `antonis foulis - chart of accounts.xls`, which
read like two clients and are one: the second is a strict subset of the first,
8.462 of 8.467 codes, no name differing, the five extra being customers opened
between the two exports. The register also holds a *different* client whose name
begins the same way (§5).

### 6.6 Stock valuation and bank statements

Stock valuation is compared against the stock account in the ledger at the same
date; the two rarely agree and the gap changes sign, which must be resolved before a
gross margin is reported. Bank statements import as **ISO camt.053 XML**. Supplier
statements are reconciled manually with the PDF attached as evidence — layouts
differ too much per supplier to parse, and the creditors ledger is already proved
against the trial balance.

---

## 7. Import pipeline

```
upload → storage → parse → fingerprint → stage → commit → re-run checks
```

1. **The client is already fixed** — chosen at sign-in, held in the session, never a
   dropdown inside the application. A file can only ever land against that client.
2. **Fingerprint before anything is written.** The BTMS ledger, trial balance, stock
   valuation and chart of accounts carry **no client name anywhere in the file**.
   Match the account codes in the file against `coa_accounts` for the session's
   client. Refuse the file if the overlap is below a threshold. (Two real clients
   share zero codes out of 3.109 and 154 — the test is decisive in practice.)
3. **Stage, then commit.** `postings_staging` → `commit_ledger_import(p_import,
   p_allow_loss)`, which replaces **only the months the file covers** and blocks a
   commit that would produce a net loss of postings unless explicitly allowed.
   (This exists because a real import once replaced an entire ledger with one month:
   BTMS paginates, and an Excel export captured page one only — 7 postings.)
4. **Record the import**: file name, byte size, sha256, months covered, rows,
   debits, credits, user, timestamp. `feed_status` is derived from this and drives
   the Data import screen.
5. **Re-run the review engine** on every commit. Exceptions are regenerated, and a
   sign-off keyed to an exception that no longer exists simply disappears — which is
   the required behaviour: *a corrected item drops off the list at the next import.*

---

## 8. Screens

Grouped exactly as the left rail groups them. Each names its source and the
condition that must hold.

### Reports

| Screen | Source | Must hold |
|---|---|---|
| **Overview** | report lines | Period selector (single month / year to date / quarter / full year / from–to) drives everything on the page. Tiles: revenue, gross profit, overheads, profit before tax, owed to you, you owe, cash. Charts offer line/bar and 2/3/5-year comparison. |
| **Management report** | report lines | Months across, each line as value **and % of sales in an adjacent column** — never a separate view. Month headings frozen on vertical scroll; description column frozen on horizontal scroll. |
| **Profit & loss** | report lines | Period and period-comparison selection, for discussion with management. |
| **Balance sheet** | report lines | As-at selector, comparative (prior year / prior month), and the net-assets-less-equity check line. |
| **Cash flow** | postings + opening balances | Indirect statement reconciled to the bank movement, plus monthly cash movement: bank balance, deposits, bank payments, cash payments. Every period must reconcile to zero. |
| **Expenses** | report lines | Same period selection as the rest. |
| **Sales analysis** | postings | Net sales from revenue accounts; customer analysis from sales journals on customer accounts (invoiced **including VAT** — label the difference, never mix them). Invoices, average invoice, credit notes, top customers, lapsed customers above a threshold, month-by-month with margin. |
| **Budget** | `budgets` | Entered **manually after discussion with the client**. Nothing auto-generated. Copy prior-year figures, adjust by hand, clear all. Actual against budget with variance. |

### Ledgers

| Screen | Source | Must hold |
|---|---|---|
| **Statements** | postings | One customer or supplier: balance brought forward, every movement, balance carried down. Must tie to the ageing at the same date and say so on the page when it does not. |
| **Account movements** | `balances_monthly` | Every nominal account, period and prior-period movement, and the report line it maps to. Unmapped accounts flagged — they would silently vanish from the statements. |
| **Transactions** | postings | The whole journal, searchable by account, reference or narrative; filters for period, journal type and size. |
| **Debtors & creditors** | postings | Ageing **oldest-first** (BTMS carries no allocation between receipt and invoice — ask BTMS for an allocations export). Month-by-month history, statistics for discussion, and problem accounts flagged on four tests: over 90 days, wrong-side balance, grew on the month, no movement for 90+ days. |
| **Stock** | `stock_valuations` | Valuation against the ledger account at each date; negative quantities listed. |
| **Payroll** | `payroll_*` | Department and employee analysis; the two BTMS reports set against each other; contributions against statutory rates. |
| **VAT** | postings + `vat_returns` | Boxes rebuilt from the journal; **attach the return as filed** per quarter and flag every variance box by box. A quarter with no return attached is shown as computed but untested. |

### Review

| Screen | Must hold |
|---|---|
| **Needs attention** | Every exception with journal, journal number, batch, account and report line so the item can be found in BTMS. Tick to clear **with a reason**; a cleared item is struck through and drops off at the next import once corrected. A free-text **note to raise with the client** on any item, with a filter to work through them on the call. |
| **Monthly audit** | Materiality with selectable benchmark and performance-materiality factor; analytical review; journal-entry testing by journal type; items above performance materiality listed for vouching; cut-off testing either side of year end; a test log that becomes the working paper, signed by preparer and reviewer. |

### Configure

| Screen | Must hold |
|---|---|
| **Data import** | Every feed: purpose, frequency, last file, **when it was uploaded and how old that is**, period covered, status. Month-by-month checklist. Working-ledger panel. Reconciliation: journal balances on its own **and** agrees to the trial balance, account by account, with the differences listed. |
| **Account mapping** | Each account against the master report lines, overridable, with a changed-from-default count and a reset. Changes are audit-logged against the user. |
| **Company setup** | The client's particulars, and **which BTMS company the books are kept in** — the code from §5, the only field that ties this client to an export. The client's particulars: Identity, addresses, contacts, statutory dates, partner, manager, engagement and fee are **read from the portal's client register** — one source, never keyed twice. Only the accounting-specific fields (VAT period, basis of records, bank accounts, stock count date, preparer, reviewer) are held here. |
| **Client setup** | The feature switches and what each section gives this client. |

### Feature switches

`pl · bs · summary · budget · cash · cashmove · expenses · sales · stock · ledgers ·
stmt · trans · accounts · vat · payroll · projects · review · audit · mapping · data`

A switched-off section is hidden from the rail, and a rail group with nothing
switched on disappears entirely.

**Project costing** (`projects`) is driven by the BTMS T-Analysis tag: income and
expenses allocated to a project. Not every client uses it.

---

## 9. The review engine

Checks currently implemented and proven on real data. Each produces an exception
carrying severity, month, account, report line, journal, journal number, batch,
reference, amount and a description.

1. Trial balance does not agree to the ledger for the month
2. A month is missing from a feed that is due
3. Unclassified or unmapped cash
4. A balance on the suspense account
5. Revenue posted outside the sales module
6. A debtor or creditor balance on the wrong side
7. An unmapped trading account
8. **Duplicate postings** — collapse by (date, reference, amount) so the two legs of
   one entry are not counted twice, **then test for an existing reversal**. On real
   data this demoted 38 of 58 duplicate events to low severity. A duplicate that has
   already been reversed is not a finding.
9. Balances over 90 days
10. A posting with no VAT code on a VAT-bearing account
11. An unposted journal inside a reported month
12. A journal whose own debits and credits do not agree

Every exception must be reproducible from the posting reference. An exception that
cannot be found in BTMS from what is on screen is a defect.

---

## 10. Acceptance fixtures

These are real, verified figures. Load the A&F files from the CLIENTS DATA folder
into a test project and assert against them. **If a build does not reproduce these,
it is wrong.**

**Ledger, journal listing feed** — A&F 2026 (`a&f journal lisitngs 2026.xls`,
Jan–Aug 2026): **21.408 postings, 1.206 accounts, debits = credits =
€6.922.666,98**, all **1.297** per-journal control totals agreeing, 9 unposted
journals. Six files cover 2021 to 2026.

**Ledger, detail ledger feed (superseded)** — 84.725 postings, Jan 2024 – Jul 2026,
3.152 accounts. Debits equal credits to zero across all 31 months. Kept as a
cross-check only; the journal listing is the feed.

**Trial balance, July 2026** — journal movement €1.090.459,41 each side against a
trial balance of €1.090.456,09. Exactly **one** account differs: `7281 Electricity
and Heat`, €3,32 on both the debit and the credit side (a contra pair the trial
balance nets out). Every other account ties. The application must find this and
describe it correctly.

**VAT, Q2 2026** — boxes 1, 2 and 3 agree to the return **to the cent** from either
feed: **€82.324,60 · €9.424,47 · €91.749,07**. Box 4 does not, and the two BTMS
exports do not agree with each other either:

| Source | Box 4 |
|---|---|
| Rebuilt from the **journal listing** | €64.100,63 |
| Rebuilt from the **detail ledger** | €63.847,22 |
| The **return as filed** (period only) | €64.914,16 |

So the journal listing finds €253,41 of input tax the detail ledger misses, and is
still €813,53 short of the return. Unposted journals are not the cause — none fall
in Q2. This is a real open item, not a parsing defect, and the application must show
it rather than reconcile it away. Prior-period items of €708,61 net are a separate
reconciling column. Amount filed and paid: €27.543,52.

**Payroll, August 2026** — 6 employees, 4 departments. Gross €10.994,28, deductions
€1.505,20, employer contributions €1.785,27, net €9.489,08, **cost to the company
€12.779,55**, matching the wages journal exactly. The department analysis, the
employee analysis and the report totals all reach €12.779,55 independently.

**Debtors at 31 July 2026** — net €22.589,33, of which €170.484,17 is owed and
€147.894,84 sits as credit balances on 105 customer accounts. 48% of what is owed is
over ninety days. Creditors net €184.346,38 across 38 accounts. Both tie to the
trial balance to the cent.

**Sales, Jan–Jul 2026** — net €989.571, +11,8% on the same period a year earlier,
gross margin 28,3%, 1.600 invoices at an average of €676,79 including VAT.

---

## 11. Build order

Each phase has a definition of done. Do not start the next until the current one
passes.

**P0 — Isolation.** *Already done.* Migrations 190 and 191 apply clean and
`docs/reporting/isolation_test.sql` passes. Re-run it before starting P1 to confirm
it still passes against the live project, then extend it to cover `trial_balance`
and `exceptions` too.

**P1 — Import.** Journal listing and trial balance parsers, fingerprinting, staging,
`commit_ledger_import`, `feed_status`. *Done when the A&F 2024, 2025 and 2026 files
import and reproduce the ledger fixture in section 10, and a file fingerprinted to
another client is refused.*

**P2 — Structure.** Chart of accounts import, master report lines, mapping with
overrides and audit log. *Done when all 88 A&F control accounts map with zero
unmapped and the balance sheet's net-assets check is zero.*

**P3 — Reports.** Overview, management report, P&L, balance sheet, cash flow,
expenses, sales analysis, budget. Period selection and comparatives throughout.
Frozen headings and frozen description column. *Done when the sales and margin
fixtures reproduce.*

**P4 — Ledgers.** Statements, account movements, transactions, debtors and
creditors, stock, payroll, VAT with return attachment. *Done when the VAT, payroll
and ageing fixtures reproduce, including the €1.066,94 variance.*

**P5 — Review and audit.** The twelve checks, sign-off with reason, discussion
notes, the reconciliation screen, materiality and working papers. *Done when the
July 2026 trial balance difference is found and correctly described, and a corrected
item drops off at the next import.*

**P6 — Client access.** A second RLS policy set and a read-only client view of
finished packs, surfaced through the portal.

---

## 12. What not to do

- Do not build a per-client report. Everything goes in the template, switched by
  feature flag.
- Do not filter by client in application code and call it isolation. RLS or nothing.
- Do not offer a client dropdown inside the session. Sign out to change client.
- Do not auto-generate a budget from prior-year actuals. Copy-then-edit only, and
  only when a person asks for it.
- Do not net reverse-charge VAT codes to zero. Gross both legs.
- Do not classify VAT by debit/credit sign. Classify by journal type.
- Do not compare the ledger to a VAT return's filed total. Compare to its period
  figures and show prior-period items separately.
- Do not show a check whose result is not meaningful for that client. Explain why it
  is off.
- Do not keep anything load-bearing in browser storage. The prototype does; the
  build must not.
- Do not write packages, installers or scratch files into a client's data folder.

---

## 13. Still outstanding

- Ask BTMS for an **allocations export** linking receipts to invoices — ageing stays
  oldest-first until it exists.
- Ask BTMS for an **Excel/CSV export of the payroll calculation listing** — payroll
  currently arrives as printed PDFs for some reports.
- Confirm the bank statement format in production (**camt.053** assumed).
- **Get A&F's BTMS company code.** `193` records the BTMS *name* and deliberately
  leaves the code null: a made-up code would look authoritative, and the unique index
  would then hand it to the first client whose real code collided with the guess.
  Until Company setup is built (P2), codes are set by SQL.
- The master report-line list has been drafted from A&F's chart of accounts
  (`PCP master report lines - draft v1.xlsx`, 87 lines, 206 accounts mapped) and is
  awaiting Pete's mark-up before it is frozen as the shared template.
- `regenerate_exceptions()` in 191 is deliberately a stub: the twelve checks are
  listed as comments and are written in P5, against real posting tables rather than
  copied from a prototype and never run.
