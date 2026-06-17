// =============================================================
// Supabase Edge Function: poll-gmail
// =============================================================
// Inbound email capture for the per-client "Emails" tab, rebuilt on the
// Gmail API (Google Workspace) after CloudMailin was cancelled. Replaces the
// legacy `inbound-email` webhook function.
//
// HOW IT WORKS
//   A Google Workspace catch-all routing rule funnels every
//   client-<slug>-<rand>@inbox.primeandcalculate.com address into ONE capture
//   mailbox (e.g. capture@primeandcalculate.com). This function is invoked on a
//   schedule (pg_cron / Supabase scheduled function), reads new mail from that
//   mailbox via the Gmail API, matches each message's To/Cc header against a
//   client's clients.unique_email, and files it into client_emails (+ attachments
//   in the client-email-attachments Storage bucket) — the SAME tables the old
//   function wrote, so the UI read path is unchanged.
//
//   Polling is incremental: the Gmail historyId high-watermark is stored in
//   public.email_sync_state (migration 114). The cursor only advances on a
//   successful run, so a failure simply retries next cycle.
//
// AUTH
//   - Caller: must send the shared CRON_SECRET as the `x-cron-secret` header.
//     Deploy with gateway "Verify JWT" OFF (this function does its own check).
//   - Gmail: OAuth refresh-token grant for the single capture mailbox, scope
//     gmail.readonly (read-only — cannot send or modify mail).
//
// REQUIRED Edge Function secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//   GMAIL_ADDRESS (the capture mailbox), CRON_SECRET
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided by the platform.)
//
// See docs/PHASE2_INBOUND_GMAIL.md for the full setup guide.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const GOOGLE_REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN') || '';
const GMAIL_ADDRESS        = (Deno.env.get('GMAIL_ADDRESS') || '').toLowerCase();
const CRON_SECRET          = Deno.env.get('CRON_SECRET') || '';

const FIRM_DOMAIN = 'primeandcalculate.com';
// On the very first run (no saved cursor) we process this much recent backlog
// so the mailbox isn't replayed in full.
const SEED_QUERY = 'newer_than:7d';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ----------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------

function safeFilename(name: string): string {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'file';
}

// Parse "Display Name <user@domain>" or a bare "user@domain".
function parseAddress(raw: string): { email: string; name: string | null } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw || '');
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  return { name: null, email: (raw || '').trim().toLowerCase() };
}

// Split a "To"/"Cc" header (comma-separated, possibly with display names that
// themselves contain commas inside quotes) into individual email addresses.
function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  // Split on commas that are not inside quotes or angle brackets.
  let depth = 0, inQuote = false, cur = '';
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !inQuote && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => parseAddress(s).email).filter(Boolean);
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// Gmail returns URL-safe base64 (-, _) often without padding.
function b64urlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(data: string): string {
  return new TextDecoder('utf-8').decode(b64urlToBytes(data));
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface Collected {
  plain: string;
  html: string;
  attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>;
}

// Walk the MIME tree, collecting the best text/plain + text/html bodies and any
// (non-inline) file attachments.
function collectParts(part: GmailPart | undefined, acc: Collected): void {
  if (!part) return;
  const mime = (part.mimeType || '').toLowerCase();

  if (part.parts && part.parts.length) {
    for (const p of part.parts) collectParts(p, acc);
    return;
  }

  const disposition = getHeader(part.headers || [], 'Content-Disposition').toLowerCase();
  const isAttachment = !!part.filename && (!!part.body?.attachmentId || disposition.startsWith('attachment'));
  const isInline = disposition.startsWith('inline');

  if (isAttachment && part.body?.attachmentId && !isInline) {
    acc.attachments.push({
      filename: part.filename || 'file',
      mimeType: part.mimeType || 'application/octet-stream',
      attachmentId: part.body.attachmentId,
      size: part.body.size ?? 0,
    });
    return;
  }

  if (part.body?.data && !part.filename) {
    if (mime === 'text/plain' && !acc.plain) acc.plain = b64urlToString(part.body.data);
    else if (mime === 'text/html' && !acc.html) acc.html = b64urlToString(part.body.data);
  }
}

// ----------------------------------------------------------------
// Gmail API
// ----------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: GOOGLE_REFRESH_TOKEN,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  }
  return data.access_token as string;
}

async function gmailGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    const err: any = new Error(`Gmail 404 for ${path}`);
    err.status = 404;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail GET ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Collect new message IDs since the saved cursor via history.list. Returns the
// IDs plus the newest historyId seen. Throws a 404-tagged error if the cursor
// is too old (caller then re-seeds).
async function listSinceCursor(token: string, startHistoryId: string): Promise<{ ids: string[]; newestHistoryId: string }> {
  const ids = new Set<string>();
  let pageToken = '';
  let newestHistoryId = startHistoryId;
  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await gmailGet(`/history?${qs.toString()}`, token);
    if (data.historyId) newestHistoryId = String(data.historyId);
    for (const h of data.history || []) {
      for (const added of h.messagesAdded || []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { ids: [...ids], newestHistoryId };
}

// First-run seed: process recent backlog and capture the current historyId.
async function listSeed(token: string): Promise<{ ids: string[]; newestHistoryId: string }> {
  const profile = await gmailGet('/profile', token);
  const newestHistoryId = String(profile.historyId || '');
  const ids = new Set<string>();
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ labelIds: 'INBOX', q: SEED_QUERY, maxResults: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await gmailGet(`/messages?${qs.toString()}`, token);
    for (const m of data.messages || []) if (m.id) ids.add(m.id);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { ids: [...ids], newestHistoryId };
}

// ----------------------------------------------------------------
// Per-message processing
// ----------------------------------------------------------------

async function processMessage(messageId: string, token: string): Promise<'filed' | 'skipped' | 'duplicate'> {
  const msg = await gmailGet(`/messages/${messageId}?format=full`, token);
  const payload: GmailPart = msg.payload || {};
  const headers = (payload.headers || []) as Array<{ name: string; value: string }>;

  const toList = parseAddressList(getHeader(headers, 'To'));
  const ccList = parseAddressList(getHeader(headers, 'Cc'));
  const candidates = [...new Set([...toList, ...ccList])];
  if (candidates.length === 0) return 'skipped';

  // Resolve recipient → client via unique_email.
  const { data: clients, error: cErr } = await admin
    .from('clients')
    .select('id, deleted_at, unique_email')
    .in('unique_email', candidates);
  if (cErr) throw new Error(`client lookup failed: ${cErr.message}`);
  const client = (clients || []).find(c => !c.deleted_at);
  if (!client) return 'skipped';

  const { email: senderEmail, name: senderName } = parseAddress(getHeader(headers, 'From'));
  const subject = getHeader(headers, 'Subject') || null;
  const rawMessageId = getHeader(headers, 'Message-Id') || getHeader(headers, 'Message-ID') || msg.id || null;

  // received_at: prefer the Date header, fall back to Gmail internalDate, then now.
  let receivedAt = new Date().toISOString();
  const dateHeader = getHeader(headers, 'Date');
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    if (!Number.isNaN(parsed.getTime())) receivedAt = parsed.toISOString();
  } else if (msg.internalDate) {
    const ms = Number(msg.internalDate);
    if (!Number.isNaN(ms)) receivedAt = new Date(ms).toISOString();
  }

  const direction = senderEmail.endsWith('@' + FIRM_DOMAIN) ? 'outbound' : 'inbound';

  const acc: Collected = { plain: '', html: '', attachments: [] };
  collectParts(payload, acc);

  // ---- Insert the email row ----
  const { data: inserted, error: insErr } = await admin
    .from('client_emails')
    .insert({
      client_id:        client.id,
      direction,
      sender_email:     senderEmail || null,
      sender_name:      senderName,
      recipient_emails: toList,
      cc_emails:        ccList,
      subject,
      body_html:        acc.html || null,
      body_plain:       acc.plain || null,
      received_at:      receivedAt,
      attachment_count: acc.attachments.length,
      raw_message_id:   rawMessageId,
    })
    .select('id')
    .single();

  if (insErr) {
    if ((insErr as any).code === '23505') return 'duplicate';
    throw new Error(`client_emails insert failed: ${insErr.message}`);
  }
  const emailId = inserted.id;

  // ---- Attachments: fetch base64url → decode → Storage → row ----
  for (let i = 0; i < acc.attachments.length; i++) {
    const att = acc.attachments[i];
    try {
      const attData = await gmailGet(`/messages/${messageId}/attachments/${att.attachmentId}`, token);
      if (!attData.data) continue;
      const bytes = b64urlToBytes(attData.data);
      const safeName = safeFilename(att.filename);
      const storagePath = `${client.id}/${emailId}/${i + 1}__${safeName}`;

      const { error: upErr } = await admin.storage
        .from('client-email-attachments')
        .upload(storagePath, bytes, { contentType: att.mimeType, upsert: false });
      if (upErr) { console.error('attachment upload failed:', safeName, upErr.message); continue; }

      await admin.from('client_email_attachments').insert({
        email_id:     emailId,
        filename:     att.filename || safeName,
        mime_type:    att.mimeType || null,
        size_bytes:   att.size || bytes.length,
        storage_path: storagePath,
      });
    } catch (e) {
      console.error('attachment processing failed:', (e as Error).message);
    }
  }

  return 'filed';
}

// ----------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // ---- Caller auth (shared cron secret) ----
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GMAIL_ADDRESS) {
    return json({ ok: false, error: 'Gmail is not configured — missing GOOGLE_* / GMAIL_ADDRESS secrets.' }, 500);
  }

  try {
    const token = await getAccessToken();

    // Load (or create) the cursor row for this mailbox.
    const { data: state } = await admin
      .from('email_sync_state')
      .select('cursor')
      .eq('mailbox', GMAIL_ADDRESS)
      .maybeSingle();

    let ids: string[];
    let newestHistoryId: string;
    let mode: 'delta' | 'seed';

    if (state?.cursor) {
      try {
        ({ ids, newestHistoryId } = await listSinceCursor(token, state.cursor));
        mode = 'delta';
      } catch (e) {
        // Cursor too old / invalid → Gmail 404. Re-seed from scratch.
        if ((e as any).status === 404) {
          ({ ids, newestHistoryId } = await listSeed(token));
          mode = 'seed';
        } else throw e;
      }
    } else {
      ({ ids, newestHistoryId } = await listSeed(token));
      mode = 'seed';
    }

    let filed = 0, skipped = 0, duplicate = 0, failed = 0;
    for (const id of ids) {
      try {
        const r = await processMessage(id, token);
        if (r === 'filed') filed++;
        else if (r === 'duplicate') duplicate++;
        else skipped++;
      } catch (e) {
        failed++;
        console.error(`message ${id} failed:`, (e as Error).message);
      }
    }

    // Advance the cursor only if every message processed cleanly — otherwise
    // keep the old watermark so the next run retries the failures.
    const advance = failed === 0 && !!newestHistoryId;
    await admin.from('email_sync_state').upsert({
      mailbox:     GMAIL_ADDRESS,
      cursor:      advance ? newestHistoryId : (state?.cursor ?? newestHistoryId),
      last_run_at: new Date().toISOString(),
      last_error:  failed ? `${failed} message(s) failed — cursor held for retry` : null,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'mailbox' });

    return json({ ok: true, mode, scanned: ids.length, filed, skipped, duplicate, failed });
  } catch (e) {
    const message = (e as Error)?.message || String(e);
    console.error('poll-gmail run failed:', message);
    // Record the error against the cursor row without advancing it.
    await admin.from('email_sync_state').upsert({
      mailbox: GMAIL_ADDRESS, last_run_at: new Date().toISOString(),
      last_error: message, updated_at: new Date().toISOString(),
    }, { onConflict: 'mailbox' }).then(() => {}, () => {});
    return json({ ok: false, error: message }, 500);
  }
});
