# Partner's review of the built app — running list

Collected screen by screen. Turned into a work order when the review is closed.

## 1. The Rebuild button — remove it
Bottom right of the report, beside "36 clients · built at 19:33". Its purpose is
not clear to the person using it and it should not be there.

## 2. The Client setup switches must be settable, per client, before any data
The ON/OFF column on Client setup is a statement today, not a control. It must be
a real per-client choice, made when the client is first set up — **before a single
file is imported** — so the sections a client gets are decided deliberately rather
than appearing once data happens to arrive.

## 3. "The folder has 1 new and 0 changed file" — unclear, broken, badly named
Three faults in one panel on Data import.

**a. It signs you out.** Pressing "Read the new and changed files" errors and
sends the person back to sign in. This is the same fault already fixed once for
the Upload button (commit 641c43d) and it is back, or was never fixed on this
path. Nothing else on this list matters until it works.

**b. Nobody can tell what it is for.** It compares the client's BTMS data folder
against what has already been read, by sha256 rather than by name — so a file
re-exported after a correction shows as changed even though its name and period
did not. Say that in the panel, in one line, in plain words: *"These files are in
the client's BTMS folder but have not been read into the ledger yet."*

**c. The names and the period read wrong.** The file column shows the raw BTMS
export name — `a&f tb 01 2026.xls` — because the 18 files were migrated from the
old bucket rather than uploaded through the new path, which derives the name from
the type and period. Two things to fix:
  - Show the derived name — **Trial balance — January 2026** — with the original
    BTMS file name underneath in small type, since that is what a person searches
    for when they go looking for the export itself.
  - The period reads `2026-01-01`. A monthly feed shows **January 2026**; a yearly
    one **2026**; only a stock valuation shows a full date, because only it is a
    count on a day.
  - Backfill the derived names onto the 18 migrated documents so the folder does
    not stay half in one naming scheme and half in the other.

**d. Renaming.** There must be a way to correct a file's type or period after the
fact — it is the only two facts a person types, and a typo currently cannot be
undone. Editing the document row is enough; it renames the file with it.

## 4. VAT — the two VAT feeds are stored but never read
Uploading a VAT figures summary produces *"Stored. It is kept with the client for
the review; there is no importer for this one yet."* The file goes into the VAT
folder correctly, the row stays **OUTSTANDING**, and to the person it reads as a
failed import.

`src/reporting/upload/feeds.ts` marks both VAT feeds `imported: false`. That was
a placeholder and it has to end here, because VAT is the one screen the partner
asked to *calculate and flag variances against the return as filed*.

**a. Write the two importers.**
  - **VAT figures summary** — BTMS's own computation of the return for a quarter,
    into `reporting.vat_periods`.
  - **VAT return as filed** — the return actually submitted, with its payment
    slip, into `reporting.vat_returns`. It may be a PDF; the boxes are keyed
    beside it if it cannot be parsed.

**b. Then make the VAT screen do the comparison.** Three columns per quarter —
what the app rebuilds from the journal, what BTMS computed, what was filed — and
a flagged variance on every box that disagrees. There is a live one waiting:
**A&F Q2 2026 box 4 rebuilds to €64.100,43 against €64.914,16 filed, €813,73
short**, with boxes 1 to 3 agreeing exactly. The screen must show that difference,
not reconcile it away.

**c. A stored file is not outstanding.** Any feed held for the review rather than
parsed gets its own state — **STORED** — not OUTSTANDING, and the dialog says what
happened in plain words rather than reading like a failure.

## 5. The BTMS folder on the portal: file it, re-file it, and say what it is
The 18 documents are in the folder and the app reads them, which is right. Three
things are missing from the portal side.

**a. Choose the document type on every upload.** The "+ Upload" at the top of the
Documents tab, and the one on the folder itself, must ask which BTMS report this
is and then the period that report needs — the same list and the same questions as
the feed list, and the file is filed into the matching subfolder from that answer.
A file cannot arrive without a type.

**b. Move a file between folders without deleting and re-uploading it.** Every
document card needs a **Move to…** action beside View. Filing a journal listing
into Ledgers by mistake must be a correction, not a deletion and a fresh upload —
the upload is the record of what was received and re-uploading destroys the date
it arrived on. Changing the folder changes the feed the app treats it as, so the
same action edits the type and period, and the derived name follows.

**c. The card does not say what the file is.** Every card reads `Btms Export` with
a bare number badge — `06`, `12`, `01` — which is the month with nothing to say so.
Print the feed and the period in words: **Trial balance · January 2026**, **Journal
listing · 2024**, **Stock valuation · 31 Dec 2025**, and the original BTMS export
name underneath in small type as it already does for the VAT file.

## 6. Reconciliation — right idea, unreadable
This is the completeness control, and it is the reason the whole thing can be
signed off: the journal must balance on its own, **and** it must agree to the
trial balance BTMS produced for the same period. The first proves the ledger is
internally consistent; only the second proves nothing is missing from it. As
built, nobody can tell that is what they are looking at.

**a. The numbers are formatted wrongly.** It prints `516.283.99` — a full stop for
both the thousands and the decimal. Everywhere else the app reads `989.570,57`.
Fix it to the same format: **516.283,99**, and `1.820` postings.

**b. Say what it is and what it wants, in one line each.** "The journal balances
on its own" is a result, not an explanation. Lead with the point: *nothing here
proves the month is complete until a BTMS trial balance for it is loaded.*

**c. Make it act instead of instruct.** "Import the BTMS trial balance for the
period" is a sentence asking the person to go and find the right screen. It should
be a button that opens the upload for **Trial balance, monthly — August 2026**,
with the feed and the period already filled in.

**d. The grid of empty boxes reads as failure.** For 2023 it shows Trial balance
monthly `0/12`, Stock valuation `0/12`, VAT figures summary `0/12` — a wall of
blanks for a closed year where the annual trial balance is all that is wanted, and
which the row above already reports as loaded. Only ask for what that client and
that year actually need, and say plainly what a blank box means.
