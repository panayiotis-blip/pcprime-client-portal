# Three changes the partner asked for — what was built

All three are done. This file is now the record of what was wanted and
what it became; `STATUS.md` says where the whole build stands, and `FIX.md` is the
order the work was done in.

The partner's summary of the whole idea, in his own words: *the BTMS data folder is
where the CSV or Excel files are stored that are uploaded, or re-uploaded, on the
app.* One folder per client, in the portal, holding what was received.

| | | |
|---|---|---|
| **1** | The BTMS tick on the client record | **Built** |
| **2** | The client's folder as the single store | **Built**, comparison included, and the seventeen existing files are in the folder |
| **3** | BTMS feeds as the document types in that folder | **Built** (§3 as written here was superseded by `FIX.md` §4, which is what was built) |

---

## 1. Choose the reporting clients from the client record

**Built.** `BooksInBtms.tsx` sits on the Client info tab and writes through
`src/services/reportingSettings.ts` to `reporting.client_settings`. Three states, in
the partner's own words:

```
Books kept in BTMS
  ( ) Not on BTMS            → data_source 'none'   (or 'other' + other_program)
  ( ) On our BTMS            → data_source 'btms_local'
  ( ) On the client's BTMS   → data_source 'btms_client'
```

Picking "Not on BTMS" offers an optional box for what they *do* use, which records
`'other'` with the program named, so nobody has to ask again. Only the two BTMS states
are offered by `clients_for_reporting()`, which is unchanged.

It writes straight through rather than joining the tab's Edit / Save cycle: the value
is not a column on `public.clients`, it is one row in another schema, and threading it
through the whole client form for a single radio would be a great deal of machinery
for a fact that takes one click. The upsert names only `data_source` and
`other_program`, so the row's other settings — year end, VAT scheme, `has_stock` —
survive a change of mind.

**The two bulk buttons are gone** from `ReportingSetup.tsx`. One of them is how all 63
clients came to carry `btms_local`, which is what made the client picker useless. A
per-client decision takes a per-client action. The screen keeps its bulk view and its
count of clients nobody has placed yet; that count now says where to place them
instead of offering to guess.

---

## 2. One place for a client's BTMS files: the client's own folder

**What was wanted:** every client's BTMS exports live in that client's **BTMS data**
folder in the portal. That folder is the single store, and there are two ways a file
gets into it and only one place it lands — filed on the portal in the ordinary way, or
uploaded by whoever is reviewing, without leaving the report.

**Built:**

- `portalFolder.ts` is the only code that stores a BTMS file. `storeInBtmsFolder()`
  checks it and puts it in the client's folder; the five importers take an
  `ImportSource` and record where the folder put it instead of uploading a second
  copy. **Nothing in `src/` writes to `reporting-imports` any more.**
- Both ways in go through that one door, so a file uploaded on the report is
  afterwards indistinguishable from one filed on the portal: same check, same
  subfolder, same derived name, same `public.documents` row.
- The folder never loses anything on import. Replacing marks the earlier copy
  superseded — it stays as the record of what was reported at the time — and "Keep
  both" is offered because two exports of one month are sometimes two different
  things, and that is the person's call rather than the code's.

**Built — the sha256 comparison.** On opening a client the folder is compared with
what has been read, by digest: what is **new**, what has **changed** since it was
last imported, what is already in. It sits at the top of the template’s own Data
import screen with one button that reads the new and changed files, chart of
accounts first. Nothing is imported without being asked for.

**Done — the seventeen existing objects.** Moved into the client’s subfolders with
their real names back, every import row repointed, nothing deleted:
`reporting-imports` still holds its 17 objects and 41,3 MB until somebody agrees it
is redundant. Run first as a dry run, which is what found the three faults in the
plan — see the commits.

Its first real test, straight after the move: **16 loaded, 1 not read** —
`a&f tb 01 2026.xls`, whose import was withdrawn. In the folder, not in the ledger,
and now said out loud.
---

## 3. In the BTMS data folder, the document type is the BTMS feed

**Built, by way of `FIX.md` §4**, which superseded the plan written here: the
subfolders came with it, so the type now decides the folder as well as the questions.

The eleven feeds, and what each one is asked (`src/reporting/upload/feeds.ts` — one
list, used by the report's Upload button and the portal's Documents tab alike):

| Document type | Period control | Subfolder |
|---|---|---|
| Analytical journal listing | Year | Journal listings |
| Trial balance, monthly | Month | Trial balances |
| Trial balance, annual | Year | Trial balances |
| Chart of accounts | none — it is not a period | Chart of accounts |
| VAT figures summary | Quarter | VAT |
| VAT return as filed | Quarter | VAT |
| Payroll cost analysis | Month | Payroll |
| Payroll paysheet listing | Month | Payroll |
| Stock valuation | **Exact date** — the count date | Stock |
| Sales invoice listing | Month | Sales |
| Bank statement (XML) | Month | Bank |

Three shapes of period control, because there are three shapes of period. It matters
beyond tidiness: the trial balance's period and the stock count date exist **nowhere
else at all** — neither is in the BTMS file — so they are asked for while the person
still knows. `documents.year` and `documents.month` carry the first;
`documents.period_end` (migration 215) carries the count date.

The name is derived from the type and the period — "Trial balance — 2026-07.xls" —
never keyed, and never the checksum the old bucket named its objects by. What BTMS
called the export is kept as a note on the row, because that is what a person searches
for when they go looking for the file itself.

**Scoped to the folder**, keyed off `folders.category_key` starting `btms`, so a
folder somebody renames still behaves and every other folder in the portal keeps the
general document types.

---

## Do not change

- `reporting.staff_can_access()` and `reporting.is_reporting_staff()` — settled in
  migration 214, and matching `isStaffRole()` in `src/services/api.ts` exactly: owner,
  supervisor, admin, staff. `app_user` is a client-side mini-app login and is
  correctly excluded. If a person needs the reporting app they are given a staff role
  on the users screen.
- The VAT sign rule in `reporting.vat_figures` — migration 211. It was adding purchase
  returns to input tax instead of subtracting them.
- `has_stock` / `has_payroll` — migration 211 backfilled them and added triggers so
  they follow the data. Do not reintroduce a switch someone has to remember.
- `btms_folder_for()` — migration 215. The mapping from a report's kind to its folder
  lives in the database because both ways in have to agree, and two copies of the same
  rule is how they stop agreeing.
- The keys sign-offs are stored under. The review's is the **template's** own —
  `check|month|account|reference|amount` — not `reporting.exceptions.ex_key`, which is
  the database's key for the same row and matches nothing the template ever wrote.
  Working papers are namespaced `wp|month|ref|prep` so the two cannot collide.
- `public/reporting-template.html`. It is the specification. If a screen must change,
  the partner changes the prototype and it is rebuilt from that; everything the
  application needs to alter is a named, anchored patch in
  `tools/build-reporting-app.mjs` that fails the build if the template moves under it.
