// =============================================================
// Supabase Edge Function: app-request  (PUBLIC — no JWT)
// =============================================================
// App access Phase 4. A prospective app user submits an email-based access
// request (no password — they'll be invited to set one on approval). Lands as
// a PENDING client_app_access_requests row; the firm reviews it in /app-requests
// (app-grants-admin: list_requests / approve_request / reject_request).
//
// Action (POST { action:'submit', app_key, client_name, full_name, email, phone, message }):
//   → { ok } | { ok, already:true }
//
// Deploy with "Verify JWT" OFF.
//   supabase functions deploy app-request --project-ref ddwdrjhnfwpbtqzqgdsl --no-verify-jwt
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
  if (body.action && body.action !== 'submit') return json({ ok: false, error: 'Unknown action.' }, 400);

  const email = String(body.email || '').trim().toLowerCase();
  const clientName = String(body.client_name || '').trim();
  const appKey = String(body.app_key || 'rentals').trim() || 'rentals';
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400);
  if (!clientName) return json({ ok: false, error: 'Your company / client name is required.' }, 400);

  // Don't stack duplicate pending requests for the same email + app.
  const { data: pend } = await admin.from('client_app_access_requests')
    .select('id').eq('status', 'pending').eq('app_key', appKey).ilike('email', email).maybeSingle();
  if (pend) return json({ ok: true, already: true });

  const { error } = await admin.from('client_app_access_requests').insert({
    app_key: appKey,
    client_name: clientName,
    full_name: String(body.full_name || '').trim() || null,
    email,
    phone: String(body.phone || '').trim() || null,
    message: String(body.message || '').trim() || null,
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
});
