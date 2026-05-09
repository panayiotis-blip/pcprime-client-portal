// E2E: create a throwaway user via the admin-users edge function, then delete them.
import { signInAsAdmin, SUPABASE_URL } from './_lib.mjs';

const { session } = await signInAsAdmin();
const token = session.access_token;

const fn = (path, method, body) =>
  fetch(`${SUPABASE_URL}/functions/v1/admin-users${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const testEmail = `e2e-${Date.now()}@example.test`;
console.log('CREATE', testEmail);
const c = await fn('', 'POST', { email: testEmail, password: 'TempPass1!', display_name: 'E2E Test', role: 'client' });
console.log(' →', c.status, c.body);
if (c.status >= 400) process.exit(1);
const newId = c.body.id;

console.log('DELETE', newId);
const d = await fn(`/${newId}`, 'DELETE');
console.log(' →', d.status, d.body);
