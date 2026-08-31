# Reporting platform — where the build actually stands

Written after a full inspection of the live database and the repo, September 2026.
Read this with `BUILD.md`, not instead of it. `BUILD.md` says what the application
is meant to be; this file says what exists today and what to do next.

---

## The foundations are done and proved

Do not rebuild any of this. It works and the figures have been checked against the
client's own records.

- **Schema**: migrations 190–211 applied, 27 tables in the `reporting` schema.
- **Import**: the analytical journal listing parser, the trial balance, chart of
  accounts, stock and payroll parsers all work. Six years of A&F journal listings
  are committed.
- **The ledger**: 174.026 postings for Antonis & Foulis, 2021-01 to 2026-08,
  **debits = credits = €62.093.741,48**.
- **Mapping**: 8.467 accounts, every one resolving to a report line through
  `mapping_defaults`. Nothing unmapped.
- **The numbers are right.** `report_figures` for Jan–Jul 2026 returns revenue
  €989.570,57 · cost of sales €709.226,32 · gross profit €280.344,25 · overheads
  €135.033,20 · profit before tax €139.505,95 — the prototype's figures to the cent.
- **Review engine**: 625 exceptions generated for A&F.

---

## What was wrong, and is now fixed (migration 211)

**1. VAT overstated input tax.** `vat_figures` took `vat_amount` as BTMS stores it —
always positive — on every non-sales journal. A purchase return therefore *added* to
box 4 instead of reducing it. On A&F Q2 2026 box 4 read €68.269,67 against a true
€64.100,43: the VAT payable was understated by **€4.169,04**. Boxes 1, 2 and 3 were
always correct.

The fix: the base line carries the direction on both sides — a purchase debits, a
purchase return credits, a sale credits, a sales return debits — so take
`abs(vat_amount)` and let the sign of `debit - credit` decide. `abs()` also handles
the one A&F line where BTMS itself stored the tax negative.

**2. Stock and Payroll were switched off** for a client whose stock valuations and
payroll had already been imported, so both were invisible with the data sitting
behind them. Backfilled, and triggers now flip the switch on import. A switch a
person has to remember is a switch that gets forgotten.

**3. Every client was marked "BTMS — ours".** All 63 rows carried `btms_local`, so
the client picker offered every client on the books. Now set from the partner's own
list: **32 on our BTMS, 4 on the client's own** (K.M. Fix-It-All, Pandima CC,
Αντώνης & Φούλης Ηλεκτραγόρα, Αντώνης και Φούλης Μιχαήλ), **27 not offered**.
PC Prime's own books are deliberately left out of the picker for now.

---

## The empty build: the diagnosis above was wrong, and here is what was found

**`buildAllClients` was not running.** It had no callers. `ReportHome.tsx` calls
`buildClientList()`, which builds a payload of empty shells **on purpose** and fills
one client in when that client is chosen — the template posts `pcp-need-client`, and
`buildClientBlock` answers it. So "36 clients and not one posting in any of them" is
the design, not the fault, and "Rebuild finishes instantly" is Rebuild doing its one
job: reading the list. The dead function has been deleted so nobody diagnoses from it
again.

**The database is right, and only one client has anything.** Read directly:

| | |
|---|---|
| `clients_for_reporting()` shape | `TABLE(client_id bigint, client_name text, data_source text, postings bigint)` — as migration 206 wrote it |
| A&F (1754) | **174.026 postings**, 68 months |
| the other 35 offered clients | **0 postings each** — correctly empty |
| master report lines | 1 template, 87 lines |
| RPCs | `postings_columnar`, `ledger_months`, `client_data_version`, `report_figures` all present |

So `postings` is not being lost between the function and the check. Everything
`buildClientBlock` needs for A&F is there, and 35 of the 36 clients being empty shells
is the truth about the data rather than a bug.

**What was actually broken, and is now fixed:**

1. **Debtors & creditors threw on every client, A&F included.** `renderLedgers` opened
   with `A.deb.map(...)` on `D.agetot`, and `agetot` is `{}` for *every* client —
   `buildPayload.ts` writes it empty for a built client, not just an empty one, because
   the ageing is not a feed the builder produces yet. Patch 4 in
   `tools/build-reporting-app.mjs` gives the screen an empty state. The Overview needed
   nothing: its two tiles already print an em dash against "no ageing loaded".

2. **Rebuild did not rebuild.** It cleared the in-memory map, which dies with the tab
   anyway, and left the block kept in IndexedDB against the data stamp. So a person who
   pressed Rebuild because the report looked wrong got the same stored copy back, and
   nothing they could press would say otherwise. The button now forgets the stored
   blocks first; the opening build still does not, or every page load would pay the
   ninety seconds the cache exists to save.

**Still unverified: the acceptance figures.** Opening A&F and reading 174.026 postings
and €139.505,95 needs a signed-in session, and `report_figures(1754, ...)` correctly
refuses to answer without one — `no access to client 1754`, which is the access model
working. If A&F still opens empty after this, the thing to capture is what the frame
says: the lazy path replies with the error text, so the sign-in screen prints
"Could not read ΑΝΤΩΝΗΣ…: <reason>". That reason is the next clue, and there is no
point guessing at it from here.

---
## The screens DO exist — an earlier note here was wrong

The generated template carries **eighteen** screens, not the six on the React rail.
Signed in as A&F on the 18:02 build, all of these rendered with real content:

```
Overview · Management report · Profit & loss · Balance sheet · Expenses
Sales analysis · Statements · Account movements · Transactions
Debtors & creditors · Stock · Payroll · VAT · Needs attention
Data import · Account mapping · Company setup · Client setup
```

Transactions showed 500 rows, Needs attention 625 exceptions, Sales analysis 209
customers, Account movements 111 accounts. The six-item rail in `ReportingApp.tsx`
is the shell around the template, not the report.

**Still missing from the template:** Cash flow, Budget, Monthly audit, Projects.

---

## What to do next, in order

**A. Confirm A&F opens with its figures.** The empty payload turned out to be the
design and the data is proved right; what is left is to open it signed in.
Acceptance: A&F shows 174.026 postings and a profit before tax of €139.505,95 for
Jan–Jul 2026. If it does not, capture what the sign-in screen says it could not read.

**B. Done.** The ledgers screen has its empty state, and the Overview tiles were
already honest.

**C. Add the four missing screens** — Cash flow, Budget, Monthly audit, Projects —
from `docs/reporting/prototype.html`.

**D. The three changes in `NEXT.md`** — the BTMS tick on the client record, the
client folder as the single store, and the BTMS document types.

## Two things worth a decision

**Who may use it.** `reporting.staff_can_access()` is `is_admin() AND
user_can_access_client()`, and `public.is_admin()` covers owner, supervisor, admin
and staff. So the five `app_user` accounts — Irene, Stalo, Andri, Pani, Xenios —
cannot open the reporting app at all. Andri enters the journals in BTMS, so this is
probably not what was intended. Changing it means giving those accounts a staff role
or widening the check; either way it is a decision, not a bug.

**The unexplained VAT difference stands.** With the sign fixed, A&F Q2 2026 box 4
computes to €64.100,43 against €64.914,16 on the filed return — **€813,73 short**.
Boxes 1 to 3 agree exactly. Unposted journals are not the cause; none fall in Q2.
This is a real open item for the client, not a defect in the application, and the VAT
screen must show it rather than reconcile it away.
