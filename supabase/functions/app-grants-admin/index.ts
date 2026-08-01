// =============================================================
// Supabase Edge Function: app-grants-admin  (portal JWT required)
// =============================================================
// App access Phase 2. Firm-side management of client-app access under the
// unified email/Supabase-Auth identity (client_app_grants, migration 164).
// The firm grants an app to a person BY EMAIL: an existing account (portal
// client or staff) is reused; a new email is INVITED (Supabase sends the
// set-password email) and marked role='app_user'. Passwords never touch this
// function — Supabase Auth owns them, so clients self-reset.
//
// Every action is gated by the caller being able to access the target client
// (user_can_access_client via their JWT). Writes to client_app_grants /
// auth.users use the service role.
//
// Actions (POST { action, ... }):
//   list   {client_id, app_key?}                       → { ok, grants:[{id,user_id,email,name,app_key,role,active,created_at}] }
//   grant  {client_id, app_key, email, role?, name?}   → { ok, id, user_id, invited }
//   set_role {id, role}                                → { ok }
//   set_active {id, active}                            → { ok }
//   revoke {id}                                        → { ok }
//   migrate_user {legacy_id, email, role?}             → { ok, id, user_id, invited }
//   purge_app {app_key, dry_run?}                      → { ok, summary }
//
// Deploy with "Verify JWT" OFF — we validate the JWT in-function.
//   supabase functions deploy app-grants-admin --project-ref ddwdrjhnfwpbtqzqgdsl --no-verify-jwt
// Requires migrations 164 + 165 applied (169 for migrate_user).
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['admin', 'editor', 'viewer'];
const PORTAL_URL = Deno.env.get('PORTAL_URL') ?? 'https://portal.primeandcalculate.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  // ---- Authenticate the caller from their portal JWT ----
  const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${authToken}` } } });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);

  // Reach: is_admin() staff OR a portal client linked to this client. Enough to
  // SEE a client, NOT enough to administer access to it — user_can_access_client
  // is true for the client's own portal users, so every management action below
  // is additionally gated on isStaff(). Without that, a portal client could
  // invite accounts onto their client, enable apps, or set another grant
  // holder's password by calling this function directly with their own JWT.
  const canAccess = async (clientId: number): Promise<boolean> => {
    if (!clientId) return false;
    const { data } = await userClient.rpc('user_can_access_client', { cid: clientId });
    return data === true;
  };
  // Firm staff AND able to reach this client — the gate for anything that
  // changes who can get in.
  const canManage = async (clientId: number): Promise<boolean> =>
    (await isStaff()) && (await canAccess(clientId));
  // Resolve a grant row's client_id (for id-based actions), then gate on it.
  const grantClient = async (id: number): Promise<number | null> => {
    const { data } = await admin.from('client_app_grants').select('client_id').eq('id', id).maybeSingle();
    return data ? (data as any).client_id : null;
  };
  // Is the caller firm staff? (for global actions like reviewing requests)
  const isStaff = async (): Promise<boolean> => {
    const { data } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    return !!data && ['owner', 'supervisor', 'admin', 'staff'].includes((data as any).role);
  };
  // Resolve an email to an existing account, or invite a new one (marking new
  // accounts app_user). Returns the user id + whether an invite was sent.
  const resolveOrInvite = async (email: string, name: string): Promise<{ userId: string; invited: boolean } | { error: string }> => {
    const { data: existingId, error: lookErr } = await admin.rpc('auth_user_id_by_email', { p_email: email });
    if (lookErr) return { error: 'Lookup failed: ' + lookErr.message };
    if (existingId) return { userId: existingId as string, invited: false };
    const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: name ? { full_name: name } : {},
      redirectTo: `${PORTAL_URL}/reset-password`,
    });
    if (invErr || !inv?.user) return { error: 'Could not invite that email: ' + (invErr?.message || 'unknown error') };
    const uid = inv.user.id;
    await admin.from('profiles').update({ role: 'app_user' }).eq('id', uid);
    if (name) await admin.from('profiles').update({ full_name: name }).eq('id', uid);
    return { userId: uid, invited: true };
  };
  // Enable the app for the client and upsert the grant (idempotent).
  const upsertGrant = async (clientId: number, appKey: string, userId: string, role: string): Promise<{ id: number } | { error: string }> => {
    await admin.from('client_apps').upsert(
      { client_id: clientId, app_key: appKey, enabled: true }, { onConflict: 'client_id,app_key' });
    const { data: g, error: gErr } = await admin.from('client_app_grants').upsert(
      { user_id: userId, client_id: clientId, app_key: appKey, role, active: true, created_by: user.id },
      { onConflict: 'user_id,client_id,app_key' },
    ).select('id').single();
    if (gErr) return { error: gErr.message };
    return { id: (g as any).id };
  };

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
  const action = body.action;

  // ---------------------------------------------------------
  // list — grants for a client (optionally one app), + email/name
  // ---------------------------------------------------------
  if (action === 'list') {
    const clientId = Number(body.client_id);
    if (!(await canAccess(clientId))) return json({ ok: false, error: 'No access to this client.' }, 403);
    let q = admin.from('client_app_grants')
      .select('id, user_id, app_key, role, active, created_at')
      .eq('client_id', clientId);
    if (body.app_key) q = q.eq('app_key', String(body.app_key));
    const { data: grants, error } = await q.order('created_at');
    if (error) return json({ ok: false, error: error.message }, 500);

    const ids = [...new Set((grants || []).map((g: any) => g.user_id))];
    // Names from profiles (one query); emails from the auth admin API (per id).
    const nameById: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', ids);
      for (const p of profs || []) nameById[(p as any).id] = (p as any).full_name || '';
    }
    const emailById: Record<string, string> = {};
    await Promise.all(ids.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id as string);
      emailById[id as string] = data?.user?.email || '';
    }));

    const out = (grants || []).map((g: any) => ({
      id: g.id, user_id: g.user_id, email: emailById[g.user_id] || '',
      name: nameById[g.user_id] || '', app_key: g.app_key, role: g.role,
      active: g.active, created_at: g.created_at,
    }));
    return json({ ok: true, grants: out });
  }

  // ---------------------------------------------------------
  // grant — give an email access to (client, app); invite if new
  // ---------------------------------------------------------
  if (action === 'grant') {
    const clientId = Number(body.client_id);
    if (!(await canManage(clientId))) return json({ ok: false, error: 'Only firm staff can grant app access.' }, 403);
    const appKey = String(body.app_key || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const role = ROLES.includes(body.role) ? body.role : 'editor';
    const name = String(body.name || '').trim();
    if (!appKey) return json({ ok: false, error: 'app_key is required.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400);

    const resolved = await resolveOrInvite(email, name);
    if ('error' in resolved) return json({ ok: false, error: resolved.error }, 400);
    const g = await upsertGrant(clientId, appKey, resolved.userId, role);
    if ('error' in g) return json({ ok: false, error: g.error }, 500);
    return json({ ok: true, id: g.id, user_id: resolved.userId, invited: resolved.invited });
  }

  // ---------------------------------------------------------
  // set_role / set_active / revoke — by grant id
  // ---------------------------------------------------------
  if (action === 'set_role') {
    const id = Number(body.id);
    const cid = await grantClient(id);
    if (cid == null || !(await canManage(cid))) return json({ ok: false, error: 'Only firm staff can change app access.' }, 403);
    if (!ROLES.includes(body.role)) return json({ ok: false, error: 'Invalid role.' }, 400);
    const { error } = await admin.from('client_app_grants').update({ role: body.role }).eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'set_active') {
    const id = Number(body.id);
    const cid = await grantClient(id);
    if (cid == null || !(await canManage(cid))) return json({ ok: false, error: 'Only firm staff can change app access.' }, 403);
    const { error } = await admin.from('client_app_grants').update({ active: !!body.active }).eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === 'revoke') {
    const id = Number(body.id);
    const cid = await grantClient(id);
    if (cid == null || !(await canManage(cid))) return json({ ok: false, error: 'Only firm staff can change app access.' }, 403);
    const { error } = await admin.from('client_app_grants').delete().eq('id', id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // ---------------------------------------------------------
  // set_password — firm sets an app user's password directly. Only for
  // someone who holds a grant on a client the caller can access. (The
  // gentler alternative — email the client a reset link — is done
  // client-side via supabase.auth.resetPasswordForEmail, no fn needed.)
  // ---------------------------------------------------------
  if (action === 'set_password') {
    const userId = String(body.user_id || '');
    const clientId = Number(body.client_id);
    const password = String(body.password || '');
    if (!(await canManage(clientId))) return json({ ok: false, error: 'Only firm staff can set a password.' }, 403);
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters.' }, 400);
    const { data: gr } = await admin.from('client_app_grants')
      .select('id').eq('user_id', userId).eq('client_id', clientId).limit(1).maybeSingle();
    if (!gr) return json({ ok: false, error: 'That person has no app access on this client.' }, 404);
    // Never let the app-access path set a FIRM account's password. A staff
    // member who also holds a grant would otherwise be resettable from here,
    // turning app administration into a route into the portal itself. Staff
    // change their own password, or an owner does it in User Management.
    const { data: targetProf } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
    if (targetProf && ['owner', 'supervisor', 'admin', 'staff'].includes((targetProf as any).role)) {
      return json({ ok: false, error: 'That is a firm account — change its password in User Management, not here.' }, 403);
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true });
  }

  // ---------------------------------------------------------
  // migrate_user — Phase 5 cutover. Move ONE legacy username login
  // (client_app_users, migration 162) onto an email account: reuse or invite
  // the account, copy the login's app + role into a grant, then retire the old
  // row (active = false, migrated_* stamped, migration 169). The password is
  // NOT carried over — it can't be, the old one is a one-way PBKDF2 hash — so
  // a brand-new account gets the usual invite email and an existing account
  // keeps the password it already has.
  // ---------------------------------------------------------
  if (action === 'migrate_user') {
    const legacyId = Number(body.legacy_id);
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400);

    const { data: legacy } = await admin.from('client_app_users')
      .select('id, client_id, app_key, username, name, role, migrated_at')
      .eq('id', legacyId).maybeSingle();
    if (!legacy) return json({ ok: false, error: 'That app user no longer exists.' }, 404);
    const lu: any = legacy;
    if (lu.migrated_at) return json({ ok: false, error: 'That login has already been moved to an email account.' }, 400);
    if (!(await canManage(lu.client_id))) return json({ ok: false, error: 'Only firm staff can move a login to email.' }, 403);

    const role = ROLES.includes(body.role) ? body.role : (ROLES.includes(lu.role) ? lu.role : 'editor');
    const resolved = await resolveOrInvite(email, lu.name || '');
    if ('error' in resolved) return json({ ok: false, error: resolved.error }, 400);
    const g = await upsertGrant(lu.client_id, lu.app_key, resolved.userId, role);
    if ('error' in g) return json({ ok: false, error: g.error }, 500);

    // Retire the old login only once the grant is safely in place.
    const { error: mErr } = await admin.from('client_app_users').update({
      active: false, migrated_at: new Date().toISOString(),
      migrated_user_id: resolved.userId, migrated_email: email,
    }).eq('id', legacyId);
    if (mErr) return json({ ok: false, error: 'Access was granted but the old login could not be retired: ' + mErr.message }, 500);

    return json({ ok: true, id: g.id, user_id: resolved.userId, invited: resolved.invited });
  }

  // ---------------------------------------------------------
  // purge_app — retire an UPLOADED app template completely: its allocations,
  // every client's data for it, the grants that opened it and any legacy
  // username logins scoped to it, then the template itself. Deleting just the
  // template row would leave allocated clients with an app that no longer
  // loads, so removal is one action.
  //
  // Only apps that came from app_templates can be purged: a built-in app (no
  // template row) is refused, which keeps this away from Greson's rentals and
  // mgmt data. dry_run returns the same summary without deleting, so the UI can
  // spell out the damage before asking.
  // ---------------------------------------------------------
  if (action === 'purge_app') {
    if (!(await isStaff())) return json({ ok: false, error: 'Staff only.' }, 403);
    const appKey = String(body.app_key || '').trim();
    if (!appKey) return json({ ok: false, error: 'app_key is required.' }, 400);

    // Built-in apps ship in code and must never be purged — their data is real
    // client work (keep in sync with CLIENT_APPS in src/services/clientApps.ts).
    const BUILT_IN = ['rentals', 'mgmt'];
    if (BUILT_IN.includes(appKey)) return json({ ok: false, error: 'That is a built-in app and cannot be removed this way.' }, 400);

    // Normally there is a template to delete. There may not be: deleting a
    // template used to leave its allocations behind, and those orphans still
    // show as apps that will not load. Purging is how they get cleaned up.
    const { data: tmpl } = await admin.from('app_templates').select('id, name').eq('key', appKey).maybeSingle();

    const { data: allocs } = await admin.from('client_apps').select('client_id').eq('app_key', appKey);
    const clientIds = (allocs || []).map((r: any) => r.client_id);
    const names: Record<number, string> = {};
    if (clientIds.length) {
      const { data: cs } = await admin.from('clients').select('id, name').in('id', clientIds);
      for (const c of cs || []) names[(c as any).id] = (c as any).name || '';
    }
    const { count: dataRows } = await admin.from('client_app_data')
      .select('client_id', { count: 'exact', head: true }).eq('app_key', appKey);
    const { count: grantRows } = await admin.from('client_app_grants')
      .select('id', { count: 'exact', head: true }).eq('app_key', appKey);
    const { count: legacyRows } = await admin.from('client_app_users')
      .select('id', { count: 'exact', head: true }).eq('app_key', appKey);

    const summary = {
      template: (tmpl as any)?.name ?? `${appKey} (no template — orphaned allocations)`,
      clients: clientIds.length,
      client_names: clientIds.map(id => names[id] || `#${id}`).sort(),
      data_rows: dataRows ?? 0, grants: grantRows ?? 0, legacy_users: legacyRows ?? 0,
    };
    if (body.dry_run) return json({ ok: true, summary });

    // Dependants first, template last — a failure part-way leaves the template
    // in place rather than orphaning clients on a missing app.
    for (const table of ['client_app_grants', 'client_app_users', 'client_app_data', 'client_apps']) {
      const { error } = await admin.from(table).delete().eq('app_key', appKey);
      if (error) return json({ ok: false, error: `Failed clearing ${table}: ${error.message}` }, 500);
    }
    if (tmpl) {
      const { error: tErr } = await admin.from('app_templates').delete().eq('id', (tmpl as any).id);
      if (tErr) return json({ ok: false, error: 'Everything was cleared but the template row remains: ' + tErr.message }, 500);
    }

    return json({ ok: true, summary });
  }

  // ---------------------------------------------------------
  // Self-registration requests (migration 163/166) — email based
  // ---------------------------------------------------------
  if (action === 'list_requests') {
    if (!(await isStaff())) return json({ ok: false, error: 'Staff only.' }, 403);
    const { data, error } = await admin.from('client_app_access_requests')
      .select('id, app_key, client_name, full_name, email, phone, message, created_at')
      .eq('status', 'pending').order('created_at');
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, requests: data || [] });
  }

  if (action === 'approve_request') {
    const id = Number(body.id);
    const clientId = Number(body.client_id);
    if (!(await canManage(clientId))) return json({ ok: false, error: 'Only firm staff can approve a request.' }, 403);
    const { data: reqRow } = await admin.from('client_app_access_requests').select('*').eq('id', id).maybeSingle();
    if (!reqRow || (reqRow as any).status !== 'pending') return json({ ok: false, error: 'Request not found or already handled.' }, 404);
    const rr: any = reqRow;
    const email = String(rr.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'This request has no valid email to invite.' }, 400);
    const appKey = String(body.app_key || rr.app_key || 'rentals');
    const role = ROLES.includes(body.role) ? body.role : 'editor';
    const resolved = await resolveOrInvite(email, rr.full_name || '');
    if ('error' in resolved) return json({ ok: false, error: resolved.error }, 400);
    const g = await upsertGrant(clientId, appKey, resolved.userId, role);
    if ('error' in g) return json({ ok: false, error: g.error }, 500);
    await admin.from('client_app_access_requests').update({
      status: 'approved', client_id: clientId, resulting_grant_id: g.id,
      reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    return json({ ok: true, grant_id: g.id, invited: resolved.invited });
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
