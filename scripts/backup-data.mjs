// =============================================================
// backup-data.mjs — nightly copy of the database tables that matter
// =============================================================
// scripts/backup-storage.mjs copies Storage — the uploaded files. This copies
// the DATA, which had no copy anywhere outside Supabase. The only protection
// was Supabase's own daily snapshot with SEVEN DAYS of retention and no
// point-in-time recovery, so a deletion noticed a fortnight later was gone, and
// a lost project would have taken the rent schedules with it while the NAS sat
// there holding the contracts.
//
// Not pg_dump: this PC has no pg_dump, no psql and no Docker, and the user
// chose not to install them. This reads through PostgREST with the service key
// and writes plain JSON — which has a quiet advantage over a dump, in that you
// can open one file and read it without restoring anything.
//
//   node scripts/backup-data.mjs [destination] [--table x] [--keep 90]
//
// Writes <destination>/<YYYY-MM-DD>/<table>.json plus a manifest, and prunes
// folders older than --keep days (default 90).
//
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.scripts (gitignored). The
// publishable key returns almost nothing under RLS rather than failing, so the
// script checks it is reading a plausible amount and fails loudly if not.
// =============================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env.scripts'));
loadEnvFile(path.join(ROOT, '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_URL) { console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL).'); process.exit(1); }
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  console.error('');
  console.error('Dashboard → Settings → API → service_role key, then add to .env.scripts:');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=eyJ...');
  console.error('The publishable key will NOT do — RLS would hide almost every row and');
  console.error('the backup would look like it worked while being nearly empty.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flagValue = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const DEST = path.resolve(positional[0] || path.join(ROOT, 'backups', 'data'));
const ONLY = flagValue('table');
const KEEP_DAYS = Number(flagValue('keep') || 90);

// What cannot be recreated from anything else.
//
// app_templates earns its place for a reason that is easy to miss: it holds the
// HTML of every uploaded app. The Unit Builder's source lives on one PC in a
// gitignored folder, so this row IS the off-machine copy of that app.
//
// `expect` is a floor, not a count — a table that suddenly returns fewer rows
// than this is reported, because a backup quietly going empty is worse than one
// that fails.
const TABLES = [
  { name: 'client_app_data',    why: 'every embedded app\'s data — rentals, unit builder, management', expect: 1 },
  { name: 'client_app_config',  why: 'per-client app configuration', expect: 0 },
  { name: 'client_apps',        why: 'which client has which app', expect: 1 },
  { name: 'client_app_grants',  why: 'who may open what', expect: 1 },
  { name: 'client_app_users',   why: 'legacy username logins', expect: 0 },
  { name: 'app_templates',      why: 'the uploaded apps themselves (HTML)', expect: 1 },
  { name: 'clients',            why: 'the client register', expect: 1 },
  { name: 'client_tax_filings', why: 'tax filing records and their attachments', expect: 0 },
  { name: 'documents',          why: 'metadata pointing at the Storage backup', expect: 1 },
  { name: 'time_entries',       why: 'timesheets', expect: 0 },
  { name: 'timesheet_services', why: 'the service list behind them', expect: 1 },
];

const PAGE = 1000;
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/** Every row of a table, a page at a time — PostgREST caps a single response. */
async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, Prefer: 'count=exact' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error('unexpected response shape');
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

const stamp = new Date().toISOString().slice(0, 10);
const outDir = path.join(DEST, stamp);

console.log(`Backing up data to ${outDir}`);
mkdirSync(outDir, { recursive: true });

const manifest = { takenAt: new Date().toISOString(), source: SUPABASE_URL, tables: [] };
let failed = 0, thin = 0, totalRows = 0, totalBytes = 0;

for (const t of TABLES) {
  if (ONLY && ONLY !== t.name) continue;
  try {
    const rows = await fetchAll(t.name);
    const json = JSON.stringify(rows, null, 1);
    const file = path.join(outDir, `${t.name}.json`);
    writeFileSync(file, json, 'utf8');
    totalRows += rows.length; totalBytes += Buffer.byteLength(json);

    const suspicious = rows.length < t.expect;
    if (suspicious) thin++;
    manifest.tables.push({ table: t.name, rows: rows.length, bytes: Buffer.byteLength(json), suspicious });
    console.log(`  ${suspicious ? 'THIN ' : 'ok   '}${t.name.padEnd(22)} ${String(rows.length).padStart(6)} rows  ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB`);
    if (suspicious) console.log(`       ^ expected at least ${t.expect} row(s) — ${t.why}`);
  } catch (e) {
    failed++;
    manifest.tables.push({ table: t.name, error: String(e.message || e) });
    console.error(`  FAIL ${t.name.padEnd(22)} ${e.message || e}`);
  }
}

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n${totalRows} rows, ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${manifest.tables.length} table(s).`);

// Prune old folders. Dated directories only, so nothing else in the destination
// can be caught by this.
if (KEEP_DAYS > 0 && existsSync(DEST)) {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  let removed = 0;
  for (const name of readdirSync(DEST)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    const p = path.join(DEST, name);
    try {
      if (statSync(p).isDirectory() && Date.parse(name) < cutoff) { rmSync(p, { recursive: true, force: true }); removed++; }
    } catch { /* leave anything we cannot read */ }
  }
  if (removed) console.log(`Pruned ${removed} folder(s) older than ${KEEP_DAYS} days.`);
}

if (failed) { console.error(`\n${failed} table(s) failed.`); process.exitCode = 1; }
else if (thin) { console.error(`\n${thin} table(s) came back thinner than expected — check the key and RLS.`); process.exitCode = 1; }
else console.log('\nAll tables backed up.');
