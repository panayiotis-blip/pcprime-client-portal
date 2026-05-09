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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
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

  // Check their profile role — owner/supervisor/admin/staff all qualify
  const { data: profile } = await admin.from('profiles').select('role, active').eq('id', user.id).maybeSingle();
  const STAFF_ROLES = ['owner', 'supervisor', 'admin', 'staff'];
  if (!profile || !STAFF_ROLES.includes(profile.role) || !profile.active) {
    return { error: 'Admin privilege required', status: 403 };
  }
  return { userId: user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const guard = await requireAdmin(req);
  if ('error' in guard) return json({ error: guard.error }, guard.status);

  const url = new URL(req.url);
  // Path after /functions/v1/admin-users
  const tail = url.pathname.replace(/^.*\/admin-users/, '').replace(/^\/+|\/+$/g, '');

  try {
    // POST /admin-users  → create user
    if (req.method === 'POST' && !tail) {
      const body = await req.json();
      const { email, password, username, full_name, role, client_ids } = body || {};
      if (!email || !password) return json({ error: 'email and password required' }, 400);
      if (role && !['admin', 'client'].includes(role)) return json({ error: 'role must be admin or client' }, 400);

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
      if (error || !data.user) return json({ error: error?.message || 'Create failed' }, 400);

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
      return json({ id: newId, email });
    }

    // PATCH /admin-users/<uid>/password  → reset a user's password
    if (req.method === 'PATCH' && tail.endsWith('/password')) {
      const uid = tail.split('/')[0];
      const { password } = await req.json();
      if (!uid || !password) return json({ error: 'id and password required' }, 400);
      const { error } = await admin.auth.admin.updateUserById(uid, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // DELETE /admin-users/<uid>  → delete a user
    if (req.method === 'DELETE' && tail) {
      const uid = tail.split('/')[0];
      if (!uid) return json({ error: 'user id required' }, 400);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Not found', method: req.method, tail }, 404);
  } catch (e) {
    return json({ error: (e as Error).message || 'Server error' }, 500);
  }
});
