// Shared helpers for the script files. Centralizes config + admin sign-in so
// secrets never live in the script bodies.
//
// Reads (in order of precedence):
//   1. real process.env (CI, shell exports)
//   2. .env.scripts at the project root (gitignored — for local convenience)
//   3. .env at the project root (already used by Vite)
//
// Admin credentials may also be passed positionally on the command line:
//   node scripts/foo.mjs <email> <password>

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const k = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(path.join(ROOT, '.env.scripts'));
loadEnvFile(path.join(ROOT, '.env'));

export const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (or the VITE_ variants).');
  console.error('Set them in .env or .env.scripts at the project root.');
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Returns positional CLI args (skips anything starting with --).
export function positionalArgs() {
  return process.argv.slice(2).filter(a => !a.startsWith('--'));
}

// Sign in as an admin user. Resolves credentials from CLI args first, then env.
// Exits with a clear message if neither is available.
export async function signInAsAdmin() {
  const argv = positionalArgs();
  const email    = argv[0] || process.env.SUPABASE_ADMIN_EMAIL    || '';
  const password = argv[1] || process.env.SUPABASE_ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.error('Admin credentials required. Provide them via either:');
    console.error('  - CLI args:  node scripts/<file>.mjs <email> <password>');
    console.error('  - Env vars:  SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD');
    console.error('  - .env.scripts at the project root (gitignored).');
    process.exit(1);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('✗ Sign-in failed:', error.message);
    process.exit(1);
  }
  return { user: data.user, session: data.session, email };
}
