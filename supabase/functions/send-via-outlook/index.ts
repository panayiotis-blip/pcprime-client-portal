// =============================================================
// Supabase Edge Function: send-via-outlook
// =============================================================
// Sends outbound email through the CALLING USER'S OWN Outlook account via
// SMTP. Each user must first configure their Outlook email + app password
// in /settings/email — those credentials are encrypted in
// public.user_smtp_settings (migration 096).
//
// Flow:
//   1. Verify Authorization (must be authenticated staff).
//   2. Load the caller's SMTP settings via a user-scoped client so RLS
//      restricts the read to their own row.
//   3. Decrypt the password via the SECURITY DEFINER RPC
//      get_user_smtp_password() — also user-scoped, auth.uid() match.
//   4. Connect to smtp.office365.com (or whichever host the user saved)
//      using denomailer with STARTTLS / SSL per their settings.
//   5. Send the message; on success update last_used_at, on failure
//      record last_error so the user can see what went wrong in the
//      Email Settings page.
//
// Request body:
//   {
//     to:           string,            // recipient address
//     subject:      string,
//     body:         string,            // plain-text body
//     html?:        string,            // optional HTML body
//     attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>
//   }
//
// Deploy with `supabase functions deploy send-via-outlook` (gateway
// "Verify JWT" OFF — we handle auth in the function so OPTIONS can preflight).
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  // ----- Auth -----
  const authHeader = req.headers.get('Authorization') || '';
  const authToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized — missing token.' }, 401);

  const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  // User-scoped client (RLS + auth.uid() match the caller).
  const userClient = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);

  // Staff-only gate (mirrors send-email).
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

  // ----- Load the user's SMTP settings -----
  const { data: settings, error: sErr } = await userClient
    .from('user_smtp_settings')
    .select('smtp_host, smtp_port, smtp_secure, smtp_user, from_name, is_active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (sErr) return json({ ok: false, error: 'Could not read SMTP settings: ' + sErr.message }, 500);
  if (!settings) {
    return json({ ok: false, error: 'No Outlook account is configured. Set one up in /settings/email first.' }, 400);
  }
  if (!settings.is_active) {
    return json({ ok: false, error: 'Your SMTP settings are marked inactive. Toggle "Active" in /settings/email.' }, 400);
  }

  // ----- Decrypt the password via the SECURITY DEFINER RPC -----
  const { data: passwordResp, error: pErr } = await userClient.rpc('get_user_smtp_password');
  if (pErr) return json({ ok: false, error: 'Could not decrypt SMTP password: ' + pErr.message }, 500);
  const password = (passwordResp as string | null) || '';
  if (!password) {
    return json({ ok: false, error: 'No app password on file. Add one in /settings/email.' }, 400);
  }

  // ----- Build attachments (base64 → Uint8Array) -----
  const attachments = (payload.attachments || []).map(a => ({
    filename: a.filename,
    content: Uint8Array.from(atob(a.contentBase64), c => c.charCodeAt(0)),
    contentType: a.contentType || 'application/pdf',
    encoding: 'binary' as const,
  }));

  // ----- Send via SMTP -----
  const fromAddress = settings.from_name
    ? `${settings.from_name} <${settings.smtp_user}>`
    : settings.smtp_user;

  const client = new SMTPClient({
    connection: {
      hostname: settings.smtp_host,
      port: settings.smtp_port,
      tls: !!settings.smtp_secure, // true = direct SSL (465); false = STARTTLS (587)
      auth: {
        username: settings.smtp_user,
        password,
      },
    },
  });

  try {
    await client.send({
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      content: payload.body,
      html: payload.html,
      attachments: attachments.length ? attachments : undefined,
    });
    await client.close();

    // Stamp success on the user_smtp_settings row.
    await userClient
      .from('user_smtp_settings')
      .update({ last_used_at: new Date().toISOString(), last_error: null })
      .eq('user_id', user.id);

    return json({ ok: true });
  } catch (err) {
    try { await client.close(); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    // Stamp failure so the user can see it on the settings page.
    await userClient
      .from('user_smtp_settings')
      .update({ last_error: msg })
      .eq('user_id', user.id);
    // Common Microsoft 365 misconfig — surface a helpful hint when we can.
    let friendly = msg;
    if (/SmtpClientAuthentication is disabled|disabled for the tenant/i.test(msg)) {
      friendly = msg + ' — your Microsoft 365 tenant has SMTP AUTH disabled. An admin needs to enable it in Exchange admin → Mail flow → Authenticated SMTP, OR enable it on your mailbox specifically.';
    } else if (/535|authentication failed/i.test(msg)) {
      friendly = msg + ' — login was rejected. Double-check the email address and the 16-character app password.';
    }
    return json({ ok: false, error: 'Send failed: ' + friendly }, 502);
  }
});
