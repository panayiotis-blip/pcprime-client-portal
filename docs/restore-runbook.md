# Database Restore Runbook — PC Prime Portal

**Purpose:** how to recover the portal's data after accidental deletion, corruption,
or a bad migration. Keep this short and current. Do a **drill** at least once so the
steps are familiar *before* a real incident.

> Hosting: Supabase (Postgres + Storage). Plan: **Pro** (required for Point-in-Time
> Recovery). Frontend: Vercel. Repo: `pcprime-client-portal`.

---

## 0. Who & when

- **Who can run a restore:** _<fill in name(s)>_ — needs Owner access to the Supabase
  project and the Supabase account login.
- **When to use it:** data was deleted/overwritten and cannot be fixed in-app (e.g. a
  bad bulk update, a wrong migration, mass deletion), or the database is corrupted.
- **First, don't panic and don't keep writing.** Every new write makes a clean
  point-in-time restore harder. If a bad process is running, stop it first.

---

## 1. Decide the recovery point

Pick the **timestamp just BEFORE** the damage occurred (e.g. "today 14:05, just before
the bulk delete at 14:07"). Note it in the local timezone and confirm what that is in UTC.

Two recovery sources, in order of preference:

1. **Point-in-Time Recovery (PITR)** — Supabase Pro, ~7-day window. Restores to any
   second within the window. Use this for almost all incidents.
2. **Daily automated backup** — coarser (whole-day granularity). Fallback if the
   incident is outside the PITR window.
3. **Off-site weekly `pg_dump`** (see §5) — last resort if the Supabase project itself
   is unrecoverable.

---

## 2. PITR restore (the usual path)

> ⚠️ A restore **rewinds the entire database** to the chosen time. **Anything written
> after that timestamp is lost**, and the project is briefly **unavailable** during the
> restore. Tell staff first.

1. Supabase Dashboard → your project → **Database → Backups → Point in Time**.
2. Choose the **date & time** from §1 (mind the timezone shown).
3. Start the restore and confirm. Wait for it to complete (minutes, depending on size).
4. Storage objects (uploaded files) are versioned separately — see §4.

**Safer alternative for a DRILL (no production downtime):** restore into a **separate
staging project** instead of the live one, if Supabase offers "restore to new project"
in your plan, or spin up a fresh project and load the latest `pg_dump` (§5) there.
Verify the procedure end-to-end there before ever touching production.

---

## 3. Post-restore verification checklist

After any restore, confirm before declaring "done":

- [ ] You can **log in** (staff + a test client).
- [ ] Spot-check row counts / latest records in key tables: `clients`, `invoices`,
      `client_invoices`, `customer_invoice`, `client_messages`, `client_expense`,
      `advisor_report`, `documents`.
- [ ] The **damaged data is back** to its pre-incident state.
- [ ] Recent **legitimate** records that were created before the recovery point are present.
- [ ] **Storage files** open (a document, an invoice attachment, a logo).
- [ ] `pg_cron` jobs still listed: `select * from cron.job;`
- [ ] No errors on the dashboard; the app loads normally.

---

## 4. Storage (uploaded files)

Database PITR restores table rows, **not** Storage objects automatically. If files were
also deleted:
- Check the affected bucket(s): `client-expenses`, `advisor-reports`,
  `client-email-attachments`, `client-logos`, `invoice-files`, KYC bucket.
- Restore from the off-site copy (§5) if files are genuinely gone. (Rows pointing at
  missing files will show broken links until the files are restored.)

---

## 5. Off-site logical backup (belt-and-braces)

> _Status: TODO — set this up before go-live (see go-live checklist)._

Weekly `pg_dump` to encrypted off-site storage, in case the whole Supabase project is lost.

- **Create a dump:** `pg_dump "$SUPABASE_DB_URL" -Fc -f pcprime-YYYY-MM-DD.dump`
  (connection string from Supabase → Project Settings → Database; use the pooler/direct
  URL as documented there).
- Store encrypted, off Supabase (e.g. encrypted blob storage), retain ~8 weeks.
- **Restore from a dump (into a fresh project):**
  `pg_restore --clean --no-owner -d "$TARGET_DB_URL" pcprime-YYYY-MM-DD.dump`

---

## 6. After the incident

- Write 3 lines: what happened, recovery point used, what was lost (if anything).
- If a migration caused it, fix the migration in the repo so it can't recur.

---

## Drill log

Record each rehearsal so we know the steps actually work.

| Date | Who | Method (PITR / dump) | Restored into | Result / notes |
|------|-----|----------------------|---------------|----------------|
|      |     |                      |               |                |
