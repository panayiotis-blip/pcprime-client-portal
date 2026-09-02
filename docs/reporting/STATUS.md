# Reporting platform — where the build actually stands

Written 1 September 2026 and brought up to date on 2 September, after working
through `FIX.md` §0–§5, the three changes in `NEXT.md`, all eight items of
`FIX-2.md` — the partner’s first review of the built app — and all of `FIX-3.md`,
the second. `BUILD.md` says what the application is meant to be; the four work
orders say what was asked for and in what order; this file says what exists.

**Everything asked for is built and deployed.** What is left is looking: almost
none of it has been seen in a signed-in session. Read *What is verified, and what
is not* at the foot of this file first — it is the part that matters.

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

- **Schema**: migrations 190–222 applied. Note the migration ledger has never been
  the record of what is applied — `supabase/migrations/` is. Two of them reached
  the database before they reached the repo, and 216 turned out to be a no-op
  because the grant was already there. The four from the second review:
  **219** `keyed_columns`, the comparison columns the partner types himself;
  **220** `chart_choices`, which overview charts a client gets;
  **221** `pack_options`, what that client's pack looks like;
  **222** `cash_direct`, which attributes every bank posting to the other side of
  its own transaction.
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
| **VAT** | three figures per box — rebuilt from the journal, computed by BTMS, filed |
| **Ratios** | derived, from the profit and loss and the balance sheet together (FIX-3 §6) |
| **Cash in and out** | `reporting.cash_direct` — the direct statement, from the postings (FIX-3 §7) |
| **Projects** | correctly still off: gated on T-Analysis tags, and A&F has none |

**Which sections a client gets is now a person’s decision**, taken on Client setup
and before any file is imported (migration 217). `section_overrides` holds it, one
key per section: absent means nobody decided and the default below applies;
present outranks anything the data says. Import a stock valuation into a client
whose Stock was switched off and it stays off, because that is what switching it
off meant.

The default, where nobody has decided, follows the data as `BUILD.md` §8 requires. `ledgers` is on when there
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

5. **The coverage grid** ticked months from literals — `m === "2026-07"` for the
   trial balance, a hardcoded list for the stock counts. A&F’s own coverage, shown
   under every client’s name. It reads what that client has loaded now.

**That is the shape to look for if a sixth turns up:** a month, a year, a filename
or a browser-storage key left as a literal in the prototype. Five of them were
found by reading the code rather than by anything failing, because none of them
fails — they quietly show one client’s figures under another client’s name, which
is the one thing this application must never do.

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

**Migration 216.** The reporting schema reachable by `service_role`, which is what
let the mover read `imports.original_filename`. It was already granted when it was
applied, so 216 records in the repo what the database already did.

**Migration 217.** `section_overrides`, and `has_stock` / `has_payroll` /
`has_branches` made nullable so null can mean "nobody has decided". The 211
triggers now write only where the column is still null, so they remain a record
that the client HAS the data and can no longer contradict a person. Worth knowing:
those two columns were read by nothing at all — the payload computed both straight
from the data — so the triggers had been maintaining columns no screen consulted.

**Migration 218.** The seventeen migrated files renamed from their type and period,
with the BTMS name moved onto the row as a note.

---

## The partner’s review, and what it turned into

`FIX-2.md` is his review of the built app: eight items, ordered so the two that
discredit everything else came first. All eight are done.

**1. "Read the new and changed files" signed you out.** Not the router, as the
review supposed. Every error from an action taken inside the frame went to
`setError`, and the full-screen "the report could not be built" renders ABOVE the
iframe — so any failure unmounted the frame and the template came back at its own
sign-in. Worse: the handler called it when ANY file failed, so a partial success
destroyed the session too. For A&F exactly one file fails, so reading the folder
was guaranteed to throw the person out while quietly importing the rest. Errors
from inside the report now go to a notice beside it and the frame stays.

**2. Every decimal printed two full stops.** `toLocaleString("en-GB").replace(/,/g,".")`
converts the thousands separator and never the decimal point: 516.283.99. Whole
numbers came out right, which is why it survived. Fixed in the method rather than
the separator — `de-DE` writes numbers the way the practice does — and the build now
fails if a comma-replacing formatter comes back.

**3.** The Client setup switches are a real per-client decision, taken before any
import. **4.** The Rebuild button is gone and the report refreshes itself on the
one event that stales it. **5.** The folder panel says what it is for, names files
by type and period, and the migrated ones were renamed to match. **6.** The portal
cards say what each file is and carry Move to…, so a misfiling is a correction
rather than a deletion and a re-upload — which would destroy the date the client
sent it.

**7. VAT.** Both feeds are read now. The figures summary — which is not a summary
of five boxes but the analytical listing, grouped by VAT type and month — goes into
`vat_periods` as BTMS’s own computation, split into what belongs to the quarter and
what was posted late and swept in. The return as filed goes into `vat_returns`, its
boxes keyed rather than parsed, because a filed return is usually the PDF the tax
office gave back.

The parser reproduces A&F’s Q2 2026 to the cent: in-period output 91.749,07 and
input 64.914,16, against the file’s own stated totals of 92.627,88 and 65.084,36.
And that is the point of the third column:

```
                 rebuilt    BTMS computed    filed
box 4          64.100,43       64.914,16   64.914,16
```

BTMS computed exactly what was filed, so **the ledger is the odd one out** and the
813,73 stops being an argument between this application and the tax office. The
question becomes what the journal is missing, which is a better question.

**8.** The reconciliation panel leads with what it is for — the journal balancing
proves every posting has its contra and cannot prove nothing is MISSING — turns its
instruction into a button that opens the upload with the month filled in, and asks
only for what that client and that year are due.

---

## The second review, and what it turned into

`FIX-3.md` is the work order; this is what each item became. §1 (the period
control) and the typography and width items were already done when it was written.

**§2 — comparison columns are a list, not a choice.** COMPARE WITH was one dropdown
and one answer. A screen now holds a LIST, shared by Profit & loss, Balance sheet
and Expense analysis: as many columns as wanted, each any period end the ledger
reaches, with year ends offered first from the client's own year end. Three or five
years across is one click. Budget is a column chosen deliberately and never a
default, and where none is keyed the column says so. Movement is against the column
to its left and the heading names the two it compares.

Sales analysis is the fourth screen §2 names and it is NOT wired to this. Its table
runs months down the side with a year earlier beside each, so columns there are a
different table; §9 gave it its own comparison columns on the ratios block instead.

**§3 — a column the partner types into.** `reporting.keyed_columns` (migration 219),
keyed on client, period and name. Named by the partner, more than one kept, marked
as keyed everywhere it appears, and offered only when the screen shows the period it
was keyed against — a target for seven months is not a target for twelve. A blank is
not a nought: an empty line is left out of the total rather than pulling it to
nothing. Only the profit and loss offers it; the balance sheet and expense analysis
say so rather than quietly answering nothing. It feeds no statement, review or audit.

**§4 — the overview draws what the client was given.** Eight charts, chosen per
client on Client setup (`chart_choices`, migration 220): the three the prototype
drew plus overheads by month, cash and bank, debtors and creditors ageing, sales by
customer, and expenses against budget. The three originals are the defaults, so
nobody's front page changed. A chart with nothing behind it says so rather than
drawing an empty picture. "Where the money went" already had the width and was
STRETCHING into it — one 760 viewBox blown up to 1880 takes its labels with it — so
`barsChart` draws wide when it is given the width. And a month row under the
year-to-date row: that month's revenue, gross profit, overheads and profit, with the
movement on debtors, creditors and cash.

**§5 — the management summary.** Percentages on or off, kept per client
(`pack_options`, migration 221), because with them off a month is one column instead
of two. A from and a to month beside the year, offering only the months the ledger
holds. The total column is the total of the months SHOWN and its heading says which
they are — "Jan–Jul", and "Year" only when all twelve are there.

**§6 — a ratios screen.** Nineteen ratios in five groups, on their own screen after
the balance sheet, with the four a month end can answer alone repeated at the foot
of the balance sheet. Every ratio shows the two figures it is made from; every one
runs across the same columns as the statements; one that cannot be worked out says
why. Days are measured over the days each column covers rather than annualised, and
the screen says so. Growth is measured against the column to the RIGHT — the older
one — so the current column has a growth figure. `bsAt()` reads the balance sheet
exactly as `renderBs` builds it, and the check holds the two together.

**§7 — Cash in and out.** The direct statement, beside the indirect one, with a line
on Cash flow saying how they differ. No new import: migration 222 attributes every
bank posting to the other side of its own transaction.

What counts as one transaction is the whole of it. `journal_code` + `journal_no` +
`batch_no` does NOT identify one — on A&F that gives 27.415 groups averaging 6,3
lines and running to 861, which is a batch. Adding `posted_on` and `reference` gives
31.028 groups touching a bank account, of which **31.020 balance — 99,97 per cent** —
with at most eight lines on the other side. A payment covering several invoices
splits in proportion to them.

Transfers between the client's own accounts are not movement: 4.449 of A&F's bank
transactions have no non-bank line at all. They are kept out of money in and out on
the combined view and shown as real movement when one account is looked at alone.

**It proves out.** The direct statement ties to the ledger's own bank movement
exactly — **−38.991,27 both ways over 43.727 rows**, and across all 239
month-and-account pairs not one disagrees by half a cent.

**§8 — Expense analysis.** Months across for a year, or years across through the §2
list. The MONTHLY SHAPE sparkline is gone; it was too small to read a figure off.
Two levels of drill-down: a line opens to the nominal accounts beneath it across the
same columns, an account opens to its postings with the journal and reference. The
postings span EVERY column shown, because "what was in it last year that is not in
it this year" needs both years in front of you. Sort by any column; nil lines hidden
by default and retrievable.

**§9 — Sales analysis.** Additions only, as asked. Five more tiles — new customers,
customers lost, top ten as a share, credit notes as a share, sales per month — and a
sales ratios block with its own comparison columns, under the same three rules as
§6. "Average days to pay" is a table: the ledger holds no matching of receipts to
invoices, so the honest answer is each customer's balance measured against what they
buy, and the screen says that is what it is.

One correction went with it. `custSales` decided which accounts were the sales
ledger by testing `/^221/` on the code — A&F's chart and nobody else's, so any other
client would have had an empty screen and nothing to say why. It uses the client's
own mapping now, with the prefix as a fallback. On A&F the two agree exactly: the
one Trade debtors account outside 221 is Bills Receivable and it carries no sales
journal line.

**§10 — the left rail.** The four group headings were 9,5px in the lightest ink on
the screen against 13,5px items; they are a step bigger, bolder and darker. The
practice's own name was wrapping because the MARKUP carried a `<br>`, so no
stylesheet would ever have fixed it. **The rail is 52px wider** — 212px to 264px —
because the name does not fit on one line at rail-item size in 212px. That width is
an estimate of the text and is the one thing in that section that wants a browser.

**§11 — VAT, left alone as the work order says.** Its premise is now stale: the
importers and the box-by-box comparison it names as outstanding were built as item 7
of the first review. What is still outstanding there is two manual steps and no
code — reading the VAT summary already in A&F's folder, and keying the filed return
for 2026 Q2.

---

## The files, and what is left of them

**The seventeen objects moved.** They are in the client’s subfolders with their real
names back. Both buckets read 17 objects and 41,3 MB — nothing was deleted, and
`reporting-imports` is intact until somebody agrees it is redundant. All 20 import
rows are repointed, the rejected and withdrawn ones included.

**The folder comparison’s first real test**, run straight after the move:

```
16 loaded  ·  1 not read  —  a&f tb 01 2026.xls
```

That one is right: its import was withdrawn, so the file is in the folder and not
in the ledger, and the screen says so instead of nobody knowing.

**Two things need doing once, by hand.** The VAT figures summary is in A&F’s folder
but was never read — it was not an importable feed when it was uploaded — so it
should appear in the comparison as **new**. And the filed return has to be keyed
once, on the VAT screen, for 2026 Q2. Until both are done the third column is empty
and the 813,73 does not appear.

**The generator, and one thing about it worth knowing.**
`tools/build-reporting-app.mjs` splits `public/reporting-template.html` into the
shell and the script and applies twenty-nine anchored patches. Every patch throws if
its anchor has moved, so the template drifting is a build failure and not a silent
one.

Patch blocks are inserted ABOVE the previous one, so after 19 they run in **reverse
authoring order**. Today that is:

    1 3 4 … 19  ·  26 27 25 24 22 23 21 20 2  ·  28 29

Three times in the second review a patch was written that ran before the one it
depended on, and twice the guard did not catch it because the string it matched
also existed in the template's own copy of the function — the balance sheet's ratio
foot was written and then thrown away by the patch that replaced `renderBs`
wholesale. If a patch must run after another, it goes in BELOW it, and the reason
belongs in its header. Patches 28 and 29 say so, which is why they sit at the end.

Check the order with:

    grep -n "^// ---- patch" tools/build-reporting-app.mjs

---
## What is verified, and what is not

**The Monthly audit has been opened and read, signed in, and it is right.** Pete
checked it on 1 September. That is the first thing in this build confirmed by eye
rather than by SQL, and it carries more than the one screen with it: for that tab to
render at all, A&F had to open, which means the sign-in answered, `pcp-need-client`
was served and `buildClientBlock` ran to completion — and that build now computes the
ageing, the cash flow, the budget, the audit and the folder comparison. Any one of
them throwing would have failed the whole block and the client would not have opened.

So the payload build works end to end, the `audit` flag gated correctly, and patch 7
took: the year columns are this client's own rather than the calendar baked into the
prototype.

**Everything else was checked by reading the database, and by typecheck and build.**
It has not been looked at.

The figures that *were* checked directly: A&F's 174.026 postings across 68 months,
FY2025 revenue €1.523.703,29 (so planning materiality €11.427,77 and performance
materiality €8.570,83), eleven P&L postings in 2026 at or above performance
materiality, 264 postings within three days of a year end, 515 manual journal postings
across 17 journal types, and 625 exceptions across eight checks.

That was checked before the two reviews were built, and **nothing from either has
been looked at at all.**

**What the second review added instead is seven check suites**, in `tools/`, run by
`node tools/check-*.cjs`. They are not a browser and they do not pretend to be:
each one loads the SHIPPED `public/reporting-app.js`, pulls the real functions out
of it, and runs them against a made-up ledger small enough that every expected
figure can be worked out by hand. What they prove is that the arithmetic and the
shape are right. What they cannot see is whether any of it looks right, or whether
a control is reachable with a mouse.

| Suite | What it holds |
|---|---|
| `check-comparison-columns` | §2 and §3 — the column list, the shapes, the keyed column, the number formats |
| `check-overview-charts` | §4 — which charts a client gets, the month row, and that the frame and the host know the same chart list |
| `check-summary-range` | §5 — the month range, the percentages switch, the total column's name |
| `check-ratios` | §6 — every ratio against figures done in the head, and that it agrees with the balance sheet |
| `check-cash-in-out` | §7 — the categories, the transfers, the balances, the drill-down |
| `check-expenses` | §8 — both views, the drill-down, the sort, the nil lines |
| `check-sales-ratios` | §9 — the tiles, the ratios, and that the mapping change moves nothing |

Four of them caught real bugs before anything shipped: an inverted sort that put the
smallest expense line at the top, a drill-down whose posting range ran backwards, a
concentration share dividing net by gross, and a chart-list check that passed while
the two lists genuinely differed. That last one is worth remembering — a check that
agrees about nothing agrees.

The list below is in the order it is worth looking, hardest and newest first.

**From the second review, none of it seen:**

- **Cash in and out.** The largest new thing and the one with a figure to check: the
  net movement for a month should equal the movement on the cash and bank line of
  the balance sheet for the same month, and the closing balance should follow the
  opening one. It ties exactly in SQL; what is unseen is whether the screen says so.
  Press a figure and it should name who is behind it.
- **The ratios screen**, and the four repeated at the foot of the balance sheet. The
  two should agree, and both should agree with the balance sheet above them.
- **Expense analysis.** Twelve month columns plus four is a wide table and it has
  not been rendered. Open a line, then an account, and the postings should be there.
- **The left rail.** The one place a browser is genuinely needed: the practice's name
  should sit on ONE line inside the widened rail. If it wraps or the rail scrolls
  sideways, the width estimate was wrong and only the number needs changing.
- **The overview's five new charts**, none of which has been drawn against real data.
- **A keyed column end to end**: type one, name it, save it, sign out and back in,
  and it should be offered again for the same period and not for another.

**From the first review, still unseen:**

- **The VAT screen.** The largest new thing and the only one with a figure to check
  against: read the summary already in the folder, key the filed return for 2026 Q2,
  and box 4 should read 64.100,43 rebuilt against 64.914,16 computed and filed, with
  813,73 flagged. If the middle column is empty the summary has not been read; if it
  is empty on a client with a shifted VAT cycle, that is the caveat in `vatImport.ts`
  and not a fault.
- **"Read the new and changed files".** The fix that unblocks judging anything else
  on that screen. It should read the files, report what it did, name
  `a&f tb 01 2026.xls` as the one that would not, and **leave you in the report**.
  Being thrown to sign-in means item 1 is not fixed and the diagnosis was wrong.
- **Any figure with decimals** — the reconciliation should read `516.283,99` and
  `1.820` postings, and nothing anywhere should contain two full stops.
- **The Client setup switches**, on a client with no data: turn Stock off and Cash
  movement on, sign out and back in, and the choices should hold. Then import a stock
  valuation and Stock should stay off, because somebody said so.
- **The Overview**: 174.026 postings and profit before tax €139.505,95 for Jan–Jul
  2026 — the figures the whole build was measured against, still unseen.
- **One upload end to end**, and the same file again to see the repeat warning.
- **One sign-off across two browsers.** The only remaining claim where a silent
  failure looks exactly like success from a single machine: sign a working paper,
  open the client elsewhere, and see whether the signature is there.
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
