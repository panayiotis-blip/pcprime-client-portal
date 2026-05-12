// Supabase Edge Function: inbound-email
// Receives Mailgun's inbound-parse webhook (multipart/form-data POST), verifies
// the signature, and stores the email + attachments against the client whose
// unique_email matches the recipient.
//
// Deploy:
//   1. Set secrets in Supabase Dashboard → Edge Functions → secrets:
//        MAILGUN_SIGNING_KEY = <Mailgun's "HTTP webhook signing key">
//   2. Paste this file's contents into Supabase Dashboard → Edge Functions
//      → New Function → inbound-email → Deploy
//   3. Configure Mailgun Route: match_recipient(".*@inbox.primeandcalculate.com")
//      → forward("https://<project>.supabase.co/functions/v1/inbound-email")

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAILGUN_SIGNING_KEY = Deno.env.get('MAILGUN_SIGNING_KEY') || '';
const FIRM_DOMAIN = 'primeandcalculate.com';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Verify Mailgun's HMAC-SHA256(signing_key, timestamp + token) signature.
// Also rejects timestamps older than 10 min to prevent replay attacks.
async function verifyMailgunSignature(timestamp: string, token: string, signature: string): Promise<boolean> {
  if (!timestamp || !token || !signature || !MAILGUN_SIGNING_KEY) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 600) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(MAILGUN_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + token));
  const hex = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === signature;
}

function safeFilename(name: string): string {
  // ASCII-only filename — strip anything that could cause path issues or
  // confuse the storage layer. Keep alphanumerics, dot, dash, underscore.
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'file';
}

function parseFromHeader(rawFrom: string): { email: string; name: string | null } {
  // "Display Name <user@domain>" or just "user@domain"
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(rawFrom || '');
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  return { name: null, email: (rawFrom || '').trim().toLowerCase() };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('Invalid form data', { status: 400 });
  }

  // ---- 1. Verify signature ----
  const timestamp = String(form.get('timestamp') || '');
  const token     = String(form.get('token') || '');
  const signature = String(form.get('signature') || '');

  const ok = await verifyMailgunSignature(timestamp, token, signature);
  if (!ok) {
    console.warn('inbound-email: invalid Mailgun signature');
    return new Response('Forbidden', { status: 403 });
  }

  // ---- 2. Pull useful fields ----
  const recipient = String(form.get('recipient') || '').trim().toLowerCase();
  const fromRaw   = String(form.get('From') || form.get('from') || form.get('sender') || '');
  const subject   = String(form.get('subject') || form.get('Subject') || '');
  const bodyPlain = String(form.get('body-plain') || form.get('stripped-text') || '');
  const bodyHtml  = String(form.get('body-html')  || form.get('stripped-html') || '');
  const messageId = String(form.get('Message-Id') || form.get('message-id') || '') || null;
  const ccHeader  = String(form.get('Cc') || form.get('cc') || '');
  const attCount  = parseInt(String(form.get('attachment-count') || '0'), 10) || 0;

  if (!recipient) {
    return new Response('OK (no recipient)', { status: 200 });
  }

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

  // ---- 4. Direction: anything from our own domain = outbound (we BCC'd) ----
  const { email: senderEmail, name: senderName } = parseFromHeader(fromRaw);
  const direction = senderEmail.endsWith('@' + FIRM_DOMAIN) ? 'outbound' : 'inbound';

  const ccEmails = ccHeader
    ? ccHeader.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // ---- 5. Insert email row ----
  const { data: inserted, error: insErr } = await admin
    .from('client_emails')
    .insert({
      client_id:        client.id,
      direction,
      sender_email:     senderEmail || null,
      sender_name:      senderName,
      recipient_emails: [recipient],
      cc_emails:        ccEmails,
      subject:          subject || null,
      body_html:        bodyHtml || null,
      body_plain:       bodyPlain || null,
      received_at:      new Date(parseInt(timestamp, 10) * 1000).toISOString(),
      attachment_count: attCount,
      raw_message_id:   messageId,
    })
    .select('id')
    .single();

  if (insErr) {
    // 23505 = unique violation = same (client_id, raw_message_id) already
    // exists, i.e. Mailgun retried. Treat as success.
    if ((insErr as any).code === '23505') {
      return new Response('OK (duplicate)', { status: 200 });
    }
    console.error('inbound-email: insert failed:', insErr.message);
    return new Response('Insert failed', { status: 500 });
  }

  const emailId = inserted.id;

  // ---- 6. Upload attachments ----
  for (let i = 1; i <= attCount; i++) {
    const att = form.get(`attachment-${i}`);
    if (!(att instanceof File)) continue;

    const safeName = safeFilename(att.name);
    const storagePath = `${client.id}/${emailId}/${i}__${safeName}`;

    try {
      const bytes = new Uint8Array(await att.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from('client-email-attachments')
        .upload(storagePath, bytes, {
          contentType: att.type || 'application/octet-stream',
          upsert: false,
        });
      if (upErr) {
        console.error('inbound-email: attachment upload failed:', att.name, upErr.message);
        continue;
      }
      await admin.from('client_email_attachments').insert({
        email_id:     emailId,
        filename:     att.name,
        mime_type:    att.type || null,
        size_bytes:   att.size,
        storage_path: storagePath,
      });
    } catch (e) {
      console.error('inbound-email: attachment processing failed:', e);
    }
  }

  return new Response('OK', { status: 200 });
});
