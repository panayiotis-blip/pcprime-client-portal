// =============================================================
// Local backup of the Storage buckets
// =============================================================
// Supabase's daily backups cover Postgres. They do NOT cover the files in
// Storage — the `documents` row is in the dump, the PDF it points at is not.
// Those files are the part of this system nobody could recreate, so this
// walks every bucket and writes the objects to a folder on this machine.
//
//   node scripts/backup-storage.mjs                  → backups/storage
//   node scripts/backup-storage.mjs D:\pcprime-backup
//   node scripts/backup-storage.mjs --bucket documents
//   node scripts/backup-storage.mjs --full           → re-download everything
//
// Incremental by default: a file already on disk with the same byte size is
// left alone, so a nightly run costs almost nothing and a resumed run after a
// dropped connection picks up where it stopped.
//
// NEEDS THE SERVICE ROLE KEY. Storage objects are behind RLS and the
// publishable key sees almost nothing — a backup taken with it would look
// like it worked and contain a fraction of the files. Put the key in
// .env.scripts (gitignored) as SUPABASE_SERVICE_ROLE_KEY. It is a full
// bypass-everything credential: never commit it, never paste it into a chat,
// and keep the backup folder somewhere only you can read.
// =============================================================

import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Same precedence as scripts/_lib.mjs: real env, then .env.scripts, then .env.
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

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL). Set it in .env or .env.scripts.');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  console.error('');
  console.error('Get it from: Supabase dashboard → Settings → API → service_role key');
  console.error('Then add this line to .env.scripts at the project root (gitignored):');
  console.error('');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=eyJ...');
  console.error('');
  console.error('The publishable key will NOT do — it cannot see most objects, and the');
  console.error('backup would silently come out almost empty.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--bucket'));

const DEST = path.resolve(positional[0] || path.join(ROOT, 'backups', 'storage'));
const ONLY_BUCKET = flagValue('bucket');
const FULL = flag('full');
const CONCURRENCY = 4;   // gentle: the same project also serves the live portal

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function api(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Every object under a prefix, recursing into folders. */
async function listAll(bucket, prefix = '') {
  const out = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await api(`/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;

    for (const entry of page) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder is returned as a name with no id — recurse rather than try to
      // download it, which is how a naive backup ends up with 0-byte files
      // named after directories.
      if (entry.id === null || entry.id === undefined) out.push(...await listAll(bucket, full));
      else out.push({ path: full, size: entry.metadata?.size ?? null, updated: entry.updated_at ?? null });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/** Windows will not accept these in a filename; keep the mapping reversible-ish. */
const safeSegment = (s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '_');

async function downloadOne(bucket, obj, destRoot) {
  const localPath = path.join(destRoot, bucket, ...obj.path.split('/').map(safeSegment));

  if (!FULL && existsSync(localPath) && obj.size != null) {
    if (statSync(localPath).size === obj.size) return 'skipped';
  }

  const res = await api(`/object/${encodeURIComponent(bucket)}/${obj.path.split('/').map(encodeURIComponent).join('/')}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(path.dirname(localPath), { recursive: true });
  writeFileSync(localPath, bytes);
  return 'downloaded';
}

/** Run tasks with a fixed number in flight. */
async function pool(items, worker, limit) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// Wrapped in main() so failures can set process.exitCode and return, letting
// Node close its sockets and exit on its own. Calling process.exit() while
// fetch's keep-alive connections are still open trips a libuv assertion on
// Windows and reports 127 — which a scheduled task reads as "command not
// found" rather than "the backup failed".
async function main() {
const started = new Date();
console.log(`Storage backup → ${DEST}`);
console.log(`Project: ${SUPABASE_URL}`);
console.log(FULL ? 'Mode: full re-download' : 'Mode: incremental (same-size files skipped)');
console.log('');

const bucketsRes = await api('/bucket');
let buckets = (await bucketsRes.json()).map(b => b.name);

// No buckets is never a legitimate result here: this project has them. It
// means the key cannot see them — the publishable key returns an empty list
// rather than an error, which would otherwise end in a cheerful "backup
// complete" over an empty folder, discovered on the day it is needed.
if (buckets.length === 0) {
  console.error('No buckets are visible to this key.');
  console.error('That is what the publishable key looks like here — it returns an empty');
  console.error('list rather than an error. Check SUPABASE_SERVICE_ROLE_KEY is the');
  console.error('service_role key from Settings → API.');
  process.exitCode = 1;
  return;
}
if (ONLY_BUCKET) {
  if (!buckets.includes(ONLY_BUCKET)) {
    console.error(`No such bucket "${ONLY_BUCKET}". Found: ${buckets.join(', ') || '(none)'}`);
    process.exitCode = 1;
    return;
  }
  buckets = [ONLY_BUCKET];
}
console.log(`Buckets: ${buckets.join(', ') || '(none)'}\n`);

const summary = [];
const failures = [];

for (const bucket of buckets) {
  process.stdout.write(`${bucket}: listing… `);
  let objects;
  try {
    objects = await listAll(bucket);
  } catch (e) {
    console.log(`FAILED (${e.message})`);
    failures.push({ bucket, path: '(listing)', error: e.message });
    continue;
  }
  const totalBytes = objects.reduce((n, o) => n + (o.size || 0), 0);
  console.log(`${objects.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  let downloaded = 0, skipped = 0, done = 0;
  await pool(objects, async (obj) => {
    try {
      const result = await downloadOne(bucket, obj, DEST);
      result === 'skipped' ? skipped++ : downloaded++;
    } catch (e) {
      // One bad object must not abandon the other nine hundred.
      failures.push({ bucket, path: obj.path, error: e.message });
    }
    if (++done % 25 === 0 || done === objects.length) {
      process.stdout.write(`\r  ${done}/${objects.length}  (${downloaded} new, ${skipped} unchanged)   `);
    }
  }, CONCURRENCY);

  if (objects.length) process.stdout.write('\n');
  summary.push({ bucket, files: objects.length, bytes: totalBytes, downloaded, skipped });
}

const manifest = {
  project: SUPABASE_URL,
  started: started.toISOString(),
  finished: new Date().toISOString(),
  destination: DEST,
  mode: FULL ? 'full' : 'incremental',
  buckets: summary,
  failures,
};
mkdirSync(DEST, { recursive: true });
writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('');
for (const s of summary) {
  console.log(`  ${s.bucket}: ${s.files} file(s), ${(s.bytes / 1024 / 1024).toFixed(1)} MB — ${s.downloaded} downloaded, ${s.skipped} unchanged`);
}
console.log(`\nManifest: ${path.join(DEST, 'manifest.json')}`);

if (failures.length) {
  console.error(`\n⚠ ${failures.length} file(s) failed:`);
  for (const f of failures.slice(0, 10)) console.error(`   ${f.bucket}/${f.path} — ${f.error}`);
  if (failures.length > 10) console.error(`   …and ${failures.length - 10} more (see manifest.json)`);
  console.error('\nRe-run to retry only the missing ones.');
  process.exitCode = 1;   // so a scheduled task reports failure instead of looking fine
  return;
}
console.log('\n✓ Backup complete.');
}

await main();
