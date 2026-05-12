// Supabase Edge Function: admin-users
// Endpoints (all require the caller to be authenticated as an admin):
//   POST   /admin-users           { email, password, username?, full_name?, role, client_ids? }
//   DELETE /admin-users/<userId>
//   PATCH  /admin-users/<userId>/password   { password }
//
// Deploy with:
//   supabase functions deploy admin-users
// or paste the contents into Supabase Dashboard → Edge Functions → New Function → admin-users.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Admin client (full privileges — never reaches the browser)
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// CORS: this function is JWT-protected (caller must have a valid Supabase
// session AND the users.write permission), so locking the Allow-Origin to
// specific domains doesn't add meaningful security here — it just changes
// WHICH WEBSITES can attempt the call. We echo back whatever Origin the
// browser sends; if no JWT is presented, requireAdmin() rejects regardless.
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

// Decode an unverified JWT payload to read its claims. Safe to inspect claims
// without verifying the signature here because we ALSO verify the token via
// caller.auth.getUser() below — that step rejects invalid/forged tokens.
function jwtAal(token: string): string {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.aal || 'aal1';
  } catch {
    return 'aal1';
  }
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Missing Authorization header', status: 401 };

  // Verify the caller's JWT with an anon client
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !user) return { error: 'Invalid token', status: 401 };

  // Step-up: user management requires fresh MFA verification in this session.
  if (jwtAal(token) !== 'aal2') {
    return { error: 'MFA verification required. Sign out and sign in again, entering your authenticator code.', status: 403 };
  }

  // Permission check via has_permission RPC. Run as the caller (their JWT) so
  // auth.uid() inside the function resolves to them.
  const { data: hasPerm, error: permErr } = await caller.rpc('has_permission', { p_perm: 'users.write' });
  if (permErr) return { error: permErr.message, status: 500 };
  if (!hasPerm)  return { error: 'users.write permission required', status: 403 };
  return { userId: user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });

  const guard = await requireAdmin(req);
  if ('error' in guard) return json(req, { error: guard.error }, guard.status);

  const url = new URL(req.url);
  // Path after /functions/v1/admin-users
  const tail = url.pathname.replace(/^.*\/admin-users/, '').replace(/^\/+|\/+$/g, '');

  try {
    // POST /admin-users  → create user
    if (req.method === 'POST' && !tail) {
      const body = await req.json();
      const { email, password, username, full_name, role, client_ids } = body || {};
      if (!email || !password) return json(req, { error: 'email and password required' }, 400);
      if (role && !['admin', 'client'].includes(role)) return json(req, { error: 'role must be admin or client' }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: username || email.split('@')[0],
          full_name: full_name || '',
          role: role || 'client',
        },
      });
      if (error || !data.user) return json(req, { error: error?.message || 'Create failed' }, 400);

      const newId = data.user.id;

      // Trigger created a profile with metadata; keep fields consistent even if metadata was empty
      await admin.from('profiles').update({
        username: username || email.split('@')[0],
        full_name: full_name || '',
        role: role || 'client',
        active: true,
      }).eq('id', newId);

      if (Array.isArray(client_ids) && client_ids.length) {
        await admin.from('user_clients').insert(
          client_ids.map((cid: number) => ({ user_id: newId, client_id: cid }))
        );
      }
      return json(req, { id: newId, email });
    }

    // PATCH /admin-users/<uid>/password  → reset a user's password
    // POST /admin-users/invite  → invite a client to the portal by email.
    // No password is set: Supabase emails them a magic link, they click it,
    // land logged in, and can set a password on the Security page.
    if (req.method === 'POST' && tail === 'invite') {
      const body = await req.json();
      const { email, full_name, client_id } = body || {};
      if (!email) return json(req, { error: 'email required' }, 400);
      if (!client_id) return json(req, { error: 'client_id required' }, 400);

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: {
          username: email.split('@')[0],
          full_name: full_name || '',
          role: 'client',
        },
        redirectTo: 'https://portal.primeandcalculate.com/',
      });
      if (error || !data.user) return json(req, { error: error?.message || 'Invite failed' }, 400);

      const newId = data.user.id;

      // The auth trigger creates a profiles stub from metadata; lock the
      // role/active fields explicitly so RLS treats them as a client.
      await admin.from('profiles').update({
        username: email.split('@')[0],
        full_name: full_name || '',
        role: 'client',
        active: true,
      }).eq('id', newId);

      // Link to the client record. Upsert in case of re-invite collisions.
      await admin.from('user_clients').upsert(
        { user_id: newId, client_id },
        { onConflict: 'user_id,client_id' }
      );

      return json(req, { id: newId, email });
    }

    if (req.method === 'PATCH' && tail.endsWith('/password')) {
      const uid = tail.split('/')[0];
      const { password } = await req.json();
      if (!uid || !password) return json(req, { error: 'id and password required' }, 400);
      const { error } = await admin.auth.admin.updateUserById(uid, { password });
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { ok: true });
    }

    // DELETE /admin-users/<uid>  → delete a user
    if (req.method === 'DELETE' && tail) {
      const uid = tail.split('/')[0];
      if (!uid) return json(req, { error: 'user id required' }, 400);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) return json(req, { error: error.message }, 400);
      return json(req, { ok: true });
    }

    return json(req, { error: 'Not found', method: req.method, tail }, 404);
  } catch (e) {
    return json(req, { error: (e as Error).message || 'Server error' }, 500);
  }
});
