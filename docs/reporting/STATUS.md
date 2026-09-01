# Reporting platform — where the build actually stands

Written 1 September 2026, after working through `FIX.md` §1–§4 and re-reading the
live database. `BUILD.md` says what the application is meant to be; `FIX.md` is the
order the work was done in; this file says what exists today.

**`FIX.md` §1–§4 are done, with one exception**: the seventeen objects still sitting
in the `reporting-imports` bucket have not been moved, and cannot be until somebody
supplies a credential. That is the only part of the fix order outstanding.

---

## The shape of the thing now

**There is one application and it is the template.** `ReportingApp.tsx` signs a
person in, holds the session and hands over. It has two routes — the report, and
Reporting setup — and renders no screens of its own.

Fifteen React screens were deleted: `DataImport`, `Reports`, `Review`,
`AccountMapping`, `BuildTemplate`, `ViewTemplate`, `ChooseClient` and the eight
panels. They were a second application standing in front of the first, with its own
rail and its own Data import, reached by "Manage the data" and with no way back to
the report. Everything in `src/reporting/lib/` stayed: the parsers are proved against
six years of real files and against BTMS's own printed totals, and they are what the
template's Upload button calls.

If a screen is wanted it goes in the prototype and the template is rebuilt from it.
Writing one in React is building the second application again.

---

## The foundations are done and proved

Do not rebuild any of this.

- **Schema**: migrations 190–215 applied. 215 went on on 31 August and is in the
  migration ledger — but note the ledger holds only 207 and 211–215, so it has never
  been the record of what is applied. `supabase/migrations/` is.
- **Import**: the journal listing, trial balance, chart of accounts, stock and
  payroll parsers all work. Six years of A&F journal listings are committed.
- **The ledger**: 174.026 postings for Antonis & Foulis, 2021-01 to 2026-08,
  **debits = credits = €62.093.741,48**.
- **Mapping**: 8.467 accounts, every one resolving to a report line through
  `mapping_defaults`. Nothing unmapped.
- **The numbers**: `report_figures` for Jan–Jul 2026 returns revenue €989.570,57 ·
  cost of sales €709.226,32 · gross profit €280.344,25 · overheads €135.033,20 ·
  profit before tax €139.505,95 — the prototype's figures to the cent.
- **Review engine**: 625 exceptions for A&F, across eight checks.
- **Only one client has data.** `clients_for_reporting()` offers 36; A&F has 174.026
  postings and the other 35 have none. Thirty-five empty shells is the truth about the
  data rather than a fault in the build — an earlier note in this file read it as one.

---

## The rail: every screen the prototype has, except Projects

All five sections `FIX.md` §2 named are built, from data the build already reads —
no new feed and no new query except the review engine's own exceptions.

| Screen | Where its data comes from |
|---|---|
| **Debtors & creditors** | `ageing.ts` — aged from the postings, on BTMS's own `account_type` |
| **Cash flow** | `cashflow.ts` — arithmetic on the profit and loss and the balance sheet |
| **Budget** | `reporting.budgets`, keyed by hand and never generated |
| **Monthly audit** | `audit.ts` — materiality, analytical review, vouching, cut-off, journals, the month's checks |
| **Projects** | correctly still off: gated on T-Analysis tags, and A&F has none |

Every flag follows its data, as `BUILD.md` §8 requires. `ledgers` is on when there
are aged accounts, `cash` when there are periods to show, `audit` when there are two
financial years to compare — one gives the analytical review nothing to say. `budget`
is on regardless, because the screen is how a budget gets keyed in the first place
and cannot wait for one to exist; with no rows the template says so in its own words.

**Two assumptions worth knowing, both stated in the code rather than buried:**

- The ledger carries no allocation of receipts to invoices, so the ageing is derived
  the way an accountant derives it from a ledger that does not allocate: **oldest
  first**. Where a client pays a specific invoice out of order this ages that balance
  older than it truly is. It never changes the balance, only the bucket it sits in.
- The cash flow's **Unexplained** row is the point of that screen, not a defect in
  it. The walk starts at profit *before* tax while the liability the tax charge
  created sits in creditors, and the template has no row for it — so a client whose
  tax is posted once at the year end reconciles in every month but that one.

---

## Uploading, and where the files live

**The Upload button on the template's own Data import table works.** It posts the
feed's name to the host, which asks for the file, asks for the period in the shape
that feed needs, checks the file *before* storing it, warns on a repeat, then stores
it and imports it — without leaving the report.

- Three shapes of period control, because there are three shapes of period: a year, a
  month or quarter, and **an exact date** for a stock count. The trial balance period
  and the stock count date are in no BTMS export and cannot be recovered afterwards.
- A file that fails its own control totals is refused with the reason, while the
  person is still at the machine that exported it. It never reaches storage.
- A repeat is named: the file, when it arrived and who loaded it, with **Replace it ·
  Keep both · Cancel**. Replacing never deletes; the old file stays in the folder as
  the record of what was reported at the time.

**One store, two ways in.** `portalFolder.ts` is the only code that stores a BTMS
file. A file uploaded on the report and a file filed from the client's Documents tab
go through the same door, are checked the same way, land in the same subfolder and
are named the same way.

**The folder** (migration 215): every client's *BTMS data* folder now has ten
subfolders — Journal listings, Ledgers, Trial balances, Chart of accounts, VAT,
Payroll, Stock, Sales, Bank, Other. `btms_folder_for(client, kind)` decides which one,
in the database, so the two ways in cannot disagree. Files are named from their type
and period — "Trial balance — 2026-07.xls" — with the BTMS export's own name kept as a
note on the row. Inside those folders the portal's Document Type list is the eleven
BTMS feeds; every other folder keeps the general list.

---

## Client data that was leaking, and is not now

Four places held one client's information under another client's name. The overriding
rule for this build is that it must never mix up client data, so these are recorded
rather than quietly fixed:

1. **The Data import table** showed A&F's own file names, marked LOADED, to whoever
   was signed in. A filename is client information. (Generator patch 1.)
2. **The budget** was `localStorage["pcp-budget-af"]` — one key, "af", for *every*
   client. Key a budget against one client and it was the budget every other client
   showed. Now `reporting.budgets`, per client.
3. **The working papers** were `localStorage["pcp-wp-af"]` — the same fault. Sign a
   step off against one client and it read signed against every other. Now
   `reporting.exception_signoff`, per client.
4. **The monthly audit screen** was written against A&F's calendar:
   `ys=["2024","2025","2026"]`, an annualisation over exactly seven months, and a
   materiality note computed on FY2025. A client with different years would have found
   the screen dead on an undefined year, or reading somebody else's. It reads
   `AU.years`, `AU.partial` and `AU.basis` now.

The seven months was already wrong for A&F: the ledger runs to August 2026, so the
last year holds **eight**, and the annualised column was scaling eight months as
though they were seven. Nothing said so.

---

## What was wrong in the database, and is now fixed

**Migration 211.** `vat_figures` took `vat_amount` as BTMS stores it — always
positive — so a purchase return *added* to box 4 instead of reducing it. On A&F
Q2 2026 box 4 read €68.269,67 against a true €64.100,43: VAT payable understated by
**€4.169,04**. Boxes 1–3 were always correct. Also: `has_stock` / `has_payroll` were
false for a client whose stock and payroll were already imported, and all 63 clients
were marked "BTMS — ours" because a bulk button had said so. That button is gone, and
where a client's books are kept is now set on the client's own record.

**Migration 214.** `staff_can_access()` matches `isStaffRole()` in
`src/services/api.ts` exactly — owner, supervisor, admin, staff. 212 had widened it to
include `app_user` on the assumption those were staff accounts; they are a client-side
mini-app login, and the front end refused them anyway, so the only effect was to make
the database disagree with the application.

**Migration 215.** The ten subfolders, `btms_folder_for()`, and
`documents.period_end` for the one date no export contains.

---

## What is not done

**The seventeen objects.** Every file loaded so far went to the `reporting-imports`
bucket; the client folders are empty. `scripts/migrate-btms-imports.mjs` will move
them — into the right subfolders, with a `public.documents` row and a check row each,
repointing `imports.storage_path` and `stock_valuations.file_path`, deleting nothing,
and safe to run twice. It cannot run: the names in the bucket are bare checksums, so
the move needs `reporting.imports.original_filename` to give them their names back,
and neither credential can read that schema. `.env.scripts` has
`SUPABASE_ADMIN_EMAIL` and `SUPABASE_ADMIN_PASSWORD` present but **empty**, and
migration 190 granted the reporting schema to `authenticated` only, so the service
role gets "permission denied for schema reporting". Fill in the admin credentials, or
grant the schema to `service_role`.

**The folder comparison.** `NEXT.md` §2 step 3: on opening a client, list the folder
and compare against `reporting.btms_file_checks` by sha256 — what is new, what has
changed since it was last imported, what is already in — then import the new and the
changed in one action. Not started.

---

## What is unverified

**None of this has been seen in a signed-in session.** Everything above was checked by
reading the database directly, and by typecheck and build. Nothing has been opened in
a browser as a signed-in member of staff.

The figures that *were* checked directly: A&F's 174.026 postings across 68 months,
FY2025 revenue €1.523.703,29 (so planning materiality €11.427,77 and performance
materiality €8.570,83), eleven P&L postings in 2026 at or above performance
materiality, 264 postings within three days of a year end, 515 manual journal postings
across 17 journal types, and 625 exceptions across eight checks.

Still to meet by eye:

- A&F opens showing **174.026 postings** and **profit before tax €139.505,95** for
  Jan–Jul 2026.
- Its rail carries every screen in the prototype except Projects.
- Pressing Upload on "Trial balance, monthly", choosing a file and answering
  "July 2026", stores it in the client's folder and moves the row to LOADED without
  leaving the report — and doing it again warns and offers to replace.

`report_figures(1754, …)` refuses to answer without a session — `no access to client
1754` — which is the access model working, not a fault. If a screen still comes up
empty, capture what the frame says: the lazy path replies with the error text, so the
sign-in screen prints "Could not read ΑΝΤΩΝΗΣ…: *reason*". That reason is the next
clue, and there is no point guessing at it from here.

---

## Two things worth a decision

**Who may use it.** Settled in code, open as a question. The rule is the four staff
roles, in the database and the front end alike. The five `app_user` accounts — Irene,
Stalo, Andri, Pani, Xenios — cannot open the reporting app. Andri enters the journals
in BTMS, so that may not be what was intended. The fix is not to widen the rule: it is
to give that person a staff role on the users screen, which is a decision about the
person, made once, in the place the portal already keeps it.

**The unexplained VAT difference stands.** With the sign fixed, A&F Q2 2026 box 4
computes to €64.100,43 against €64.914,16 on the filed return — **€813,73 short**.
Boxes 1 to 3 agree exactly. Unposted journals are not the cause; none fall in Q2. This
is a real open item for the client, not a defect in the application, and the VAT
screen must show it rather than reconcile it away.
