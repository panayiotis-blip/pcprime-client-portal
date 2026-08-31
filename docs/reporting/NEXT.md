# Three changes the partner has asked for

All three are front-end work in this repo. The database side of each is already
there — do not add tables, columns or functions for any of them.

The partner's summary of the whole idea, in his own words: *the BTMS data folder is
where the CSV or Excel files are stored that are uploaded, or re-uploaded, on the
app.* One folder per client, in the portal, holding what was received; the reporting
app reads from it and never keeps its own copy.

---

## 1. Choose the reporting clients from the client record, not from a separate screen

**Built.** `BooksInBtms.tsx` on Client info, writing through
`src/services/reportingSettings.ts`; the two bulk buttons are gone from
`ReportingSetup.tsx`.

**What is wanted:** a tick on the client's own page in the portal that says whether
this client's books are on BTMS, and whose BTMS. Only clients marked one of those
appear in the reporting app's client picker.

**What already exists:**

- `reporting.client_settings.data_source` — `'none' | 'btms_local' | 'btms_client' | 'other'`,
  with `other_program` for the name of whatever else they use.
- `reporting.clients_for_reporting()` already returns only `btms_local` and `btms_client`.
- The values are set today, from the partner's own list: **32 on our BTMS, 4 on the
  client's own, 27 not offered.** PC Prime's own books are deliberately out.

**What to build:** put the control on the client record — the Documents tab beside
the BTMS data folder is the natural home, or Client info if that reads better.
Three states, plainly worded, in the partner's own language:

```
Books kept in BTMS
  ( ) Not on BTMS            → data_source 'none'   (or 'other' + other_program)
  ( ) On our BTMS            → data_source 'btms_local'
  ( ) On the client's BTMS   → data_source 'btms_client'
```

Write straight to `reporting.client_settings` for that `client_id`, upserting the row
if it does not exist. The reporting app's own setup screen can stay as the bulk view,
but the client record is now the place a person changes one client.

**Remove the two bulk buttons** on `ReportingSetup.tsx` — "All on our BTMS" and "All
on the client's BTMS". One of them is how all 63 clients came to be marked as ours,
which is what made the picker useless. A per-client decision should take a per-client
action.

---

## 2. One place for a client's BTMS files: the client's own folder in the portal

**What is wanted:** every client's BTMS exports live in that client's **BTMS data**
folder in the portal. The reporting app reads from there — it looks in the folder for
anything new or changed when the client is opened, and offers to import it. Nothing
is loaded from a folder on somebody's laptop, and no file can land under the wrong
client because the folder *is* the client.

**What already exists — all of it:**

- `public.btms_data_folder(client_id)` (migration 204) creates the client's "BTMS
  data" folder on demand, in the portal's own `folders` / `documents` tables, under
  the private `documents` bucket, governed by the portal's access model.
- `src/reporting/lib/import/portalFolder.ts` already uploads into that folder,
  records the `public.documents` row, and logs `reporting.btms_file_checks`.
- `PortalFolderPanel.tsx` already lists it and imports from it.

**What is wrong:** there are still two paths. Five importers upload to a *separate*
`reporting-imports` bucket instead:

```
src/reporting/lib/import/ledgerImport.ts        → storage.from('reporting-imports')
src/reporting/lib/import/chartImport.ts         → storage.from('reporting-imports')
src/reporting/lib/import/trialBalanceImport.ts  → storage.from('reporting-imports')
src/reporting/lib/import/stockImport.ts         → storage.from('reporting-imports')
src/reporting/lib/import/payrollImport.ts       → storage.from('reporting-imports')
```

That is where every file loaded so far actually went — 17 objects in
`reporting-imports`, and **nothing** in the client's BTMS data folder. The right path
was built and then bypassed.

**What to build:**

1. Make `portalFolder.ts` the only way a file is stored. The five importers keep
   their parsing and their commit logic; they stop calling
   `storage.from('reporting-imports')` and take the file from the client's folder
   instead.
2. Migrate the 17 existing objects into the client's BTMS data folder, with a
   `public.documents` row each, then leave the `reporting-imports` bucket empty. Do
   not delete the bucket in the same change.
3. On opening a client, list the folder and compare against
   `reporting.btms_file_checks` by sha256. Show what is **new**, what has **changed**
   since it was last imported, and what is already in — then let the person import
   the new and changed ones in one action. This is the "looks in that folder for
   changes or updates" the partner asked for.
4. The folder stays the record of what was received: never delete from it on import.
5. **Re-uploading is normal, not an error.** A month gets re-exported from BTMS after
   a correction, and the new file must be able to sit beside the old one. Keep both
   documents; the newest for a feed and period is the one the app offers, the older
   one stays as the record of what was reported at the time. `commit_ledger_import`
   already replaces only the months the file covers, so a re-import of one month does
   not disturb the rest.

**Acceptance:** loading a client's six journal listings, chart of accounts, trial
balances, stock valuations and payroll files into the client's BTMS data folder from
the portal, then opening that client in the reporting app, offers exactly those files
for import and nothing else — with no upload step inside the reporting app at all.

---

## 3. In the BTMS data folder, the document type is the BTMS feed

**What is wanted:** the upload box inside a client's **BTMS data** folder should offer
the files we are actually allowed to import — not the portal's general document types
— and then ask for the period in the form that feed needs.

The generic list (Invoice received, Credit note, Receipt, Contract, Agreement,
Certificate…) is right for every other folder and wrong for this one. Nothing in it
names a journal listing, so a file loaded there cannot be recognised.

**The list, and what each one needs asked:**

| Document type | Period control | Goes to |
|---|---|---|
| Analytical journal listing | Year, or from/to month | `feed = 'ledger'` |
| Trial balance — monthly | Month | `trial_balance`, `is_annual = false` |
| Trial balance — annual | Year | `trial_balance`, `is_annual = true` |
| Chart of accounts | none — it is not a period | `coa_accounts` |
| VAT figures summary | Quarter | `vat_periods` |
| VAT return as filed | Quarter | `vat_returns` |
| Payroll cost analysis | Month | `payroll_periods` / `payroll_lines` |
| Payroll paysheet listing | Month | `payroll_periods` / `payroll_lines` |
| Stock valuation | **Exact date** — the count date | `stock_valuations.valued_at` |
| Sales invoice listing | Month | later |
| Bank statement (camt.053 XML) | Month | later |
| Other / supporting document | Month, optional | held, not parsed |

Three shapes of period control, not one: **month** (what the box does today), **year**
(journal listing, annual trial balance), and **an exact date** (stock valuation — the
date the count was taken, which no BTMS export contains and which nobody can recover
afterwards). Quarter can be a month picker labelled as the quarter end if that is
simpler.

**Why it matters beyond tidiness:** the period the person types here is the only place
two facts exist at all — the trial balance's period and the stock count date. Both are
absent from the BTMS file itself. `public.documents` already has `year` and `month`
columns waiting for exactly this; a date column or a `period_end` on the document row
covers the stock case.

**Scope it to the folder.** Only the BTMS data folder gets this list — every other
folder keeps the portal's general document types. Key it off
`folders.category_key = 'btms'`.

**Then the reporting app has no upload of its own.** It reads the folder, sees a file
tagged "Trial balance — monthly, July 2026", and knows what it is and what period it
covers before it opens it. That is the whole point of putting the files here.

---

## Do not change

- `reporting.staff_can_access()` and `reporting.is_reporting_staff()` — settled in
  migration 214 and now match `isStaffRole()` in `src/services/api.ts` exactly:
  owner, supervisor, admin, staff. `app_user` is a client-side mini-app login and is
  correctly excluded. If a person needs the reporting app they are given a staff
  role on the users screen.
- The VAT sign rule in `reporting.vat_figures` — migration 211. It was adding
  purchase returns to input tax instead of subtracting them.
- `has_stock` / `has_payroll` — migration 211 backfilled them and added triggers so
  they follow the data. Do not reintroduce a switch someone has to remember.
