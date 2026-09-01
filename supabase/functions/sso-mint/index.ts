// =============================================================
// Supabase Edge Function: sso-mint
// =============================================================
// Gives the signed-in mobile user a one-time code to carry into the web
// portal, so they do not sign in twice within a minute of each other.
//
// Minting a code IS the privilege being handed out, so the caller has to prove
// who they are. Deploy with the gateway verifying JWTs — the default:
//
//     supabase functions deploy sso-mint
//
// The code is returned once and never stored: only its SHA-256 goes in the
// table, so reading that table tells you nothing you could present.
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

/** Long enough that guessing is hopeless, short enough to sit in a fragment. */
const CODE_BYTES = 32;

/**
 * Ninety seconds. The code travels from this response into a browser that is
 * already opening; anything longer is a window for no benefit.
 */
const TTL_SECONDS = 90;

const PORTAL_URL = Deno.env.get('PORTAL_URL') ?? 'https://portal.primeandcalculate.com';

function randomCode(): string {
  const bytes = new Uint8Array(CODE_BYTES);
  crypto.getRandomValues(bytes);
  // base64url — safe in a URL fragment without escaping.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Not authenticated.' }, 401);

  const userClient = createClient(supaUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return json({ ok: false, error: 'Not authenticated.' }, 401);

  const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  const code = randomCode();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

  const { error } = await admin.from('portal_sso_code').insert({
    code_hash: await sha256Hex(code),
    user_id: user.id,
    expires_at: expiresAt,
  });
  if (error) return json({ ok: false, error: 'Could not start the hand-off.' }, 500);

  return json({
    ok: true,
    // The fragment never leaves the browser: not sent to the host, not in its
    // access logs, not in a Referer header.
    url: `${PORTAL_URL}/#sso=${code}`,
    expires_at: expiresAt,
  });
});
