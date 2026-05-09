// Smoke test: hit the admin-users edge function with empty body, expect 400.
import { signInAsAdmin, SUPABASE_URL } from './_lib.mjs';

const { session } = await signInAsAdmin();
const token = session.access_token;

// 1. OPTIONS preflight
const opts = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, { method: 'OPTIONS' });
console.log('OPTIONS:', opts.status);

// 2. POST with empty body — should return a clear error
const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const body = await res.text();
console.log('POST {} →', res.status, body.slice(0, 300));
