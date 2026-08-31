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

## What is not built yet

This is the gap that made the application feel broken. The rail has six items:

```
Profit and loss · Balance sheet     Open the report      Build the template
Exceptions                          Data import          Account mapping
```

Everything else in `BUILD.md` section 8 is missing: **Overview, Management report,
Cash flow, Expenses, Sales analysis, Budget, Statements, Account movements,
Transactions, Debtors & creditors, Stock, Payroll, VAT, Monthly audit, Company
setup, Client setup.**

Three of those already have working panels — `StockPanel.tsx`, `PayrollPanel.tsx`,
`TrialBalancePanel.tsx` — but they are mounted **inside `DataImport.tsx`** along with
five other panels. That page is doing eight jobs at once, which is why the import
screen feels wrong. They need lifting out into their own routes.

`vat_figures` computes correctly and returns everything the VAT screen needs. There
is no VAT screen.

---

## What to do next, in order

**A. Split the import page.** Move `StockPanel`, `PayrollPanel` and
`TrialBalancePanel` out of `DataImport.tsx` into their own routes and rail entries,
gated on `client_settings.has_stock` / `has_payroll`. Leave the folder panels, the
chart import and the month checklist on Data import — that is the one page's actual
job.

**B. Build the VAT screen.** The engine exists. It needs the boxes, the by-code
table, the quarter picker, the returns-held table and the variance flagging against
an attached return. `docs/reporting/prototype.html` shows exactly what it looks like.
Acceptance: A&F Q2 2026 shows box 1 €82.324,60, box 2 €9.424,47, box 3 €91.749,07 and
box 4 €64.100,43.

**C. Build the reports.** Overview, Management report, Cash flow, Expenses, Sales
analysis, Budget. The period selector, the comparatives, the frozen headings and the
frozen description column are all specified in `BUILD.md` section 8 and demonstrated
in the prototype.

**D. Build the ledger screens.** Statements, Account movements, Transactions,
Debtors & creditors.

**E. Company setup and Client setup**, then the monthly audit.

---

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
