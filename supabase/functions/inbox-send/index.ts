// =============================================================
// Supabase Edge Function: inbox-send
// =============================================================
// Sends mail FROM the shared info@ mailbox via the Gmail API (gmail.send), for
// the portal's Inbox compose / reply / reply-all / forward. Using the Gmail API
// (not SMTP) means the sent message lands in Gmail's Sent folder and threads
// into the original conversation — so the shared Inbox behaves like Outlook.
//
// Replies: we fetch the original message's Message-ID / References headers and
// set In-Reply-To + References, and pass the original threadId, so Gmail threads
// the reply correctly.
//
// AUTH
//   - Caller: a logged-in staff member's JWT (compose is a deliberate action).
//     Deploy with gateway "Verify JWT" OFF — the function checks the role.
//   - Gmail: OAuth refresh-token grant for info@, scope gmail.send (+ gmail.modify
//     so we can read the original headers when replying). Same GOOGLE_*/GMAIL_ADDRESS
//     secrets as poll-inbox.
//
// REQUIRED Edge Function secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//   GMAIL_ADDRESS (= info@primeandcalculate.com)
//   FIRM_FROM_NAME (optional display name, e.g. "PC Prime & Calculate")
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const GOOGLE_REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN') || '';
const GMAIL_ADDRESS        = (Deno.env.get('GMAIL_ADDRESS') || '').trim();
const FIRM_FROM_NAME       = Deno.env.get('FIRM_FROM_NAME') || '';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ---------------- MIME helpers ----------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function utf8Base64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}
// Wrap base64 into 76-char lines (RFC 2045).
function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join('\r\n');
}
// RFC 2047 encoded-word for headers that may contain non-ASCII.
function encHeader(s: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${utf8Base64(s)}?=`;
}
function fromHeader(): string {
  if (!FIRM_FROM_NAME) return GMAIL_ADDRESS;
  return `${encHeader(FIRM_FROM_NAME)} <${GMAIL_ADDRESS}>`;
}
// RFC 2822 → base64url for the Gmail API `raw` field.
function toRawUrlSafe(mime: string): string {
  return bytesToBase64(new TextEncoder().encode(mime))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface OutAttachment { filename: string; mime_type?: string; content_base64: string }

function buildMime(opts: {
  to: string[]; cc: string[]; bcc: string[];
  subject: string; html: string;
  inReplyTo?: string; references?: string;
  attachments: OutAttachment[];
}): string {
  const headers: string[] = [];
  headers.push(`From: ${fromHeader()}`);
  headers.push(`To: ${opts.to.join(', ')}`);
  if (opts.cc.length) headers.push(`Cc: ${opts.cc.join(', ')}`);
  if (opts.bcc.length) headers.push(`Bcc: ${opts.bcc.join(', ')}`);
  headers.push(`Subject: ${encHeader(opts.subject)}`);
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  headers.push('MIME-Version: 1.0');

  const htmlPart =
    'Content-Type: text/html; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    wrap76(utf8Base64(opts.html)) + '\r\n';

  if (!opts.attachments.length) {
    return headers.join('\r\n') + '\r\n' +
      'Content-Type: text/html; charset="UTF-8"\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      wrap76(utf8Base64(opts.html));
  }

  const boundary = `b_${GMAIL_ADDRESS.replace(/[^a-z0-9]/gi, '')}_part`;
  let body = `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
  body += `--${boundary}\r\n${htmlPart}`;
  for (const att of opts.attachments) {
    const name = encHeader(att.filename || 'attachment');
    body += `--${boundary}\r\n` +
      `Content-Type: ${att.mime_type || 'application/octet-stream'}; name="${name}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-Disposition: attachment; filename="${name}"\r\n\r\n` +
      wrap76(att.content_base64.replace(/\s/g, '')) + '\r\n';
  }
  body += `--${boundary}--`;
  return headers.join('\r\n') + '\r\n' + body;
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

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// Fetch Message-ID / References for proper reply threading.
async function fetchThreadHeaders(token: string, gmailMessageId: string): Promise<{ messageId: string; references: string }> {
  const url = `${GMAIL_BASE}/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { messageId: '', references: '' };
  const data = await res.json().catch(() => ({}));
  const hs = (data.payload?.headers || []) as Array<{ name: string; value: string }>;
  return { messageId: header(hs, 'Message-ID'), references: header(hs, 'References') };
}

// ---------------- entry ----------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  // --- staff auth ---
  const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!prof || !['owner', 'supervisor', 'admin', 'staff'].includes(prof.role)) {
    return json({ ok: false, error: 'Staff only.' }, 403);
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GMAIL_ADDRESS) {
    return json({ ok: false, error: 'Gmail is not configured — missing GOOGLE_* / GMAIL_ADDRESS secrets.' }, 500);
  }

  // --- payload ---
  let p: {
    to?: string[]; cc?: string[]; bcc?: string[];
    subject?: string; body_html?: string;
    reply_to_inbox_id?: number;   // our inbox_emails.id when replying/forwarding within a thread
    attachments?: OutAttachment[];
  };
  try { p = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const to  = (p.to  || []).map(s => String(s).trim()).filter(Boolean);
  const cc  = (p.cc  || []).map(s => String(s).trim()).filter(Boolean);
  const bcc = (p.bcc || []).map(s => String(s).trim()).filter(Boolean);
  const subject = (p.subject || '').trim();
  const html = p.body_html || '';
  const attachments = Array.isArray(p.attachments) ? p.attachments : [];
  if (!to.length) return json({ ok: false, error: 'At least one recipient is required.' }, 400);

  try {
    const token = await getAccessToken();

    // Threading: when replying within a captured thread, pull the original headers.
    let inReplyTo = ''; let references = ''; let threadId: string | undefined;
    if (p.reply_to_inbox_id) {
      const { data: orig } = await admin.from('inbox_emails')
        .select('gmail_message_id, gmail_thread_id').eq('id', p.reply_to_inbox_id).maybeSingle();
      if (orig?.gmail_message_id) {
        threadId = orig.gmail_thread_id || undefined;
        const th = await fetchThreadHeaders(token, orig.gmail_message_id);
        inReplyTo = th.messageId || '';
        references = [th.references, th.messageId].filter(Boolean).join(' ').trim();
      }
    }

    const mime = buildMime({ to, cc, bcc, subject, html, inReplyTo, references, attachments });
    const res = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(threadId ? { raw: toRawUrlSafe(mime), threadId } : { raw: toRawUrlSafe(mime) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Gmail send failed (${res.status})`;
      return json({ ok: false, error: msg }, 502);
    }

    return json({ ok: true, gmail_message_id: data.id, gmail_thread_id: data.threadId });
  } catch (e) {
    return json({ ok: false, error: (e as Error)?.message || String(e) }, 500);
  }
});
