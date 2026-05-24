// =============================================================
// Supabase Edge Function: send-email
// =============================================================
// Sends outbound email through CloudMailin's JSON API.
// The portal calls this via supabase.functions.invoke('send-email', ...).
//
// Supports optional attachments — the portal sends them base64-encoded so a
// generated invoice / receipt / statement PDF can travel with the message.
//
// Deploy with gateway "Verify JWT" OFF — this function authenticates the
// caller itself (staff only), so it is never publicly callable.
//
// Required Edge Function secrets (Supabase → Edge Functions → Secrets):
//   CLOUDMAILIN_OUTBOUND_USERNAME  — the SMTP username (goes in the API URL)
//   CLOUDMAILIN_OUTBOUND_TOKEN     — the outbound API token (Bearer)
//   CLOUDMAILIN_FROM               — the verified "from" address
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Authenticate + authorise the caller. Gateway "Verify JWT" is off (so the
    // preflight OPTIONS can return 200); we enforce auth HERE. Staff only —
    // this function sends mail as the firm, and clients are also authenticated.
    const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const supaUrl   = Deno.env.get('SUPABASE_URL') ?? '';
    const anon      = createClient(supaUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
    const { data: { user } } = authToken ? await anon.auth.getUser(authToken) : { data: { user: null } };
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!prof || !['owner', 'supervisor', 'admin', 'staff'].includes(prof.role)) {
      return new Response(JSON.stringify({ ok: false, error: 'Staff only.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const username = Deno.env.get('CLOUDMAILIN_OUTBOUND_USERNAME');
    const token    = Deno.env.get('CLOUDMAILIN_OUTBOUND_TOKEN');
    const from     = Deno.env.get('CLOUDMAILIN_FROM');
    if (!username || !token || !from) {
      return json({ ok: false, error: 'Email service is not configured — the CloudMailin secrets are missing.' });
    }

    const payload = await req.json().catch(() => ({}));
    const to: string[] = Array.isArray(payload.to)
      ? payload.to.filter((x: unknown) => typeof x === 'string' && x.trim())
      : (typeof payload.to === 'string' && payload.to.trim() ? [payload.to.trim()] : []);
    if (to.length === 0) return json({ ok: false, error: 'No recipient address was provided.' });
    if (!payload.subject) return json({ ok: false, error: 'An email subject is required.' });

    // Optional attachments: [{ file_name, content (base64), content_type }]
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
          .filter((a: any) => a && typeof a.content === 'string' && typeof a.file_name === 'string')
          .map((a: any) => ({
            file_name: a.file_name,
            content: a.content,
            content_type: a.content_type || 'application/octet-stream',
          }))
      : [];

    const body: Record<string, unknown> = {
      from,
      to,
      subject: payload.subject,
      plain: payload.text || '',
      html: payload.html || '',
    };
    if (attachments.length > 0) body.attachments = attachments;

    const res = await fetch(`https://api.cloudmailin.com/api/v0.1/${username}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ ok: false, error: `CloudMailin rejected the message (${res.status}): ${detail}` });
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
