// =============================================================
// Supabase Edge Function: sso-exchange
// =============================================================
// The other half of the hand-off. The portal posts the code it found in the
// URL fragment and gets a session back in the response body — so the tokens
// travel over HTTPS in a POST, and never sit in a URL.
//
// There is no JWT to verify: the caller is a browser that is not signed in
// yet. That is the whole point of the code. Deploy accordingly:
//
//     supabase functions deploy sso-exchange --no-verify-jwt
//
// The code is the only credential accepted, and it is spent on first use by
// redeem_portal_sso_code (migration 179), atomically, so a replay gets
// nothing.
//
// HOW A SESSION IS MINTED. The service role cannot simply hand out a session,
// so this generates a magic link for the user's own address — which sends no
// email — and immediately redeems it server-side. The resulting tokens are
// returned to the caller. The link never leaves this function.
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

/**
 * One message for every way this can fail. A caller holding a bad code learns
 * only that it did not work — not whether it never existed, was already spent,
 * or ran out of time.
 */
const REJECTED = 'That sign-in link has expired. Open the portal from the app again.';

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
  const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  // Bounded before hashing, so a megabyte of junk is rejected cheaply.
  if (!code || code.length > 256) return json({ ok: false, error: REJECTED }, 401);

  // Spend the code. Atomic — a replay finds nothing.
  const { data: userId, error: redeemError } = await admin.rpc('redeem_portal_sso_code', {
    p_code_hash: await sha256Hex(code),
  });
  if (redeemError) return json({ ok: false, error: 'Hand-off failed.' }, 500);
  if (!userId) return json({ ok: false, error: REJECTED }, 401);

  // The address to mint against. Read after redeeming, so a stale code never
  // reveals whether an account exists.
  const { data: account, error: accountError } = await admin.auth.admin.getUserById(
    userId as string,
  );
  const email = account?.user?.email;
  if (accountError || !email) return json({ ok: false, error: 'Hand-off failed.' }, 500);

  // Generates the link without sending any email.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return json({ ok: false, error: 'Hand-off failed.' }, 500);

  // Redeem it here rather than in the browser, so the token stays server-side
  // and only the session comes back.
  const anon = createClient(supaUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyError || !verified.session) return json({ ok: false, error: 'Hand-off failed.' }, 500);

  return json({
    ok: true,
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
});
