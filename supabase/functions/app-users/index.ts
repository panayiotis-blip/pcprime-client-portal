// =============================================================
// Supabase Edge Function: app-users  (portal JWT required)
// =============================================================
// Firm-side management of a client app's own logins (client_app_users,
// migration 162). Passwords are PBKDF2-hashed here (server-side) so the
// browser never handles a hash. Every action is gated by the caller being
// able to access the target client (user_can_access_client via their JWT).
//
// LEGACY (App access Phase 5): these username logins are being retired in
// favour of email accounts + client_app_grants. This function stays only so
// the firm can see and clean up what's left; new access is granted by email
// via app-grants-admin, and moving an existing login over is its
// migrate_user action.
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

  // Reach is not authority: user_can_access_client is also true for the
  // client's own portal users, so creating/resetting/deleting logins is gated
  // on canManage (staff) below. Otherwise a portal client could mint app
  // logins on their own client by calling this function directly.
  const canAccess = async (clientId: number): Promise<boolean> => {
    const { data } = await userClient.rpc('user_can_access_client', { cid: clientId });
    return data === true;
  };
  // Who may change this app's logins: firm staff, or the app's OWN admin (a
  // client person holding an admin grant on exactly this client + app, which
  // is what the in-app user screen runs as). A portal client with no admin
  // grant cannot — reaching the client is not authority over its logins.
  const canManage = async (clientId: number, appKey: string): Promise<boolean> => {
    if (!(await canAccess(clientId))) return false;
    if (await isStaff()) return true;
    if (!appKey) return false;
    const { data } = await admin.from('client_app_grants')
      .select('id').eq('user_id', user.id).eq('client_id', clientId)
      .eq('app_key', appKey).eq('role', 'admin').eq('active', true).maybeSingle();
    return !!data;
  };
  // The (client, app) a legacy login belongs to — id-based actions gate on it.
  const scopeOf = async (id: number): Promise<{ client_id: number; app_key: string } | null> => {
    const { data } = await admin.from('client_app_users').select('client_id, app_key').eq('id', id).maybeSingle();
    return data ? (data as any) : null;
  };
  // Is the caller firm staff (for global actions like reviewing requests)?
  const isStaff = async (): Promise<boolean> => {
    const { data } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    return !!data && ['owner', 'supervisor', 'admin', 'staff'].includes((data as any).role);
  };

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
  const action = body.action;

  if (action === 'list') {
    const clientId = Number(body.client_id);
    if (!(await canAccess(clientId))) return json({ ok: false, error: 'No access to this client.' }, 403);
    const { data, error } = await admin.from('client_app_users')
      .select('id, username, name, role, active, last_login_at, created_at, migrated_at, migrated_email')
      .eq('client_id', clientId).eq('app_key', String(body.app_key)).order('created_at');
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, users: data || [] });
  }

  if (action === 'create') {
    const clientId = Number(body.client_id);
    if (!(await canManage(clientId, String(body.app_key || '')))) {
      return json({ ok: false, error: 'Only firm staff or this app\'s admin can add logins.' }, 403);
    }
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
    const sc = await scopeOf(id);
    if (!sc || !(await canManage(sc.client_id, sc.app_key))) return json({ ok: false, error: 'Only firm staff or this app\'s admin can change logins.' }, 403);
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
    const sc = await scopeOf(id);
    if (!sc || !(await canManage(sc.client_id, sc.app_key))) return json({ ok: false, error: 'Only firm staff or this app\'s admin can reset a password.' }, 403);
    const password = String(body.password || '');
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters.' }, 400);
    const { error } = await admin.from('client_app_users').update({ password_hash: await pbkdf2Hash(password) }).eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'delete') {
    const id = Number(body.id);
    const sc = await scopeOf(id);
    if (!sc || !(await canManage(sc.client_id, sc.app_key))) return json({ ok: false, error: 'Only firm staff or this app\'s admin can delete a login.' }, 403);
    const { error } = await admin.from('client_app_users').delete().eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // ----- Self-registration requests (migration 163) -----
  if (action === 'list_requests') {
    if (!(await isStaff())) return json({ ok: false, error: 'Staff only.' }, 403);
    const { data, error } = await admin.from('client_app_access_requests')
      .select('id, app_key, client_name, full_name, username, email, phone, message, created_at')
      .eq('status', 'pending').order('created_at');
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, requests: data || [] });
  }

  if (action === 'approve_request') {
    const id = Number(body.id);
    const clientId = Number(body.client_id);
    if (!(await canAccess(clientId))) return json({ ok: false, error: 'No access to this client.' }, 403);
    const { data: reqRow } = await admin.from('client_app_access_requests').select('*').eq('id', id).maybeSingle();
    if (!reqRow || (reqRow as any).status !== 'pending') return json({ ok: false, error: 'Request not found or already handled.' }, 404);
    const r: any = reqRow;
    const role = ROLES.includes(body.role) ? body.role : 'editor';
    const appKey = String(body.app_key || r.app_key || 'rentals');
    // Create the login from the (already hashed) request, and make sure the
    // client has the app enabled so the login works.
    const { data: created, error: cErr } = await admin.from('client_app_users').insert({
      client_id: clientId, app_key: appKey, username: r.username, name: r.full_name,
      role, password_hash: r.password_hash, created_by: user.id,
    }).select('id').single();
    if (cErr) return json({ ok: false, error: /duplicate|unique/i.test(cErr.message) ? 'That username is already taken.' : cErr.message }, 400);
    await admin.from('client_apps').upsert({ client_id: clientId, app_key: appKey, enabled: true }, { onConflict: 'client_id,app_key' });
    await admin.from('client_app_access_requests').update({
      status: 'approved', client_id: clientId, resulting_user_id: (created as any).id,
      reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    return json({ ok: true, id: (created as any).id });
  }

  if (action === 'reject_request') {
    if (!(await isStaff())) return json({ ok: false, error: 'Staff only.' }, 403);
    const { error } = await admin.from('client_app_access_requests')
      .update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq('id', Number(body.id)).eq('status', 'pending');
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
});
