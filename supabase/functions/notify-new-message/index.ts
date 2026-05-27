// =============================================================
// Supabase Edge Function: notify-new-message
// =============================================================
// Emails the firm when a CLIENT posts a portal message, so staff aren't
// relying on the sidebar badge alone. The portal calls this (best-effort)
// after a client sends a message.
//
// Unlike send-email (staff-only), this is callable by the authenticated
// CLIENT — but only for a client they are linked to — and it sends server-side
// via the service role, so it never exposes the mail credentials to clients.
//
// Recipient: company_settings.email (the firm's contact address). If that or
// the CloudMailin secrets are missing, it quietly does nothing.
//
// Deploy with gateway "Verify JWT" OFF — auth is enforced here.
// Reuses the send-email secrets:
//   CLOUDMAILIN_OUTBOUND_USERNAME, CLOUDMAILIN_OUTBOUND_TOKEN, CLOUDMAILIN_FROM
// Optional: PORTAL_URL (link included in the email; defaults below).
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const anon = createClient(supaUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
    const { data: { user } } = authToken ? await anon.auth.getUser(authToken) : { data: { user: null } };
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const payload = await req.json().catch(() => ({}));
    const clientId = Number(payload.client_id);
    if (!clientId) return json({ ok: false, error: 'client_id is required.' });

    const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // The caller must be linked to this client (staff callers are ignored —
    // we only notify on client-originated messages).
    const { data: link } = await admin.from('user_clients')
      .select('client_id').eq('user_id', user.id).eq('client_id', clientId).maybeSingle();
    if (!link) return json({ ok: true, skipped: 'caller-not-linked' });

    const { data: cfg } = await admin.from('company_settings').select('email').eq('id', 1).maybeSingle();
    const to = (cfg?.email || '').trim();
    if (!to) return json({ ok: true, skipped: 'no-firm-email' });

    const username = Deno.env.get('CLOUDMAILIN_OUTBOUND_USERNAME');
    const token    = Deno.env.get('CLOUDMAILIN_OUTBOUND_TOKEN');
    const from     = Deno.env.get('CLOUDMAILIN_FROM');
    if (!username || !token || !from) return json({ ok: true, skipped: 'email-not-configured' });

    const { data: client } = await admin.from('clients').select('name, client_code').eq('id', clientId).maybeSingle();
    const clientName = client?.name || `Client #${clientId}`;
    const portalUrl  = Deno.env.get('PORTAL_URL') || 'https://portal.primeandcalculate.com';
    const link2      = `${portalUrl.replace(/\/+$/, '')}/messages`;

    const subject = `New portal message from ${clientName}`;
    const text = `${clientName}${client?.client_code ? ` (${client.client_code})` : ''} sent a new message in the client portal.\n\n`
      + `Log in to read and reply: ${link2}`;
    const html = `<p><strong>${clientName}</strong>${client?.client_code ? ` (${client.client_code})` : ''} sent a new message in the client portal.</p>`
      + `<p><a href="${link2}">Open the messages inbox</a> to read and reply.</p>`;

    const res = await fetch(`https://api.cloudmailin.com/api/v0.1/${username}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, plain: text, html }),
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
