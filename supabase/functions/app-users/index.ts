// =============================================================
// Supabase Edge Function: app-users  (portal JWT required)
// =============================================================
// Firm-side management of a client app's own logins (client_app_users,
// migration 162). Passwords are PBKDF2-hashed here (server-side) so the
// browser never handles a hash. Every action is gated by the caller being
// able to access the target client (user_can_access_client via their JWT).
//
// Actions (POST { action, ... }):
//   list   {client_id, app_key}                          → { ok, users:[...] }  (no hashes)
//   create {client_id, app_key, username, name, role, password} → { ok, id }
//   update {id, name?, role?, active?}                   → { ok }
//   reset  {id, password}                                → { ok }
//   delete {id}                                          → { ok }
//
// Deploy with "Verify JWT" OFF — we validate the JWT in-function.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const enc = new TextEncoder();
const ROLES = ['admin', 'editor', 'viewer'];

function b64(a: Uint8Array): string { let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s); }
async function pbkdf2Hash(password: string): Promise<string> {
  const iters = 120000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, 256);
  return `pbkdf2$${iters}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${authToken}` } } });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);

  // Can the caller manage this client's app users?
  const canAccess = async (clientId: number): Promise<boolean> => {
    const { data } = await userClient.rpc('user_can_access_client', { cid: clientId });
    return data === true;
  };
  // Resolve the target row's client_id (for id-based actions).
  const clientOf = async (id: number): Promise<number | null> => {
    const { data } = await admin.from('client_app_users').select('client_id').eq('id', id).maybeSingle();
    return data ? (data as any).client_id : null;
  };

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
  const action = body.action;

  if (action === 'list') {
    const clientId = Number(body.client_id);
    if (!(await canAccess(clientId))) return json({ ok: false, error: 'No access to this client.' }, 403);
    const { data, error } = await admin.from('client_app_users')
      .select('id, username, name, role, active, last_login_at, created_at')
      .eq('client_id', clientId).eq('app_key', String(body.app_key)).order('created_at');
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, users: data || [] });
  }

  if (action === 'create') {
    const clientId = Number(body.client_id);
    if (!(await canAccess(clientId))) return json({ ok: false, error: 'No access to this client.' }, 403);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = ROLES.includes(body.role) ? body.role : 'editor';
    if (!username || password.length < 6) return json({ ok: false, error: 'Username required; password must be at least 6 characters.' }, 400);
    const password_hash = await pbkdf2Hash(password);
    const { data, error } = await admin.from('client_app_users').insert({
      client_id: clientId, app_key: String(body.app_key), username,
      name: String(body.name || '').trim() || null, role, password_hash, created_by: user.id,
    }).select('id').single();
    if (error) return json({ ok: false, error: /duplicate|unique/i.test(error.message) ? 'That username is already taken.' : error.message }, 400);
    return json({ ok: true, id: (data as any).id });
  }

  if (action === 'update') {
    const id = Number(body.id);
    const cid = await clientOf(id);
    if (cid == null || !(await canAccess(cid))) return json({ ok: false, error: 'No access.' }, 403);
    const patch: any = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim() || null;
    if (body.role !== undefined && ROLES.includes(body.role)) patch.role = body.role;
    if (body.active !== undefined) patch.active = !!body.active;
    const { error } = await admin.from('client_app_users').update(patch).eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'reset') {
    const id = Number(body.id);
    const cid = await clientOf(id);
    if (cid == null || !(await canAccess(cid))) return json({ ok: false, error: 'No access.' }, 403);
    const password = String(body.password || '');
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters.' }, 400);
    const { error } = await admin.from('client_app_users').update({ password_hash: await pbkdf2Hash(password) }).eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'delete') {
    const id = Number(body.id);
    const cid = await clientOf(id);
    if (cid == null || !(await canAccess(cid))) return json({ ok: false, error: 'No access.' }, 403);
    const { error } = await admin.from('client_app_users').delete().eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
});
