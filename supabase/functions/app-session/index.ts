// =============================================================
// Supabase Edge Function: app-session  (PUBLIC — no portal JWT)
// =============================================================
// Powers the standalone client-app experience: app-only users sign in at
// the app's own login box and read/write the app's data, scoped strictly
// to one client+app. Data lives in client_app_data; logins in
// client_app_users (migration 162). Passwords are PBKDF2-hashed; sessions
// are HMAC-signed and time-limited. Nothing here can reach another client.
//
// Actions (POST body { action, ... }):
//   login {token, username, password} → { ok, session, role, name, data }
//   load  {session}                   → { ok, data }
//   save  {session, data}             → { ok }
//
// Deploy with "Verify JWT" OFF (these callers have no portal login).
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFromBytes(a: Uint8Array): string {
  let s = ''; for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}

async function pbkdf2Verify(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iters = parseInt(parts[1], 10);
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, expected.length * 8);
  const got = new Uint8Array(bits);
  if (got.length !== expected.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}
async function makeSession(payload: Record<string, unknown>, secret: string): Promise<string> {
  const p = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  return p + '.' + (await hmac(p, secret));
}
async function verifySession(token: string, secret: string): Promise<any | null> {
  const dot = token.indexOf('.'); if (dot < 0) return null;
  const p = token.slice(0, dot), s = token.slice(dot + 1);
  if ((await hmac(p, secret)) !== s) return null;
  const obj = JSON.parse(dec.decode(b64urlToBytes(p)));
  if (obj.exp && Date.now() > obj.exp) return null;
  return obj;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; // server-only signing key

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
  const action = body.action;

  if (action === 'login') {
    const username = String(body.username || '').trim(); const password = String(body.password || '');
    if (!username || !password) return json({ ok: false, error: 'Missing credentials.' }, 400);
    // Username is globally unique → resolves the app-user (and thus client+app).
    const { data: u } = await admin.from('client_app_users')
      .select('id, client_id, app_key, name, role, password_hash, active')
      .ilike('username', username).maybeSingle();
    const ok = u && u.active && await pbkdf2Verify(password, u.password_hash);
    if (!ok) { await new Promise(r => setTimeout(r, 400)); return json({ ok: false, error: 'Invalid username or password.' }, 401); }
    // The app must still be enabled for that client.
    const { data: appRow } = await admin.from('client_apps')
      .select('enabled').eq('client_id', u.client_id).eq('app_key', u.app_key).maybeSingle();
    if (!appRow || !appRow.enabled) return json({ ok: false, error: 'This app is not available. Contact your accountant.' }, 403);
    await admin.from('client_app_users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id);
    const session = await makeSession({ uid: u.id, cid: u.client_id, app: u.app_key, role: u.role, exp: Date.now() + SESSION_TTL_MS }, secret);
    const { data: doc } = await admin.from('client_app_data')
      .select('data').eq('client_id', u.client_id).eq('app_key', u.app_key).maybeSingle();
    return json({ ok: true, session, role: u.role, name: u.name || username, app_key: u.app_key, data: doc?.data ?? {} });
  }

  if (action === 'load') {
    const s = await verifySession(String(body.session || ''), secret);
    if (!s) return json({ ok: false, error: 'Session expired — please sign in again.' }, 401);
    const { data: doc } = await admin.from('client_app_data')
      .select('data').eq('client_id', s.cid).eq('app_key', s.app).maybeSingle();
    return json({ ok: true, data: doc?.data ?? {} });
  }

  if (action === 'save') {
    const s = await verifySession(String(body.session || ''), secret);
    if (!s) return json({ ok: false, error: 'Session expired — please sign in again.' }, 401);
    if (s.role === 'viewer') return json({ ok: false, error: 'Read-only access.' }, 403);
    const { error } = await admin.from('client_app_data').upsert(
      { client_id: s.cid, app_key: s.app, data: body.data, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,app_key' },
    );
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
});
