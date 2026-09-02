> **All ten items are built and deployed; §11 was left, as it asks.** `STATUS.md`
> says where the build stands and what is still unlooked-at — read *The second
> review, and what it turned into* for what each item became, and *What is
> verified, and what is not* for what nobody has seen yet.

# Fix order 3 — the partner's second review

Read this before BUILD.md, STATUS.md, NEXT.md, FIX.md or FIX-2.md. Those are done.
The full notes are in REVIEW-2.md; this is the order to build them in.

**Already done — do not redo.** Commit `155b236` covers REVIEW-2 items **1a, 1b,
2a and 3**: the page width, Sales by month at full width, and one family and size
for the data with tabular figures. Check them on screen before starting; the
partner's screenshots were taken before that build.

**Two pieces of shared machinery come first.** The period control and the
comparison columns are asked for on six screens between them. Build each once and
use it everywhere; building them per screen is how this drifts again.

---

## 1. One period control, used by every screen

Replace the REPORTING PERIOD + PERIOD ENDING pair everywhere it appears.

**a. A row of buttons, not two dropdowns.** *This month · Last month · Quarter ·
Year to date · Full year · Custom.* The month picker appears only for the ones
that need it. The two dropdowns argue with each other and that is the root of it.

**b. Quarter means the client's quarter**, from `vat_quarter_offset` — not any
three months ending wherever the month picker happens to sit. Choosing Quarter
with a period ending of Jul 26 currently produces a quarter A&F does not have.

**c. Print the resolved range in full**, prominently: *1 January 2026 to 31 July
2026*, with the comparative it is measured against beside it. It is the most
important fact on the screen and it is currently grey small print.

**d. Default to the latest complete month, and say why.** The data runs to Aug 26
and the screen opened on Jul 26 with no explanation. If August is not closed, say
*"August is not closed — showing July."*

**e. The months must run to the year end even where the ledger does not.** Offer
every month of the chosen year so the partner can look at December and at what it
would take to get there, and mark the gap on the screen: *"Sep 26 to Dec 26 not
yet posted."* Never refuse the selection.

---

## 2. Comparison columns — a list, not a choice

Also shared. Wanted on Profit & loss, Balance sheet, Expenses and Sales analysis.

**a. As many comparatives as wanted**, each any period end the ledger reaches —
not only the same period a year back. The balance sheet case is the plain one:
**Aug 2026 beside Dec 2025 and Dec 2024**, the current position against the last
two audited year ends. Offer year ends first; they are the common case.

**b. Three or five years across** as a one-click shape, on Expenses and Sales
analysis especially, so a line that has drifted upward over several years reads as
a trend rather than as one number against last year.

**c. Budget as a comparison, chosen deliberately.** Never a default. Where no
budget is keyed for the period the option says so rather than showing zeros as a
variance.

**d. Movement is against the column to its left**, and the heading says which two
it is comparing.

---

## 3. A column the partner types into — Profit & loss

Sitting with a client he needs to put figures in and see the arithmetic: a target,
a what-if, an agreed adjustment. A comparison column **keyed by hand**, per line,
with the variance computed against it like any other column.

- Saved against the client and the period, like the notes on Data import, so a
  conversation is not lost when the screen closes.
- Named by the partner — *Target*, *Discussed 3 Sep*, *Revised forecast* — and
  more than one can be kept.
- Marked plainly as keyed rather than from the ledger, everywhere it appears.
- It never feeds the statements, the review or the audit.

---

## 4. Overview — the charts and a month row

**a. Let the person choose which charts appear.** A small library: sales by month,
gross margin, where the money went, overheads by month, cash and bank, debtors and
creditors ageing, sales by customer, expenses against budget. The choice is kept
per client, beside the Client setup switches.

**b. "Where the money went" gets the width**, as Sales by month now has.

**c. A month row.** A second row of boxes beneath the year-to-date row, for the
single month being worked on: that month's revenue, gross profit, overheads,
profit, and the movement on debtors, creditors and cash. The top row answers how
the year is going; this one answers how the month closed, which is what a person
is doing when they open the report.

---

## 5. Management summary — percentages and a month range

**a. Percentages on or off**, switched above the table. With them off each month
is one column instead of two, which nearly doubles the room for the figures. Keep
the choice per client — it is part of what the standard pack looks like.

**b. Choose the months, not just the year.** A **from** and **to** month beside
YEAR, defaulting to January through the last closed month. The YEAR column becomes
the total of the months shown and its heading says which range it is totalling.

---

## 6. A ratios screen

Ratios need the profit and loss as well as the balance sheet, so they get their
own screen, with the headline few repeated at the foot of the balance sheet.

| | |
|---|---|
| **Liquidity** | Current ratio · Quick ratio · Working capital |
| **Efficiency** | Debtor days · Creditor days · Stock days · Cash conversion cycle · Stock turnover |
| **Profitability** | Gross margin · Net margin · Return on capital employed · Return on equity |
| **Gearing** | Gearing · Interest cover · Debt to total assets |
| **Growth** | Revenue growth · Gross profit growth |

Three rules, so it survives being put in front of a client:
- Every ratio shows **the two figures it is made from**, not only the result.
- Every ratio runs across **the same columns** as the statements, so the trend is
  visible rather than one number in isolation.
- A ratio that cannot be computed **says why** — no denominator, no prior year —
  rather than printing a dash or a zero.

Read-only and derived. Nothing here is keyed.

---

## 7. Cash in and out — a new screen

The indirect statement stays; it is right and it proves out. What is missing is
the direct one: money in and money out, by bank account, month by month, showing
who was paid and what for. It is the sheet a conversation about funding the next
quarter is held over. Its own tab, with a line on Cash flow saying how they
differ — one explains the movement, the other lists it.

Months across for the chosen year. Down the side:

```
Opening balance
Money in     Customer receipts · Loans received · Shareholder and director
             · VAT refunds · Other receipts
Money out    Suppliers · Payroll and contributions · VAT and taxes
             · Loan repayments · Directors and shareholders
             · Overheads, by expense line
Net movement
Closing balance
```

**No new import.** Every posting on a bank or cash account has another side, and
that other side says what the money was for. Group by the contra account through
the mapping already in place.

**It must answer "who".** Clicking a figure lists the counterparties behind it —
who was paid, how much, on what date, with the journal reference so it can be
found in BTMS. A "largest twenty payments this month" list beside it is what the
partner will point at in a meeting.

**Per account and combined** — the ACCOUNT selector already on the Cash flow
screen applies, because a client with three banks wants to know which one is
carrying the strain.

**A monthly-average column** over the year to date, so the conversation about next
quarter starts from what the last months actually cost.

---

## 8. Expense analysis — two views and the detail behind each line

**a. Months across** for the chosen year, replacing the MONTHLY SHAPE sparkline,
which is too small to read a figure off. **Or years across**, three or five, by
item 2b. Keep % of sales and the change column in both.

**b. Drill down, two levels.** Every line here sums several nominal accounts and
there is no way to see inside one. Click a line — *Office and administration,
8.116* — and it opens to the nominal accounts beneath it across the same columns;
click an account and it opens the postings, with date, journal, reference,
narrative and amount so the item can be found in BTMS.

That answers the question the screen provokes and cannot currently answer:
professional fees down 10.245, advertising down 4.056 — *what was in it last year
that is not in it this year.*

**c. Sort by any column, and hide lines nil in every period shown**, so a client
pack does not carry rows of zeros.

---

## 9. Sales analysis — more on the top row, and sales ratios

The partner likes this screen. Additions only.

**a. More tiles**, beside the six there now:
- **New customers** — accounts with a first-ever sale in the period.
- **Customers lost** — bought in the same period last year, nothing this year.
- **Top ten as a share of sales** — concentration. CSP Joint Venture alone is
  82.543, and this is the most useful number on the screen for a conversation
  about risk.
- **Credit notes as a share of sales** — 98 notes and 55.645 returned is 4,9%.
- **Sales per month**, as a run rate for the year to date.

**b. Sales ratios**, kept separate from item 6 because these are about the
customers rather than the position:

| | |
|---|---|
| Concentration | Top 1 · top 5 · top 10 as a share of sales |
| Mix | New customer revenue vs repeat · revenue per customer |
| Quality | Credit note rate · average invoice value and its trend · gross margin by month |
| Collection | Debtor days · share of debtors over 90 days · average days to pay, largest first |
| Growth | Revenue growth · growth of the top ten against the rest |

Same three rules as item 6.

---

## 10. The left rail

**a. The group headings** — REPORTS · LEDGERS · REVIEW · CONFIGURE — are set very
small and light against the items beneath them. One step bigger and bolder, so the
rail reads as four groups rather than one long list.

**b. "PC Prime & Calculate Consultants Ltd" at the foot** is the smallest type on
the screen and wraps onto two lines. It is the practice's own name on a document
that goes to a client: same size as the rail items, on one line, with room above.

---

## 11. VAT — leave it

No change wanted now. It already carries the right mechanism — a row per quarter
with an **Attach** action and an OUTCOME column. What it needs is the importers
and the box-by-box comparison, which are FIX-2 item 7. Do not touch this screen
twice; the partner will look again once the returns are attached.

---

## Do not touch

- `public/reporting-template.html` as a design. Look changes are appended as
  overrides, as commit `155b236` does, so deleting the block restores the
  prototype exactly. The screens are the partner's specification.
- `reporting.staff_can_access()` / `is_reporting_staff()` — migration 214.
- The VAT sign rule — migration 211.
- The parsers in `src/reporting/lib/btms/`.

A third review follows once these are done.
