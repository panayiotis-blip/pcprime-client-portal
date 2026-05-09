// Diagnostic: verify Supabase connection, auth, and schema from the terminal.
// Reads config from .env / .env.scripts (see scripts/_lib.mjs).
import { supabase, signInAsAdmin, SUPABASE_URL } from './_lib.mjs';

async function probe(label, fn) {
  try {
    const r = await fn();
    console.log(`✓ ${label}:`, JSON.stringify(r, null, 2).slice(0, 400));
  } catch (e) {
    console.log(`✗ ${label}:`, e?.message || e);
  }
}

console.log('--- Supabase Diagnostic ---');
console.log('URL:', SUPABASE_URL);
console.log('');

// 1. Can we reach the auth endpoint?
await probe('auth reachable', async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return { session: data.session ? 'present' : 'none' };
});

// 2. Sign in as admin
const { email } = await signInAsAdmin();
console.log(`✓ Signed in as ${email}`);

// 3. Check tables exist (RLS-aware)
await probe('profiles table', async () => {
  const { data, error, status } = await supabase.from('profiles').select('id, role').limit(1);
  if (error) throw new Error(`${error.message} (status=${status}, code=${error.code})`);
  return { rows: data?.length ?? 0, sample: data };
});

await probe('clients table', async () => {
  const { data, error, status } = await supabase.from('clients').select('id, name').limit(1);
  if (error) throw new Error(`${error.message} (status=${status}, code=${error.code})`);
  return { rows: data?.length ?? 0, sample: data };
});

await probe('user_clients table', async () => {
  const { data, error, status } = await supabase.from('user_clients').select('user_id').limit(1);
  if (error) throw new Error(`${error.message} (status=${status}, code=${error.code})`);
  return { rows: data?.length ?? 0 };
});

// 4. Look up our own profile
const { data: session } = await supabase.auth.getSession();
if (session.session) {
  await probe('my profile row', async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.session.user.id).single();
    if (error) throw error;
    return data;
  });
}

console.log('');
console.log('--- done ---');
