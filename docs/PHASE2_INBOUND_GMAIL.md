# Shared Inbox (info@) — Connect & Deploy Runbook

> One place to wire up the portal's **shared `info@primeandcalculate.com`
> Inbox** to Gmail. All the **code is already shipped** on `main`; this guide is
> the **manual setup** (Google + Supabase) that turns it on.
>
> Platform: the firm runs **Google Workspace (Gmail)** on `primeandcalculate.com`.
> There is **no Microsoft 365** — ignore any older Graph/Outlook notes. The
> `send-via-outlook` function is unrelated generic SMTP for per-staff sending.

---

## What this gives you

An Outlook-style shared inbox inside the portal (page: **Inbox**, `/inbox`,
staff-only), backed by the firm's real `info@` mailbox:

- **Receive** — every message in `info@` (Inbox / Sent / Spam / Trash) appears in
  the portal, with attachments, search, and a threaded conversation view.
- **Send** — Compose / Reply / Reply-all / Forward, sent **from `info@`** and
  threaded back into the Gmail conversation (lands in Gmail's Sent folder).
- **Manage** — Mark read/unread, Archive, Trash/Restore — synced **back to Gmail**.
- **File** — "Save to client" copies a message into a client's Emails tab + Documents.

It reads the `info@` mailbox **directly** via the Gmail API. There is **no
catch-all routing, no subdomain, and no DNS change** needed (that was the old
per-client capture design — see the note at the very end).

---

## Architecture (current)

```
  info@primeandcalculate.com  (Google Workspace mailbox)
        ▲  send / modify                 │  read (poll)
        │                                ▼
   ┌────┴───────────┐         ┌──────────────────────┐
   │  inbox-send     │        │  poll-inbox           │  ← pg_cron every 5 min
   │  (gmail.send)   │        │  (reads INBOX/SENT/…) │     + "Sync now" button
   │  inbox-action   │        └──────────┬───────────┘
   │  (gmail.modify) │                   │ writes
   └────┬───────────┘                    ▼
        │ writes              public.inbox_emails (+ inbox_email_attachments,
        └───────────────────▶  inbox-attachments bucket).  Cursor: email_sync_state.
                              Portal Inbox page reads these tables.
```

**Three Edge Functions**, all deploy with gateway **Verify JWT OFF** (each does
its own auth):

| Function | Scope used | Triggered by | Does |
|---|---|---|---|
| `poll-inbox` | gmail.readonly* | pg_cron (`x-cron-secret`) **or** staff "Sync now" (JWT) | Pull new mail → `inbox_emails` |
| `inbox-send` | gmail.send (+ modify to read reply headers) | staff (JWT) | Send compose/reply/forward from info@ |
| `inbox-action` | gmail.modify | staff (JWT) | Read/unread, archive, trash, untrash → Gmail + mirror |

\* You will mint **one** refresh token with **`gmail.modify` + `gmail.send`**
scopes and share it across all three (modify is a superset that covers reading).

---

# Setup — follow in order

Estimated ~45–60 min, mostly one-time Google admin. You must be a **Google
Workspace admin** and able to create a **Google Cloud project**.

---

## Part A — Google Cloud: Gmail API + OAuth refresh token

**A1. Create a project**
1. <https://console.cloud.google.com> → project picker → **New Project** →
   name e.g. `pcprime-portal-mail` → **Create**.

**A2. Enable the Gmail API**
1. **APIs & Services → Library** → search **Gmail API** → **Enable**.

**A3. OAuth consent screen — Internal**
1. **APIs & Services → OAuth consent screen**.
2. User type: **Internal** (org-only; no Google verification, and refresh tokens
   don't expire from inactivity the way external "Testing" apps do) → **Create**.
3. App name `PC Prime Portal Mail`, support email = yours → **Save and Continue**.
4. **Scopes** → **Add or remove scopes** → manually add **both**:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   → **Update** → **Save and Continue**.

**A4. Create the OAuth client**
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**, name `portal-mail-client`.
3. **Authorized redirect URIs** → add `https://developers.google.com/oauthplayground`.
4. **Create** → copy the **Client ID** and **Client secret**.

**A5. Mint the refresh token (as info@)**
1. <https://developers.google.com/oauthplayground> → **gear icon** (top right) →
   tick **Use your own OAuth credentials** → paste the Client ID + secret from A4.
2. Left panel **Input your own scopes** → paste **both**, space-separated:
   `https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send`
   → **Authorize APIs**.
3. **Sign in as `info@primeandcalculate.com`** and approve (continue past the
   "unverified/internal" notice — it's your own org app).
4. **Exchange authorization code for tokens** → copy the **Refresh token**.
   This is `GOOGLE_REFRESH_TOKEN`.

> If you ever re-mint with different scopes, redo A5 signed in as info@ and
> update the secret — the token carries the scopes it was granted.

---

## Part B — Supabase: secrets

Dashboard (project `ddwdrjhnfwpbtqzqgdsl`) → **Edge Functions → Secrets** → add:

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from A4 |
| `GOOGLE_CLIENT_SECRET` | from A4 |
| `GOOGLE_REFRESH_TOKEN` | from A5 |
| `GMAIL_ADDRESS` | `info@primeandcalculate.com` |
| `CRON_SECRET` | a long random string (used by the schedule; you'll also put it in Vault — Part E) |
| `FIRM_FROM_NAME` *(optional)* | display name on sent mail, e.g. `PC Prime & Calculate` |

Delete any obsolete `CLOUDMAILIN_*` secrets while here.

---

## Part C — Deploy the three Edge Functions

Dashboard → **Edge Functions** → for **each** of `poll-inbox`, `inbox-send`,
`inbox-action`: create/edit the function, paste the code from
`supabase/functions/<name>/index.ts`, set **Verify JWT = OFF**, deploy.

> These are not deployed on the live project yet — all three must be deployed.

---

## Part D — Run the migrations

Dashboard → **SQL Editor**, run **in order** (each is in `supabase/migrations/`).
All are idempotent (`if not exists` / `create or replace`), so re-running any that
were already applied is harmless — when in doubt, run the whole list:

1. `114_email_sync_state.sql` — the poller's cursor / last-run / last-error table.
2. `116_inbox_emails.sql` — the `inbox_emails` + `inbox_email_attachments` tables,
   RLS, and the `inbox-attachments` storage bucket.
3. `117_firm_email_settings.sql` — firm-wide email settings.
4. `118_inbox_labels.sql` — **adds the `label_ids` column to `inbox_emails`.**
   ⚠ Required: `poll-inbox` writes `label_ids` on every message and the folder
   tabs (Inbox/Sent/Spam/Trash) read it. Skip this and every poll fails with
   `column "label_ids" does not exist` and nothing syncs.
5. `124_inbox_sync_status.sql` — the staff-visible sync-health RPC
   (`get_inbox_sync_status`; depends on `public.is_admin()`, already in the DB).
6. `125_schedule_poll_inbox.sql` — schedules `poll-inbox` every 5 min and creates
   the Vault placeholders.

> `114`, `116`, `117`, `118` may already be applied from earlier work — re-running
> them changes nothing. The two that are definitely new are `124` and `125`.

---

## Part E — Set the cron secret in Vault

`125` schedules the poller to read its URL + secret from Vault. Set the real
cron secret (must equal the `CRON_SECRET` from Part B):

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'poll_inbox_cron_secret'),
  'PASTE_THE_SAME_CRON_SECRET_AS_PART_B'
);
```

The URL secret defaults to
`https://ddwdrjhnfwpbtqzqgdsl.functions.supabase.co/poll-inbox` — only change it
if the project ref differs.

---

## Part F — Verify

1. Portal → **Inbox**. The health line should no longer say "Never synced".
2. Click **⟳ Sync now** → it should report `Synced: N new, …` and recent `info@`
   mail should appear (threaded). If it errors, the message is the exact blocker.
3. Open a conversation → **Reply** with a short body → Send. Confirm it arrives
   at the other end, shows in the thread, and appears in Gmail's **Sent**.
4. **Archive** or **Trash** a message → confirm it moves folder in Gmail too.
5. Wait ~5 min without touching anything → "Last synced" should advance on its
   own (the cron schedule is working).

---

## Troubleshooting

Everything surfaces in the **Inbox** page now (no SQL needed for day-to-day):

- **"Never synced" / Sync now says "Gmail is not configured"** → a `GOOGLE_*` /
  `GMAIL_ADDRESS` secret is missing, or `poll-inbox` isn't deployed.
- **`invalid_grant` on Sync now** → the refresh token is wrong/revoked. Re-mint
  (A5) as info@ and update `GOOGLE_REFRESH_TOKEN`.
- **Send fails with a scope/permission error** → the token lacks `gmail.send`;
  re-mint with both scopes.
- **Auto-sync never advances but Sync now works** → the schedule or its secret is
  off. Check:
  ```sql
  select jobname, schedule, active from cron.job where jobname = 'poll-inbox';
  select status, return_message, start_time
    from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'poll-inbox')
    order by start_time desc limit 5;
  ```
  Then confirm `poll_inbox_cron_secret` in Vault equals the `CRON_SECRET` secret.
- **Raw health row** (service role / SQL editor): `select * from public.get_inbox_sync_status();`

---

## Note: the dormant per-client capture path (`poll-gmail`)

An earlier design filed mail **per client** via unique
`client-…@inbox.primeandcalculate.com` addresses, a Workspace **catch-all** into a
capture mailbox, and a `poll-gmail` function — and that *did* require a subdomain
+ MX/DNS at Squarespace. That path is **not the current Inbox** and is dormant.
⚠ `poll-gmail` and `poll-inbox` share the `email_sync_state` cursor and the
`GOOGLE_*` secrets, so **only one may be scheduled per mailbox** — for the shared
inbox, schedule **`poll-inbox` only** (migration 125 already unschedules any
`poll-gmail` job). The per-client "Save to client" need is met by the
**Assign to client** button in the shared Inbox instead.
