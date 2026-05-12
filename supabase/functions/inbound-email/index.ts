// Supabase Edge Function: inbound-email
// Receives CloudMailin's webhook ("JSON Normalized" format), authenticates via
// HTTP Basic Auth, and stores the email + attachments against the client whose
// unique_email matches the recipient.
//
// Deploy:
//   1. In Supabase Dashboard → Edge Functions → Secrets, add:
//        CLOUDMAILIN_AUTH_USER  (any short string, e.g. 'cloudmailin')
//        CLOUDMAILIN_AUTH_PASS  (a long random secret — paste the same value
//                                into CloudMailin's webhook Auth password)
//   2. Paste this file's contents into Supabase Dashboard → Edge Functions
//      → inbound-email → Deploy.
//   3. IMPORTANT: When creating the function, untick "Enforce JWT verification"
//      so CloudMailin can POST to it. (CloudMailin uses Basic Auth, not JWT.)
//   4. In CloudMailin: create an Address Target pointing at this function's
//      URL, set HTTP Auth with the user/pass above, and pick "JSON Normalized"
//      as the message format.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_USER = Deno.env.get('CLOUDMAILIN_AUTH_USER') || '';
const AUTH_PASS = Deno.env.get('CLOUDMAILIN_AUTH_PASS') || '';
const FIRM_DOMAIN = 'primeandcalculate.com';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Verify CloudMailin's HTTP Basic Auth header against the Supabase secrets.
// CloudMailin sends Authorization: Basic base64(user:pass) on every POST when
// the target is configured with HTTP Auth.
function verifyBasicAuth(req: Request): boolean {
  if (!AUTH_USER || !AUTH_PASS) return false;
  const header = req.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6).trim());
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    return user === AUTH_USER && pass === AUTH_PASS;
  } catch {
    return false;
  }
}

function safeFilename(name: string): string {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'file';
}

// Parse "Display Name <user@domain>" or "user@domain"
function parseFromHeader(rawFrom: string): { email: string; name: string | null } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(rawFrom || '');
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  return { name: null, email: (rawFrom || '').trim().toLowerCase() };
}

// CloudMailin "JSON Normalized" payload shape (the bits we use)
interface CloudMailinPayload {
  headers?: {
    from?: string;
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    message_id?: string;
    date?: string;
  };
  envelope?: {
    from?: string;
    to?: string;
    recipients?: string[];
    helo_domain?: string;
  };
  plain?: string;
  html?: string;
  reply_plain?: string;
  attachments?: Array<{
    file_name?: string;
    content_type?: string;
    size?: number;
    content?: string;     // base64-encoded
    disposition?: string;
    url?: string;         // for "stored attachments" mode (not used here)
  }>;
}

function toArrayMaybe(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ---- 1. Authenticate ----
  if (!verifyBasicAuth(req)) {
    console.warn('inbound-email: bad or missing Basic Auth');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: CloudMailinPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // ---- 2. Extract fields ----
  const envelopeTo = payload.envelope?.to || '';
  const headerTo   = Array.isArray(payload.headers?.to) ? payload.headers!.to![0] : (payload.headers?.to || '');
  const recipientRaw = (envelopeTo || headerTo || '').trim();
  const { email: recipient } = parseFromHeader(recipientRaw);

  if (!recipient) {
    return new Response('OK (no recipient)', { status: 200 });
  }

  const fromRaw = payload.headers?.from || payload.envelope?.from || '';
  const { email: senderEmail, name: senderName } = parseFromHeader(fromRaw);

  const subject = payload.headers?.subject || '';
  const messageId = payload.headers?.message_id || null;
  const cc = toArrayMaybe(payload.headers?.cc);
  const bodyPlain = payload.plain || payload.reply_plain || '';
  const bodyHtml = payload.html || '';

  // Use the email's Date header if present, otherwise server time
  let receivedAt = new Date().toISOString();
  if (payload.headers?.date) {
    const parsed = new Date(payload.headers.date);
    if (!Number.isNaN(parsed.getTime())) receivedAt = parsed.toISOString();
  }

  const attachments = (payload.attachments || []).filter(a => a.content);
  const attCount = attachments.length;

  // ---- 3. Resolve recipient → client ----
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, name, deleted_at')
    .eq('unique_email', recipient)
    .maybeSingle();

  if (clientErr) {
    console.error('inbound-email: client lookup failed:', clientErr.message);
    return new Response('Server error', { status: 500 });
  }
  if (!client) {
    console.log('inbound-email: unknown recipient, discarding:', recipient);
    return new Response('OK (unknown recipient)', { status: 200 });
  }
  if (client.deleted_at) {
    console.log('inbound-email: client is soft-deleted, discarding:', recipient);
    return new Response('OK (deleted client)', { status: 200 });
  }

  // ---- 4. Direction: own-domain sender = outbound (we BCC'd ourselves) ----
  const direction = senderEmail.endsWith('@' + FIRM_DOMAIN) ? 'outbound' : 'inbound';

  // ---- 5. Insert email ----
  const { data: inserted, error: insErr } = await admin
    .from('client_emails')
    .insert({
      client_id:        client.id,
      direction,
      sender_email:     senderEmail || null,
      sender_name:      senderName,
      recipient_emails: [recipient],
      cc_emails:        cc,
      subject:          subject || null,
      body_html:        bodyHtml || null,
      body_plain:       bodyPlain || null,
      received_at:      receivedAt,
      attachment_count: attCount,
      raw_message_id:   messageId,
    })
    .select('id')
    .single();

  if (insErr) {
    if ((insErr as any).code === '23505') {
      return new Response('OK (duplicate)', { status: 200 });
    }
    console.error('inbound-email: insert failed:', insErr.message);
    return new Response('Insert failed', { status: 500 });
  }

  const emailId = inserted.id;

  // ---- 6. Decode base64 attachments and upload to Storage ----
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (!att.content) continue;

    const safeName = safeFilename(att.file_name || `file-${i + 1}`);
    const storagePath = `${client.id}/${emailId}/${i + 1}__${safeName}`;

    try {
      // Base64 decode → Uint8Array
      const binary = atob(att.content);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);

      const { error: upErr } = await admin.storage
        .from('client-email-attachments')
        .upload(storagePath, bytes, {
          contentType: att.content_type || 'application/octet-stream',
          upsert: false,
        });
      if (upErr) {
        console.error('inbound-email: attachment upload failed:', safeName, upErr.message);
        continue;
      }
      await admin.from('client_email_attachments').insert({
        email_id:     emailId,
        filename:     att.file_name || safeName,
        mime_type:    att.content_type || null,
        size_bytes:   att.size ?? bytes.length,
        storage_path: storagePath,
      });
    } catch (e) {
      console.error('inbound-email: attachment processing failed:', e);
    }
  }

  return new Response('OK', { status: 200 });
});
