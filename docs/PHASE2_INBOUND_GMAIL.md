# Phase 2 — Inbound Email Capture on the Gmail API

> Status: **planned, not built.** Outbound email (Phase 1) is already live via each
> staff member's own Gmail/SMTP through the `send-via-outlook` Edge Function.
> This document covers rebuilding **inbound** capture (the per-client **Emails
> tab**) after CloudMailin was cancelled.
>
> Platform: the firm runs **Google Workspace (Gmail)** on `primeandcalculate.com`.
> The domain is registered at **Squarespace Domains** (formerly Google Domains).
> There is **no Microsoft 365** — ignore any older Graph-based notes.

---

## 1. Goal

Restore the per-client **Emails tab** by reading mail from a Google Workspace
capture mailbox via the **Gmail API** and writing it into the same tables the old
CloudMailin function used. Each client keeps a unique capture address
(`client-<slug>-<rand>@inbox.primeandcalculate.com`); mail sent or forwarded to
that address is filed against the matching client.

### What is reused unchanged
- Tables `client_emails` and `client_email_attachments` (migration 029).
- Per-client `unique_email` column + generator/trigger (migration 029).
- Storage bucket `client-email-attachments` + its RLS.
- Recipient → client matching (match a message's `To`/`Cc` against `unique_email`).
- Dedup via the unique index on `(client_id, raw_message_id)`.
- The UI read path: `api.getClientEmails` + `ClientEmails.tsx`.

**No data migration is required.** Existing captured rows stay visible.

### What changes
- A new Edge Function **`poll-gmail`** replaces `inbound-email`.
- One small cursor table **`email_sync_state`**.
- Google Workspace + Google Cloud + Squarespace DNS setup (this guide).

---

## 2. Architecture

```
 Sender  ──▶  client-acme-ab12cd@inbox.primeandcalculate.com
                       │  (MX for the subdomain → Google)
                       ▼
        Google Workspace default-routing (catch-all) rule
                       │  rewrites envelope recipient → capture@primeandcalculate.com
                       │  (original To: header is preserved)
                       ▼
            capture@  Gmail mailbox  ◀── single mailbox the API reads
                       │
   (every 2–5 min)     │  Gmail API: history.list → messages.get → attachments.get
                       ▼
        Supabase Edge Function  poll-gmail  (service role)
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  client_emails (row)          client-email-attachments (Storage)
                               + client_email_attachments (rows)
```

**Matching:** even though the envelope recipient is rewritten to `capture@`, the
message's `To:`/`Cc:` headers still contain the original
`client-…@inbox.primeandcalculate.com`. `poll-gmail` scans those headers for the
first address equal to a live client's `unique_email`. No match → the message is
skipped (so unrelated mail landing in the capture mailbox is ignored).

**Direction:** sender address ending in `@primeandcalculate.com` ⇒ `outbound`
(we BCC'd ourselves), otherwise `inbound` — identical to the old logic.

**Ingestion = polling** (recommended). Gmail's `users.history.list` with a saved
`historyId` is the delta mechanism. Real-time push (`users.watch` + Google
Pub/Sub) is a later upgrade and is intentionally **out of scope** for v1.

---

## 3. The new Edge Function — `poll-gmail`

Invoked by a scheduler every 2–5 minutes. Per run:

1. **Authenticate the caller** — require a `CRON_SECRET` header. (Deploy with
   Verify JWT OFF; the function does its own check, like the other functions.)
2. **Get a Gmail access token** — POST the stored refresh token to
   `https://oauth2.googleapis.com/token` (grant_type=refresh_token) → access token.
3. **Delta fetch** —
   - Load `cursor` (last `historyId`) from `email_sync_state`.
   - If present: `GET /gmail/v1/users/me/history?startHistoryId=<cursor>&historyTypes=messageAdded`,
     following `nextPageToken`. Collect new message IDs.
   - If absent (first run): seed the cursor from `users.getProfile.historyId`
     and process recent messages via `users.messages.list` (e.g. last 7 days),
     so we don't replay the entire mailbox.
4. **Per message** — `GET /gmail/v1/users/me/messages/{id}?format=full`:
   - Parse headers: `From`, `To`, `Cc`, `Subject`, `Message-Id`, `Date`.
   - Resolve `To`+`Cc` → client via `unique_email` (skip if none / client soft-deleted).
   - Walk `payload` MIME parts for `text/plain` and `text/html` bodies
     (base64url in `part.body.data`).
   - Insert `client_emails` (map fields; `Message-Id` → `raw_message_id`).
     On unique-violation (`23505`) → skip (already captured).
   - For each attachment part (has `filename` + `body.attachmentId`):
     `GET /messages/{id}/attachments/{attachmentId}` → base64url `data` →
     decode → upload to `client-email-attachments` at
     `<client_id>/<email_id>/<i>__<safe-filename>` → insert
     `client_email_attachments` row. Skip inline images (`Content-Disposition: inline`).
5. **Persist** the newest `historyId` to `email_sync_state.cursor` + `last_run_at`;
   on failure store `last_error` and DO NOT advance the cursor (so the next run
   retries safely).

Portable from the old `inbound-email`: `safeFilename`, `parseFromHeader`, the
direction rule, the `client_emails` insert shape, and the attachment
decode→upload→insert flow. New: base64**url** decoding and MIME-part walking
(Gmail returns a tree of parts, not flat `plain`/`html` strings).

### Cursor table (new migration)

```sql
create table if not exists public.email_sync_state (
  mailbox     text primary key,
  cursor      text,            -- Gmail historyId high-watermark
  last_run_at timestamptz,
  last_error  text
);
-- service_role only; no authenticated access needed.
alter table public.email_sync_state enable row level security;
```

---

## 4. Secrets (Supabase → Edge Functions → Secrets)

| Secret | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token for the **capture mailbox** (gmail.readonly) |
| `GMAIL_ADDRESS` | `capture@primeandcalculate.com` |
| `CRON_SECRET` | Long random string; the scheduler sends it as a header |

The obsolete `CLOUDMAILIN_*` secrets can be deleted.

---

# Setup guide (follow in order)

Estimated time: ~1–2 hours, mostly one-time admin. Parts A–C are yours
(Google/Squarespace admin); Part D is the code/deploy side. Menu names in
Google consoles shift occasionally — if a label differs, search the console for
the capitalised term in the step.

> Prerequisites: you must be a **Google Workspace admin** (admin.google.com) and
> able to create a **Google Cloud project**. Confirm both before starting.

---

## Part A — Google Cloud: enable Gmail API + get a refresh token

**A1. Create a project**
1. Go to <https://console.cloud.google.com>.
2. Top bar → project picker → **New Project** → name it e.g. `pcprime-portal-mail` → **Create**.

**A2. Enable the Gmail API**
1. Left menu → **APIs & Services → Library**.
2. Search **Gmail API** → open it → **Enable**.

**A3. Configure the OAuth consent screen**
1. **APIs & Services → OAuth consent screen**.
2. User type: **Internal** (org-only — no Google verification needed) → **Create**.
3. App name `PC Prime Portal Mail`, support email = yours → **Save and Continue**.
4. **Scopes** → **Add or remove scopes** → manually add
   `https://www.googleapis.com/auth/gmail.readonly` → **Update** → **Save and Continue**.

**A4. Create the OAuth client**
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**, name `portal-mail-client`.
3. Under **Authorized redirect URIs** add:
   `https://developers.google.com/oauthplayground`
4. **Create** → copy the **Client ID** and **Client secret** (you'll store these as Supabase secrets).

**A5. Mint a refresh token for the capture mailbox**
> Do this step **after** Part B (the capture mailbox must exist first).
1. Go to <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top right) → tick **Use your own OAuth credentials**
   → paste the Client ID + Client secret from A4.
3. Left panel: in **Input your own scopes** enter
   `https://www.googleapis.com/auth/gmail.readonly` → **Authorize APIs**.
4. Sign in **as `capture@primeandcalculate.com`** and approve. (If prompted that
   the app is internal/unverified, continue — it's your own org app.)
5. Click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** — this becomes `GOOGLE_REFRESH_TOKEN`.
   (Refresh tokens for Internal apps do not expire from inactivity the way
   external "testing" apps do.)

---

## Part B — Google Workspace Admin: capture mailbox + subdomain + catch-all

**B1. Create the capture mailbox**
1. <https://admin.google.com> → **Directory → Users → Add new user**.
2. Create `capture@primeandcalculate.com` (this consumes one license unless you
   choose the "route into an existing mailbox" variant — see note at the end).

**B2. Add the capture subdomain**
1. **Account → Domains → Manage domains → Add a domain**.
2. Add `inbox.primeandcalculate.com` as a **secondary domain** (it has its own
   addresses; users stay on the primary domain).
3. Google shows a **TXT verification** record — you'll add it at Squarespace in Part C.
   It will also tell you the **MX** target (`smtp.google.com`).

**B3. Add the catch-all / default routing rule**
1. **Apps → Google Workspace → Gmail → Routing**.
2. Under **Default routing** → **Add** (configure a new rule).
3. **Specify envelope recipients to match** → **Single recipient** →
   **Pattern match** → regex: `.*@inbox\.primeandcalculate\.com`
4. **If the envelope recipient matches** → tick **Modify message** →
   **Change envelope recipient** → **Replace recipient** →
   `capture@primeandcalculate.com`.
5. (Recommended) also tick **Add X-Gm-Original-To header** so the original
   address is preserved as a header too (belt-and-braces; the `To:` header is
   already preserved).
6. **Save**. Routing changes can take up to ~24 h to fully propagate but usually
   apply within minutes.

---

## Part C — Squarespace Domains: DNS for the subdomain

1. Sign in at <https://account.squarespace.com> → **Domains** → select
   `primeandcalculate.com` → **DNS / DNS Settings**.
2. **Add the TXT verification record** from step B2 (host typically `inbox` or as
   Google specifies; value = the Google-provided token). Save, then return to
   Google Admin and click **Verify**.
3. **Add the MX record for the subdomain**:
   - Host / Name: `inbox`
   - Type: `MX`
   - Priority: `1`
   - Value / Data: `smtp.google.com`
   *(If Squarespace's editor doesn't accept the single modern record, use the 5
   legacy Google MX hosts — `ASPMX.L.GOOGLE.COM` (1), `ALT1`/`ALT2.ASPMX.L.GOOGLE.COM`
   (5), `ALT3`/`ALT4.ASPMX.L.GOOGLE.COM` (10) — all with host `inbox`.)*
4. Wait for DNS propagation (minutes to a few hours). Verify with:
   `nslookup -type=mx inbox.primeandcalculate.com`

---

## Part D — Supabase: secrets, function, schedule

**D1. Add secrets** — Supabase Dashboard → **Edge Functions → Secrets** → add the
five from the table in §4. Delete the old `CLOUDMAILIN_*` secrets.

**D2. Deploy `poll-gmail`** — paste `supabase/functions/poll-gmail/index.ts`
(written in the build step) into **Edge Functions → Create function**, **Verify
JWT OFF**, deploy.

**D3. Apply the migration** — run the new `NNN_email_sync_state.sql` in the SQL editor.

**D4. Schedule it** — via `pg_cron` + `pg_net` (SQL editor), every 5 minutes:
```sql
select cron.schedule(
  'poll-gmail',
  '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://<project-ref>.functions.supabase.co/poll-gmail',
       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET value>')
     ); $$
);
```
*(Or use the Supabase dashboard's scheduled-functions UI with the same header.)*

---

## Part E — Verify

1. Open a client in the portal, copy their capture address from the (re-enabled)
   banner on the client page.
2. Email that address from an outside account with a subject + a PDF attachment.
3. Wait one poll cycle, then check the client's **Emails tab**: the message and
   attachment should appear. Confirm the attachment downloads.
4. Send the same message again → no duplicate (dedup index).
5. Send a Greek-subject email and one **from** a `@primeandcalculate.com` address
   (should file as **outbound**).
6. Email a `client-…@inbox…` address that doesn't exist → silently ignored.

---

## Rollback / safety
- Until `poll-gmail` is live and verified, leave the dead `inbound-email`
  function in place; delete it only afterwards.
- The cursor only advances on success, so a failed run simply retries next cycle.
- `gmail.readonly` cannot modify or send mail — the function is read-only.

## Cost-saving variant (skip the dedicated mailbox)
Instead of a paid `capture@` user, point the catch-all at an **existing**
mailbox. `poll-gmail` only files messages whose `To`/`Cc` match a client
address and ignores everything else, so mixing is functionally safe. The
trade-off: the Gmail API token then has `readonly` access to that person's whole
mailbox. A dedicated `capture@` keeps the blast radius to a throwaway inbox and
is the recommended choice.

---

## Open decisions to confirm before building
1. Capture mailbox: **dedicated `capture@`** (recommended) vs route into an existing mailbox.
2. Firm domain confirmed as `primeandcalculate.com`, capture subdomain `inbox.primeandcalculate.com`.
3. Poll interval (default **5 min**).
