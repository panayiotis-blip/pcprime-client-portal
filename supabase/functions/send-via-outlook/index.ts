// =============================================================
// Supabase Edge Function: send-via-outlook
// =============================================================
// Sends outbound email through the CALLING USER'S OWN SMTP credentials
// (Outlook / Gmail / any provider). Each user must first configure
// their SMTP host + email + app password in /settings/email — those
// credentials are encrypted in public.user_smtp_settings (migration
// 096), and the signature (migration 113) is auto-appended.
//
// IMPORTANT (2026-06-11): rewrote from denomailer 1.6.0 to a hand-
// rolled raw SMTP client + hand-rolled MIME builder. denomailer's
// Q-encoded header path was producing broken =?utf-8?Q?...?= sections
// with literal spaces (RFC 2047 violation) and its multipart/mixed
// composer dropped attachments / rendered raw HTML tags on Gmail.
// Owning the SMTP conversation and the MIME bytes ourselves means no
// library quirks — Subject is B-encoded (base64) when non-ASCII to
// dodge the Q-encoding pitfall, bodies are base64-encoded with the
// charset on the Content-Type, and attachments are wrapped in a clean
// multipart/mixed structure.
//
// Deploy with gateway "Verify JWT" OFF — we handle auth in the
// function so OPTIONS can preflight.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type Attachment = {
  filename: string;
  contentBase64: string;
  contentType?: string;
};
type Payload = {
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: Attachment[];
  // Optional: send using ANOTHER user's SMTP account instead of the caller's.
  // Only honoured when the caller holds users.write — used by admins to send a
  // test email while setting up a staff member's email in User Management.
  as_user_id?: string;
  // Optional: send through the shared firm identity (info@) instead of the
  // caller's own account. Any staff member may use this for client-facing mail.
  from_firm?: boolean;
};

// -----------------------------------------------------------------
// MIME header helpers
// -----------------------------------------------------------------

// RFC 2047 B-encoded word (base64). Use this for any header value that
// might contain non-ASCII. We never use Q-encoding (denomailer's bug
// was specifically in its Q-encoder).
function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return `=?UTF-8?B?${b64}?=`;
}

// Encode a "Name <addr>" From header — if the name part has non-ASCII
// chars, base64-encode just the name and leave the addr unencoded.
function encodeAddress(addr: string): string {
  const m = addr.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return addr;
  const [, name, email] = m;
  if (!name) return `<${email}>`;
  return `${encodeHeader(name.trim())} <${email}>`;
}

// Wrap a long base64 string in 76-char lines per RFC 2045.
function wrapBase64(b64: string): string {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.substring(i, i + 76));
  return out.join('\r\n');
}

// UTF-8 base64 encode a string for use as a body part.
function encodeBodyBase64(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  return wrapBase64(btoa(binary));
}

// Build the full MIME message for the SMTP DATA command. The structure
// chosen depends on whether there are attachments:
//   • No attachments  → single part (text/html or text/plain)
//   • With attachments → multipart/mixed wrapping [body, ...attachments]
// Plain-text fallback (multipart/alternative) is omitted on purpose —
// every modern client renders HTML, and the previous attempt to use
// multipart/alternative was where denomailer's bugs lived.
function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
}): string {
  const CRLF = '\r\n';
  const out: string[] = [];
  const boundary = `_b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_`;

  // Headers (always)
  out.push(`From: ${encodeAddress(opts.from)}`);
  out.push(`To: ${encodeAddress(opts.to)}`);
  out.push(`Subject: ${encodeHeader(opts.subject)}`);
  out.push(`Date: ${new Date().toUTCString()}`);
  out.push(`MIME-Version: 1.0`);

  const atts = opts.attachments || [];
  const useHtml = !!opts.html;

  if (atts.length > 0) {
    out.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    out.push(''); // header/body separator
    out.push(`This is a multi-part message in MIME format.`);
    out.push('');

    // Body part
    out.push(`--${boundary}`);
    if (useHtml) {
      out.push(`Content-Type: text/html; charset="UTF-8"`);
      out.push(`Content-Transfer-Encoding: base64`);
      out.push('');
      out.push(encodeBodyBase64(opts.html!));
    } else {
      out.push(`Content-Type: text/plain; charset="UTF-8"`);
      out.push(`Content-Transfer-Encoding: base64`);
      out.push('');
      out.push(encodeBodyBase64(opts.text || ''));
    }

    // Attachment parts
    for (const att of atts) {
      out.push('');
      out.push(`--${boundary}`);
      const safeName = att.filename.replace(/[\r\n"]/g, '');
      out.push(`Content-Type: ${att.contentType}; name="${safeName}"`);
      out.push(`Content-Disposition: attachment; filename="${safeName}"`);
      out.push(`Content-Transfer-Encoding: base64`);
      out.push('');
      out.push(wrapBase64(att.contentBase64));
    }

    out.push('');
    out.push(`--${boundary}--`);
  } else if (useHtml) {
    out.push(`Content-Type: text/html; charset="UTF-8"`);
    out.push(`Content-Transfer-Encoding: base64`);
    out.push('');
    out.push(encodeBodyBase64(opts.html!));
  } else {
    out.push(`Content-Type: text/plain; charset="UTF-8"`);
    out.push(`Content-Transfer-Encoding: base64`);
    out.push('');
    out.push(encodeBodyBase64(opts.text || ''));
  }

  return out.join(CRLF);
}

// -----------------------------------------------------------------
// Raw SMTP client
// -----------------------------------------------------------------

// Read until we have a complete multi-line SMTP response. SMTP replies
// look like "250-EHLO line 1\r\n250-line 2\r\n250 last line\r\n". Lines
// 2..N start with "XXX-" while the final line uses "XXX " (space). We
// keep reading until we find a line matching "^\d{3} ".
async function readResponse(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder): Promise<string> {
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) break;
    const lines = buf.split('\r\n');
    // last non-empty line
    const last = lines.filter(l => l.length > 0).pop() || '';
    if (/^\d{3} /.test(last)) break;
  }
  return buf;
}

async function writeLine(writer: WritableStreamDefaultWriter<Uint8Array>, encoder: TextEncoder, s: string) {
  await writer.write(encoder.encode(s + '\r\n'));
}

function smtpCode(resp: string): number {
  const first = resp.split('\r\n').find(l => /^\d{3}/.test(l)) || '';
  return parseInt(first.substring(0, 3) || '0', 10);
}

function expect(resp: string, want: number, where: string) {
  const got = smtpCode(resp);
  if (got !== want) {
    throw new Error(`SMTP ${where} expected ${want}, got ${got}: ${resp.trim()}`);
  }
}

// Talk SMTP to the host. Handles STARTTLS upgrade for port 587, direct
// TLS for port 465, AUTH LOGIN (base64 user/pass), and a full DATA
// payload terminated with "\r\n.\r\n".
async function sendRawSmtp(opts: {
  host: string;
  port: number;
  secure: boolean;          // true = direct TLS (465); false = STARTTLS (587)
  user: string;
  password: string;
  from: string;             // envelope (Return-Path)
  to: string;               // envelope recipient
  mimeMessage: string;      // already-built MIME body for DATA
}): Promise<void> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');

  let conn: Deno.Conn | Deno.TlsConn;
  if (opts.secure) {
    conn = await Deno.connectTls({ hostname: opts.host, port: opts.port });
  } else {
    conn = await Deno.connect({ hostname: opts.host, port: opts.port });
  }

  let reader = conn.readable.getReader();
  let writer = conn.writable.getWriter();

  const greet = await readResponse(reader, decoder);
  expect(greet, 220, 'greeting');

  await writeLine(writer, encoder, 'EHLO localhost');
  expect(await readResponse(reader, decoder), 250, 'EHLO');

  if (!opts.secure) {
    await writeLine(writer, encoder, 'STARTTLS');
    expect(await readResponse(reader, decoder), 220, 'STARTTLS');

    // Release the locks on the streams so we can upgrade the conn.
    reader.releaseLock();
    writer.releaseLock();
    // Upgrade. Deno.startTls returns a fresh Deno.TlsConn whose
    // readable/writable are TLS-wrapped versions of the old conn.
    conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: opts.host });
    reader = conn.readable.getReader();
    writer = conn.writable.getWriter();

    await writeLine(writer, encoder, 'EHLO localhost');
    expect(await readResponse(reader, decoder), 250, 'EHLO (post-TLS)');
  }

  await writeLine(writer, encoder, 'AUTH LOGIN');
  expect(await readResponse(reader, decoder), 334, 'AUTH LOGIN');
  await writeLine(writer, encoder, btoa(opts.user));
  expect(await readResponse(reader, decoder), 334, 'AUTH user');
  await writeLine(writer, encoder, btoa(opts.password));
  expect(await readResponse(reader, decoder), 235, 'AUTH password');

  await writeLine(writer, encoder, `MAIL FROM:<${opts.from}>`);
  expect(await readResponse(reader, decoder), 250, 'MAIL FROM');

  await writeLine(writer, encoder, `RCPT TO:<${opts.to}>`);
  expect(await readResponse(reader, decoder), 250, 'RCPT TO');

  await writeLine(writer, encoder, 'DATA');
  expect(await readResponse(reader, decoder), 354, 'DATA');

  // Per RFC, any line starting with "." inside DATA must be doubled
  // (transparency). Then end the payload with CRLF.CRLF.
  const safeMessage = opts.mimeMessage.replace(/\r\n\./g, '\r\n..');
  await writer.write(encoder.encode(safeMessage + '\r\n.\r\n'));
  expect(await readResponse(reader, decoder), 250, 'DATA end');

  await writeLine(writer, encoder, 'QUIT');
  // Don't strictly need to read 221 — best-effort cleanup.

  try { reader.releaseLock(); } catch { /* */ }
  try { writer.releaseLock(); } catch { /* */ }
  try { conn.close(); } catch { /* */ }
}

// -----------------------------------------------------------------
// Function entry point
// -----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  // ----- Auth -----
  const authHeader = req.headers.get('Authorization') || '';
  const authToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized — missing token.' }, 401);

  const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);

  const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!prof || !['owner', 'supervisor', 'admin', 'staff'].includes(prof.role)) {
    return json({ ok: false, error: 'Staff only.' }, 403);
  }

  // ----- Parse + validate body -----
  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }
  if (!payload.to || !payload.subject || !payload.body) {
    return json({ ok: false, error: 'to / subject / body are required.' }, 400);
  }
  if (payload.attachments && payload.attachments.length > 10) {
    return json({ ok: false, error: 'Too many attachments (max 10).' }, 400);
  }

  // ----- Resolve which account to send through -----
  //   • from_firm     → the shared firm identity (info@). Any staff member may
  //                     use it for client-facing mail; the password is decrypted
  //                     server-side via a service_role-only RPC (never exposed).
  //   • as_user_id    → a specific user's account (admin test; needs users.write).
  //   • default       → the caller's own account.
  const fromFirm = payload.from_firm === true;
  let targetUserId = user.id;
  let settings: any = null;
  let password = '';

  if (fromFirm) {
    const { data: fs, error: fErr } = await admin
      .from('firm_email_settings')
      .select('smtp_host, smtp_port, smtp_secure, smtp_user, from_name, is_active, signature_html, signature_text')
      .eq('id', 1)
      .maybeSingle();
    if (fErr) return json({ ok: false, error: 'Could not read firm email settings: ' + fErr.message }, 500);
    if (!fs || !fs.smtp_user) {
      return json({ ok: false, error: 'The firm email account (info@) is not configured yet. Set it up in Settings → Firm Email.' }, 400);
    }
    if (!fs.is_active) {
      return json({ ok: false, error: 'The firm email account is marked inactive in Settings → Firm Email.' }, 400);
    }
    settings = fs;
    const { data: pw, error: pErr } = await admin.rpc('get_firm_smtp_password_internal');
    if (pErr) return json({ ok: false, error: 'Could not decrypt firm email password: ' + pErr.message }, 500);
    password = (pw as string | null) || '';
    if (!password) {
      return json({ ok: false, error: 'No app password on file for the firm email account. Add one in Settings → Firm Email.' }, 400);
    }
  } else {
    if (payload.as_user_id && payload.as_user_id !== user.id) {
      const { data: canManage } = await userClient.rpc('has_permission', { p_perm: 'users.write' });
      if (!canManage) {
        return json({ ok: false, error: 'users.write permission required to send as another user.' }, 403);
      }
      targetUserId = payload.as_user_id;
    }

    // Load the target user's SMTP settings (admin client bypasses own-row RLS).
    const { data: us, error: sErr } = await admin
      .from('user_smtp_settings')
      .select('smtp_host, smtp_port, smtp_secure, smtp_user, from_name, is_active, signature_html, signature_text')
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (sErr) return json({ ok: false, error: 'Could not read SMTP settings: ' + sErr.message }, 500);
    if (!us) {
      return json({ ok: false, error: 'No email account is configured. Set one up in /settings/email first.' }, 400);
    }
    if (!us.is_active) {
      return json({ ok: false, error: 'Your SMTP settings are marked inactive. Toggle "Active" in /settings/email.' }, 400);
    }
    settings = us;

    // Own mail uses the self-scoped RPC; an admin sending as another user uses
    // the permission-gated admin RPC. Both run as the caller's JWT identity.
    const { data: passwordResp, error: pErr } = targetUserId === user.id
      ? await userClient.rpc('get_user_smtp_password')
      : await userClient.rpc('admin_get_user_smtp_password', { p_user_id: targetUserId });
    if (pErr) return json({ ok: false, error: 'Could not decrypt SMTP password: ' + pErr.message }, 500);
    password = (passwordResp as string | null) || '';
    if (!password) {
      return json({ ok: false, error: 'No app password on file. Add one in /settings/email.' }, 400);
    }
  }

  // ----- Compose body + html + signature -----
  let finalBody = payload.body;
  if (settings.signature_text) {
    finalBody = (finalBody || '') + '\r\n\r\n--\r\n' + settings.signature_text;
  }
  let finalHtml = payload.html;
  if (finalHtml) {
    const looksLikeFullDoc = /<!doctype\s+html|<html[\s>]/i.test(finalHtml);
    if (settings.signature_html) {
      finalHtml = looksLikeFullDoc
        ? finalHtml.replace(/<\/body>/i, `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">${settings.signature_html}</body>`)
        : finalHtml + `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">${settings.signature_html}`;
    }
    if (!looksLikeFullDoc) {
      finalHtml =
        `<!DOCTYPE html>\n` +
        `<html><head>` +
        `<meta charset="UTF-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `</head>` +
        `<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#1a365d;line-height:1.5;margin:0;padding:18px;background:#ffffff;">` +
        finalHtml +
        `</body></html>`;
    }
  }

  const fromAddress = settings.from_name
    ? `${settings.from_name} <${settings.smtp_user}>`
    : settings.smtp_user;

  // ----- Build MIME message -----
  const mimeMessage = buildMimeMessage({
    from: fromAddress,
    to: payload.to,
    subject: payload.subject,
    html: finalHtml,
    text: finalBody,
    attachments: (payload.attachments || []).map(a => ({
      filename: a.filename,
      contentType: a.contentType || 'application/pdf',
      contentBase64: a.contentBase64,
    })),
  });

  // ----- Send via raw SMTP -----
  try {
    await sendRawSmtp({
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: !!settings.smtp_secure,
      user: settings.smtp_user,
      password,
      from: settings.smtp_user,  // envelope sender (must match auth user for most providers)
      to: payload.to,
      mimeMessage,
    });

    if (!fromFirm) {
      await admin
        .from('user_smtp_settings')
        .update({ last_used_at: new Date().toISOString(), last_error: null })
        .eq('user_id', targetUserId);
    }

    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!fromFirm) {
      await admin
        .from('user_smtp_settings')
        .update({ last_error: msg })
        .eq('user_id', targetUserId);
    }
    let friendly = msg;
    if (/535|authentication failed|invalid login/i.test(msg)) {
      friendly = msg + ' — login was rejected. Double-check the email address and the 16-character app password (no spaces).';
    } else if (/SmtpClientAuthentication is disabled|disabled for the tenant/i.test(msg)) {
      friendly = msg + ' — your Microsoft 365 tenant has SMTP AUTH disabled. An admin needs to enable it in Exchange admin → Mail flow → Authenticated SMTP.';
    }
    return json({ ok: false, error: 'Send failed: ' + friendly }, 502);
  }
});
