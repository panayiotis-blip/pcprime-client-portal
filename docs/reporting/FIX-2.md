> **`STATUS.md` is the record of what exists.** All four work orders are built;
> this file is kept for what it asked for and why.

> **All eight items are built and deployed.** `STATUS.md` says where the build
> stands and what is still unlooked-at. This file is kept as the record of the
> review and what each item turned into.

# Fix order 2 — the partner's review of the built app

Written as the current work order, when FIX.md was done. It is done in its turn;
what each item became is recorded in STATUS.md under *The partner's review*.

Eight items, in this order. The order is deliberate: 1 and 2 are cheap and they
block or discredit everything else.

---

## 1. "Read the new and changed files" signs you out

Pressing it on Data import errors and returns the person to the sign-in screen.
This is the same fault fixed once for the Upload button (commit 641c43d) and it is
back, or was never fixed on this path — the action races the router and drops the
session.

Nothing else on the Data import screen can be judged until this works. Find why
the session is lost, not a way to survive it: if the same pattern is on the Upload
button and the "Load files in the portal" link, fix all of them together.

**Acceptance:** pressing it reads the new and changed files, reports what it did,
and leaves the person where they were.

---

## 2. Every figure with decimals prints two full stops

`public/reporting-template.html`:

```js
const eur=(v,dp=0)=>(v<0?"(":"")+Math.abs(v)
  .toLocaleString("en-GB",{minimumFractionDigits:dp,maximumFractionDigits:dp})
  .replace(/,/g,".")+(v<0?")":"");
```

`en-GB` gives `516,283.99`; replacing the commas with full stops gives
**`516.283.99`**. The decimal point is never converted. Every two-decimal figure
in the application is printed this way — the reconciliation totals, the stock
variances, every average. Whole numbers happen to look right, which is why it
survived.

Use a locale that formats the way the practice writes numbers, rather than
patching one:

```js
const eur=(v,dp=0)=>(v<0?"(":"")+Math.abs(v)
  .toLocaleString("de-DE",{minimumFractionDigits:dp,maximumFractionDigits:dp})+(v<0?")":"");
```

Do the same for every bare `toLocaleString("en-GB").replace(/,/g,".")` on a count —
there are a dozen. Dates stay `en-GB`.

**Acceptance:** the reconciliation reads `516.283,99` and `1.820` postings, and no
figure anywhere in the report contains two full stops.

---

## 3. The Client setup switches must be a real per-client choice, made first

Today the ON/OFF column is a statement of what the payload builder decided. It has
to be the person's decision, taken **when the client is set up and before a single
file is imported**.

**a. Make them controls.** Clicking a switch writes to
`reporting.client_settings` through the host and the section appears or disappears.
Every section on that table gets a column; several do not have one yet.

**b. The person's choice outranks the data.** Migration 211 added triggers that
turn Stock and Payroll on when their data arrives. Keep them as a fallback only:
make the columns **nullable** — `null` means nobody has decided, and the old
behaviour applies; `true` or `false` is a decision and nothing may overwrite it.

**c. A client with no data must still reach this screen.** The report is built
from postings, and a brand-new client has none. Client setup, Company setup and
Account mapping must open on an empty client so the switches can be set before the
first import — that is the whole point of setting them first.

**Acceptance:** create a client with no data, open it, turn Stock off and Cash
movement on, sign out and back in — the choices hold, and the rail matches them.
Then import a stock valuation: Stock stays off, because a person said so.

---

## 4. Remove the Rebuild button

Bottom right of the report, beside "36 clients · built at 19:33". The partner
cannot tell what it does and it should not be there. The report already rebuilds
after an import; if a stale build is still possible, rebuild on that event rather
than asking a person to know when to press it.

---

## 5. The folder panel on Data import

**a. Say what it is for**, in one line, in plain words: *these files are in the
client's BTMS folder but have not been read into the ledger yet.* Then how it
knows: it compares by content, so a file re-exported after a correction reads as
changed even though its name and period did not.

**b. Show the derived name.** The panel prints the raw export name —
`a&f tb 01 2026.xls`. It should read **Trial balance — January 2026**, with the
original BTMS name underneath in small type, since that is what a person searches
for when they go looking for the export itself.

**c. The period reads `2026-01-01`.** A monthly feed shows **January 2026**, a
yearly one **2026**, and only a stock valuation shows a full date, because only it
is a count taken on a day.

**d. Backfill the eighteen migrated documents** with their derived names, so the
folder is not half in one naming scheme and half in the other.

**e. A type or a period must be correctable after the fact.** They are the only
two things a person types, and a typo currently cannot be undone. Editing the
document row is enough; the name follows it.

---

## 6. The BTMS folder on the portal

**a. Every upload asks the document type.** The "+ Upload" at the top of the
Documents tab and the one inside a folder must ask which BTMS report this is, then
the period that report needs, and file it into the matching subfolder from that
answer. No file arrives untyped.

**b. Move a file between folders without deleting it.** Every document card needs
a **Move to…** beside View. A misfiled export is a correction, not a deletion and
a fresh upload — the upload date is the record of when it was received, and
re-uploading destroys it. Moving it changes the feed the app treats it as, so the
same action edits the type and period and the derived name follows.

**c. The cards do not say what the file is.** Every one reads `Btms Export` with a
bare number badge — `06`, `12`, `01` — which is the month with nothing to say so.
Print **Trial balance · January 2026**, **Journal listing · 2024**, **Stock
valuation · 31 Dec 2025**, with the original export name underneath as the VAT
card already does.

---

## 7. VAT: the two feeds are stored and never read

Uploading a VAT figures summary answers *"Stored. It is kept with the client for
the review; there is no importer for this one yet."* The file lands correctly, the
row stays **OUTSTANDING**, and it reads as a failure.
`src/reporting/upload/feeds.ts` marks both VAT feeds `imported: false`. That
placeholder ends here — VAT is the one screen the partner asked to *calculate and
flag variances against the return as filed*.

**a. Write the two importers.** VAT figures summary — BTMS's own computation for
the quarter — into `reporting.vat_periods`. VAT return as filed — the return
actually submitted, with its payment slip — into `reporting.vat_returns`. The
filed return may be a PDF; where it cannot be parsed the five boxes are keyed
beside it.

**b. Then make the VAT screen compare.** Three columns per quarter — rebuilt from
the journal, computed by BTMS, filed — and a flagged variance on every box that
disagrees. There is a live one waiting: **A&F Q2 2026 box 4 rebuilds to €64.100,43
against €64.914,16 filed, €813,73 short**, with boxes 1 to 3 agreeing exactly. Show
that difference. Do not reconcile it away.

**c. A stored file is not outstanding.** A feed held for the review rather than
parsed gets its own state — **STORED** — and the dialog says what happened in
plain words instead of reading like an error.

---

## 8. The reconciliation panel

It is the completeness control and the reason a month can be signed off: the
journal balancing on its own proves it is internally consistent, and only agreeing
it to the BTMS trial balance for the same period proves nothing is missing. Nobody
can tell that is what they are looking at.

**a. Lead with the point**, not the result: nothing here proves the month is
complete until a BTMS trial balance for it is loaded.

**b. Make it act instead of instruct.** "Import the BTMS trial balance for the
period" should be a button that opens the upload for **Trial balance, monthly —
August 2026**, feed and period already filled in.

**c. The grid of empty boxes reads as failure.** For 2023 it shows Trial balance
monthly `0/12`, Stock valuation `0/12`, VAT figures summary `0/12` — a wall of
blanks for a closed year where the annual trial balance is all that is wanted, and
which the row above already reports as loaded. Ask only for what that client and
that year need, and say what a blank means.

---

## Do not touch

- `public/reporting-template.html` as a design. Item 2 is a bug fix inside it; the
  screens themselves are the specification and change only when the partner
  changes the prototype.
- `reporting.staff_can_access()` / `is_reporting_staff()` — migration 214.
- The VAT sign rule — migration 211.
- The parsers in `src/reporting/lib/btms/`.

A second review follows once these are done.
