// =============================================================
// Supabase Edge Function: poll-inbox
// =============================================================
// Shared firm inbox. Reads the info@primeandcalculate.com mailbox via the
// Gmail API (read-only) on a schedule and stores every INBOX message in
// public.inbox_emails (+ attachments in the inbox-attachments bucket), so the
// whole team sees incoming mail inside the portal. Replies still happen in
// Outlook — this function never sends or modifies mail.
//
// Unlike poll-gmail (per-client filing by unique address), this files NOTHING
// per client — it's a flat shared inbox of everything that lands in info@.
//
// Incremental: the Gmail historyId high-watermark is stored in
// public.email_sync_state (migration 114), keyed by mailbox = GMAIL_ADDRESS.
// The cursor only advances on a clean run.
//
// AUTH
//   - Caller: EITHER the CRON_SECRET as the `x-cron-secret` header (scheduled
//     runs) OR a logged-in staff member's JWT (the in-app "Sync now" button).
//     Deploy with gateway "Verify JWT" OFF.
//   - Gmail: OAuth refresh-token grant for the info@ mailbox, scope
//     gmail.readonly (read-only). NO catch-all routing needed — this reads the
//     mailbox directly, so setup is just: Google Cloud project → enable Gmail
//     API → OAuth consent as info@ → refresh token.
//
// REQUIRED Edge Function secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//   GMAIL_ADDRESS (= info@primeandcalculate.com), CRON_SECRET
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const GOOGLE_REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN') || '';
const GMAIL_ADDRESS        = (Deno.env.get('GMAIL_ADDRESS') || '').toLowerCase();
const CRON_SECRET          = Deno.env.get('CRON_SECRET') || '';

const SEED_QUERY = 'newer_than:14d';   // first-run backlog window
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ---------------- helpers ----------------

function safeFilename(name: string): string {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'file';
}

function parseAddress(raw: string): { email: string; name: string | null } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw || '');
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  return { name: null, email: (raw || '').trim().toLowerCase() };
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
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

// ---------------- Gmail API ----------------

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
  const res = await fetch(`${GMAIL_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) { const e: any = new Error(`Gmail 404 for ${path}`); e.status = 404; throw e; }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail GET ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function listSinceCursor(token: string, startHistoryId: string): Promise<{ ids: string[]; newestHistoryId: string }> {
  const ids = new Set<string>();
  let pageToken = '';
  let newestHistoryId = startHistoryId;
  do {
    // No labelId filter → capture messages added to ANY folder (Inbox, Sent, …).
    const qs = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await gmailGet(`/history?${qs.toString()}`, token);
    if (data.historyId) newestHistoryId = String(data.historyId);
    for (const h of data.history || []) {
      for (const added of h.messagesAdded || []) if (added.message?.id) ids.add(added.message.id);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { ids: [...ids], newestHistoryId };
}

async function listSeed(token: string): Promise<{ ids: string[]; newestHistoryId: string }> {
  const profile = await gmailGet('/profile', token);
  const newestHistoryId = String(profile.historyId || '');
  const ids = new Set<string>();
  let pageToken = '';
  do {
    // All folders incl. Spam/Trash; no labelIds filter so Sent is included too.
    const qs = new URLSearchParams({ q: SEED_QUERY, maxResults: '100', includeSpamTrash: 'true' });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await gmailGet(`/messages?${qs.toString()}`, token);
    for (const m of data.messages || []) if (m.id) ids.add(m.id);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { ids: [...ids], newestHistoryId };
}

// ---------------- per-message ----------------

async function processMessage(messageId: string, token: string): Promise<'stored' | 'duplicate'> {
  const msg = await gmailGet(`/messages/${messageId}?format=full`, token);
  const payload: GmailPart = msg.payload || {};
  const headers = (payload.headers || []) as Array<{ name: string; value: string }>;

  const { email: fromEmail, name: fromName } = parseAddress(getHeader(headers, 'From'));
  const toList = parseAddressList(getHeader(headers, 'To'));
  const ccList = parseAddressList(getHeader(headers, 'Cc'));
  const subject = getHeader(headers, 'Subject') || null;

  let receivedAt = new Date().toISOString();
  const dateHeader = getHeader(headers, 'Date');
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    if (!Number.isNaN(parsed.getTime())) receivedAt = parsed.toISOString();
  } else if (msg.internalDate) {
    const ms = Number(msg.internalDate);
    if (!Number.isNaN(ms)) receivedAt = new Date(ms).toISOString();
  }

  const acc: Collected = { plain: '', html: '', attachments: [] };
  collectParts(payload, acc);

  const { data: inserted, error: insErr } = await admin
    .from('inbox_emails')
    .insert({
      gmail_message_id: msg.id,
      gmail_thread_id:  msg.threadId || null,
      from_email:       fromEmail || null,
      from_name:        fromName,
      to_emails:        toList,
      cc_emails:        ccList,
      subject,
      snippet:          msg.snippet || null,
      body_html:        acc.html || null,
      body_plain:       acc.plain || null,
      received_at:      receivedAt,
      has_attachments:  acc.attachments.length > 0,
      label_ids:        Array.isArray(msg.labelIds) ? msg.labelIds : [],
    })
    .select('id')
    .single();

  if (insErr) {
    if ((insErr as any).code === '23505') return 'duplicate';
    throw new Error(`inbox_emails insert failed: ${insErr.message}`);
  }
  const emailId = inserted.id;

  for (let i = 0; i < acc.attachments.length; i++) {
    const att = acc.attachments[i];
    try {
      const attData = await gmailGet(`/messages/${messageId}/attachments/${att.attachmentId}`, token);
      if (!attData.data) continue;
      const bytes = b64urlToBytes(attData.data);
      const safeName = safeFilename(att.filename);
      const storagePath = `${emailId}/${i + 1}__${safeName}`;
      const { error: upErr } = await admin.storage
        .from('inbox-attachments')
        .upload(storagePath, bytes, { contentType: att.mimeType, upsert: false });
      if (upErr) { console.error('attachment upload failed:', safeName, upErr.message); continue; }
      await admin.from('inbox_email_attachments').insert({
        email_id: emailId, filename: att.filename || safeName,
        mime_type: att.mimeType || null, size_bytes: att.size || bytes.length,
        storage_path: storagePath,
      });
    } catch (e) {
      console.error('attachment processing failed:', (e as Error).message);
    }
  }
  return 'stored';
}

// ---------------- entry point ----------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth: cron secret (scheduled) OR a logged-in staff member (manual "Sync now").
  let trigger: 'cron' | 'manual' = 'cron';
  const cronOk = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;
  if (!cronOk) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = token
      ? await admin.auth.getUser(token)
      : { data: { user: null } } as any;
    let staffOk = false;
    if (user) {
      const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      staffOk = !!prof && ['owner', 'supervisor', 'admin', 'staff'].includes(prof.role);
    }
    if (!staffOk) return json({ ok: false, error: 'Unauthorized.' }, 401);
    trigger = 'manual';
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GMAIL_ADDRESS) {
    return json({ ok: false, error: 'Gmail is not configured — missing GOOGLE_* / GMAIL_ADDRESS secrets.' }, 500);
  }

  try {
    const token = await getAccessToken();
    const { data: state } = await admin
      .from('email_sync_state').select('cursor').eq('mailbox', GMAIL_ADDRESS).maybeSingle();

    let ids: string[]; let newestHistoryId: string; let mode: 'delta' | 'seed';
    if (state?.cursor) {
      try { ({ ids, newestHistoryId } = await listSinceCursor(token, state.cursor)); mode = 'delta'; }
      catch (e) {
        if ((e as any).status === 404) { ({ ids, newestHistoryId } = await listSeed(token)); mode = 'seed'; }
        else throw e;
      }
    } else { ({ ids, newestHistoryId } = await listSeed(token)); mode = 'seed'; }

    let stored = 0, duplicate = 0, failed = 0;
    for (const id of ids) {
      try {
        const r = await processMessage(id, token);
        if (r === 'stored') stored++; else duplicate++;
      } catch (e) { failed++; console.error(`message ${id} failed:`, (e as Error).message); }
    }

    const advance = failed === 0 && !!newestHistoryId;
    await admin.from('email_sync_state').upsert({
      mailbox:     GMAIL_ADDRESS,
      cursor:      advance ? newestHistoryId : (state?.cursor ?? newestHistoryId),
      last_run_at: new Date().toISOString(),
      last_error:  failed ? `${failed} message(s) failed — cursor held for retry` : null,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'mailbox' });

    return json({ ok: true, trigger, mode, scanned: ids.length, stored, duplicate, failed });
  } catch (e) {
    const message = (e as Error)?.message || String(e);
    console.error('poll-inbox run failed:', message);
    await admin.from('email_sync_state').upsert({
      mailbox: GMAIL_ADDRESS, last_run_at: new Date().toISOString(),
      last_error: message, updated_at: new Date().toISOString(),
    }, { onConflict: 'mailbox' }).then(() => {}, () => {});
    return json({ ok: false, error: message }, 500);
  }
});
