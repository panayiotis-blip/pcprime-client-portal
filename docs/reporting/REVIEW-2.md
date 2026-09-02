> **Closed.** This became `FIX-3.md`, which is built. `STATUS.md` says what each
> item turned into. Kept as the review as it was collected, screen by screen.

# Second review of the built app — running list

Collected screen by screen. Becomes FIX-3.md when the review is closed.

## 1. Overview — layout, charts, periods, and a month row

**a. Use the width.** The page is boxed to a fixed maximum and leaves a wide empty
margin down the right on a normal screen. Let the content fill the window, with a
sensible maximum only on very wide displays so lines of text stay readable.

**b. Sales by month is the important chart — make it big.** One full-width chart
rather than two half-width ones side by side. "Where the money went" gets the same
treatment. Gross margin moves below, or becomes one of the chosen charts in (c).

**c. Let the person choose which charts appear.** A small library — sales by
month, gross margin, where the money went, overheads by month, cash and bank,
debtors and creditors ageing, sales by customer, expenses against budget — with
the choice kept per client, beside the other Client setup switches.

**d. The period controls are wrong and need rethinking.** Two dropdowns that
argue with each other: REPORTING PERIOD (Single month · Year to date · Quarter ·
Full year · From/to) and PERIOD ENDING (a month). Choosing Quarter with a period
ending of Jul 26 produces a quarter ending in July, which is not one of the
client's quarters. Suggestions put to the partner:
  - One row of plain buttons instead of two dropdowns — **This month · Last month
    · Quarter · Year to date · Full year · Custom** — with the month picker
    appearing only for the ones that need it.
  - **Quarter snaps to the client's own quarters**, taken from
    `vat_quarter_offset`, not to any three months ending wherever.
  - Always print the resolved range in full, plainly: *1 January 2026 to 31 July
    2026*, and next to it the comparative it is measured against.
  - Default to the **latest complete month**, and say so. Data runs to Aug 26 but
    the screen opened on Jul 26 with nothing to explain why.

**e. A month row.** Add a second row of boxes for the single month being worked
on, beneath the year-to-date row: that month's revenue, gross profit, overheads,
profit, and the movement on debtors, creditors and cash. The year-to-date row
answers how the year is going; the month row answers how the month closed, which
is what a person is doing when they open the report.

## 2. Management summary — width, percentages, month range

**a. Use the width**, as on Overview. The table is squeezed into a boxed column
with the months compressed and an empty margin down the right, on the one screen
where horizontal room matters most.

**b. Percentages on or off.** A switch above the table. With them off each month
is one column instead of two, which nearly doubles the room for the figures and
is the version most clients want. Keep the choice per client, beside the other
Client setup switches, since it is part of what the standard pack looks like.

**c. Choose the months, not just the year.** Beside YEAR, a **from** and **to**
month, defaulting to January through the last closed month. It is how a pack for
a part-year, a quarter, or a three-month window gets produced without exporting
the whole year and cutting it down by hand.

The YEAR column stays the total of the months shown, and its heading says which
range it is totalling.

## 3. Typography — every screen

**a. Headings one step bigger and bolder.** Screen titles and section headings
across every report. They currently sit too close in weight and size to the body
text, so a long table reads as one undifferentiated block.

**b. One size and one font for all the data.** Table cells, labels, figures and
notes are presently a mixture of sizes and of the body face against a monospace
one. Settle on a single family and a single size for everything that is data.

Keep column alignment by turning on tabular figures — `font-variant-numeric:
tabular-nums` — rather than by keeping a separate monospace face for numbers.
That gives one font throughout with the digits still lining up.

Set it once in the stylesheet at the top of the template, not per screen.

## 4. Profit & loss — periods to the year end, budget, and a column to work in

**a. The months stop where the data stops.** PERIOD ENDING offers up to Aug 26,
the last month imported. The partner must be able to run to **December of the
chosen year even where the months are not yet there** — to look at the year end
and at what it would take to get there. Offer every month of the selected year,
and where a month has no ledger behind it say so on the screen rather than
refusing to select it: *"Sep 26 to Dec 26 not yet posted."*

**b. Compare with a budget, chosen deliberately.** Add **Budget** to the COMPARE
WITH list alongside "Same period last year". It is an option, never a default, and
where no budget is keyed for the period the option says so rather than showing
zeros as a variance.

**c. A column the partner can type into.** Sitting with a client, he needs to put
figures in himself and see the arithmetic — a target, a what-if, an agreed
adjustment. Add a comparison column that is **keyed by hand**, per line, with the
variance computed against it exactly as the other columns are.

  - It is saved against the client and the period, like the notes on Data import,
    so a conversation is not lost when the screen closes.
  - It carries a name the partner gives it — *Target*, *Discussed 3 Sep*,
    *Revised forecast* — and more than one can be kept.
  - It is marked plainly as keyed, not from the ledger, wherever it appears, and
    it never feeds the statements, the review or the audit.

## 5. Balance sheet — several comparatives at once, and ratios

**a. More than one comparative, and any period end.** Today COMPARE WITH offers
one column, the same month last year. The partner wants **Aug 2026 against Dec
2025 and against Dec 2024** on the same sheet — the current position beside the
last two audited year ends, which is what a conversation with a client actually
needs. So:
  - The comparative is a **list, not a choice**: add as many columns as wanted.
  - Each column is any month end the ledger reaches, not only the same month a
    year back. Year ends are the common case, so offer them first.
  - MOVEMENT is against the column immediately to its left, and the heading says
    which two it is comparing.

**b. Ratios.** They need the profit and loss as well as the balance sheet, so they
belong on their **own screen**, not squeezed onto this one — with the headline few
also shown at the foot of the balance sheet.

Proposed list, for the partner to cut or add to:

| | |
|---|---|
| **Liquidity** | Current ratio · Quick (acid test) ratio · Working capital |
| **Efficiency** | Debtor days · Creditor days · Stock days · Cash conversion cycle · Stock turnover |
| **Profitability** | Gross margin · Net margin · Return on capital employed · Return on equity |
| **Gearing** | Gearing (debt to equity) · Interest cover · Debt to total assets |
| **Growth** | Revenue growth · Gross profit growth |

Rules for the screen, so it survives being put in front of a client:
  - Every ratio shows **the two figures it is made from**, not just the result.
  - Every ratio runs **across the same columns as the balance sheet**, so the
    trend is visible rather than a single number in isolation.
  - A ratio that cannot be computed says why — no denominator, no prior year —
    rather than printing a dash or a zero.
  - Ratios are read-only and derived; nothing here is keyed.

## 6. A second cash flow — where the money actually came from and went

The indirect statement stays as it is; it is right and it proves out. What is
missing is the **direct** one: money in and money out, by bank account, month by
month, showing who was paid and what for. It is the sheet a client conversation
about funding the next quarter is held over.

**Its own screen**, named so the difference is obvious — *Cash in and out* — with
a line on the existing Cash flow screen pointing to it and saying how they differ:
one explains the movement, the other lists it.

**Shape.** Months across for the year chosen, exactly like the Management summary.
Down the side:

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

**Where it comes from.** Every posting on a bank or cash account has another side,
and that other side says what the money was for — the supplier, the customer, the
expense line. Group by the contra account through the existing mapping, so this
needs no new import and no new keying.

**It must answer "who".** Clicking a figure lists the counterparties behind it —
who was paid, how much, on what date, with the journal reference so it can be
found in BTMS. A "largest twenty payments this month" list beside it is what the
partner will actually point at in a meeting.

**Per account and combined.** The ACCOUNT selector already on this screen applies:
all accounts together, or one bank at a time, because a client with three banks
wants to know which one is carrying the strain.

**For preparing the next months** — worth adding, for the partner to accept or
drop: a column for the **monthly average over the year to date**, so the
conversation about what next quarter needs starts from what the last months
actually cost rather than from a guess.

## 7. Expense analysis — two views, and the detail behind each line

**a. Two ways to lay it out**, chosen at the top:
  - **Months across** for the chosen year, like the Management summary — the
    sparkline in the MONTHLY SHAPE column is too small to read a figure off and
    should give way to real month columns.
  - **Years across**, the last **three or five** — the partner's own words — so a
    line that has drifted upward over several years is visible as a trend rather
    than as one number against last year.

Keep % of sales and the change column in both.

**b. "Need more details" — read as drill-down**, since every line on this screen
is a report line summing several nominal accounts and there is currently no way to
see inside one. Confirm with the partner, then build two levels:
  - Click a line — say Office and administration, 8.116 — and it opens to the
    **nominal accounts** under it with their own figures across the same columns.
  - Click an account and it opens the **postings**: date, journal, reference,
    narrative, amount, so the item can be found in BTMS.

That also answers the questions this screen provokes: professional fees down
10.245, advertising down 4.056 — the first thing anyone asks is *what was in it
last year that is not in it this year*, and today the screen cannot say.

**c. Sort and hide.** Sort by any column, and hide lines that are nil in every
period shown, so a client pack does not carry rows of zeros.

## 8. Sales analysis — the shape is right, the comparisons are thin

The partner likes this screen. Three additions, no rebuild.

**a. Better comparisons.** Same as elsewhere: **three or five years across**, not
only the same period last year, and **Budget** as a chosen comparison where one is
keyed for the period.

**b. More on the top row.** Today: net sales, gross profit, invoices issued,
average invoice, credit notes, customers invoiced. Add, for the partner to cut:
  - **New customers** in the period — accounts with a first-ever sale.
  - **Customers lost** — bought in the same period last year, nothing this year.
  - **Top ten as a share of sales** — concentration, the single most useful number
    on the screen for a conversation about risk. CSP Joint Venture alone is 82.543.
  - **Credit notes as a share of sales** — 98 notes and 55.645 returned is 4,9% of
    revenue, which is a question worth asking.
  - **Sales per month**, as a run rate for the year to date.

**c. Sales ratios, for the discussion.** A block on this screen — separate from
the balance sheet ratios of item 5, because these are about the customers rather
than the position:

| | |
|---|---|
| Concentration | Top 1 · top 5 · top 10 as a share of sales |
| Mix | New customer revenue vs repeat · revenue per customer |
| Quality | Credit note rate · average invoice value and its trend · gross margin by month |
| Collection | Debtor days · share of debtors over 90 days · average days to pay, largest customers first |
| Growth | Revenue growth · growth of the top ten against the rest |

Each shows the figures behind it and runs across the same columns as the table,
same rules as item 5.

## 9. The left rail — out of proportion

Belongs with item 3, but it is the rail rather than the reports.

**a. The group headings** — REPORTS · LEDGERS · REVIEW · CONFIGURE — are set very
small and very light against the item labels beneath them. One step bigger and
bolder, so the rail reads as four groups rather than one long list.

**b. "PC Prime & Calculate Consultants Ltd" at the foot** is the smallest type on
the screen and wraps onto two lines. It is the practice's own name on a document
that goes to a client: set it at the same size as the rail items, on one line,
with room above it.

**c. Wasted width, again** — the ninth screen it has been raised on. Written up
once as item 10.

## 10. VAT — leave it, apart from the width
The partner will judge this screen properly once the returns are attached and the
client data is complete. No change wanted now beyond the width.

Note it already carries the right mechanism — a row per quarter with an **Attach**
action for the return as filed, and an OUTCOME column reading "not tested". What
it needs is the importers and the box-by-box comparison, which are **item 7 of
FIX-2 and still outstanding**. Do not touch this screen twice: finish FIX-2 item 7
and leave the rest until the partner has looked again.
