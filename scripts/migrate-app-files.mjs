// =============================================================
// migrate-app-files.mjs — lift embedded base64 files out of client_app_data
// =============================================================
// The rentals app stored uploaded contracts as base64 dataUrls inside its own
// JSON document. Greson Easy Loo's document reached 23 MB and PostgREST began
// returning 500 on both reads and writes — saving stopped working entirely.
// Migration 184 adds the client-app-files bucket; this moves what is already
// there into it and leaves a reference behind.
//
// ONE FILE AT A TIME, ON PURPOSE. The whole document cannot be fetched — that
// is the very request that 500s. So the helper RPCs installed alongside this
// script read and rewrite a single agreement per call (~2 MB), which the REST
// layer handles comfortably. Nothing ever loads all 23 MB at once.
//
// SAFE TO RE-RUN. The listing only returns agreements that still carry a
// dataUrl, so a second run finds nothing left to do. A file is uploaded first
// and the document rewritten only after that upload succeeded, so an
// interruption leaves an orphaned object in Storage — never a document row
// pointing at a file that does not exist.
//
//   node scripts/migrate-app-files.mjs --client 1771 --app rentals [--dry-run]
//
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.scripts (gitignored).
// =============================================================

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
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
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set them in .env.scripts).');
  process.exit(1);
}

const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const CLIENT_ID = Number(argOf('--client', ''));
const APP_KEY = argOf('--app', 'rentals');
const DRY = argv.includes('--dry-run');
const BUCKET = 'client-app-files';

if (!CLIENT_ID) {
  console.error('Usage: node scripts/migrate-app-files.mjs --client <id> --app <key> [--dry-run]');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MB = (n) => (n / 1048576).toFixed(2) + ' MB';

// data:application/pdf;base64,JVBER... → { mime, bytes }
function decodeDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  const head = comma >= 0 ? s.slice(0, comma) : '';
  const mime = (/^data:([^;,]+)/.exec(head) || [, 'application/octet-stream'])[1];
  const raw = comma >= 0 ? s.slice(comma + 1) : s;
  return { mime, bytes: Buffer.from(raw.replace(/\s/g, ''), 'base64') };
}

function extFor(name, mime) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  if (m) return '.' + m[1].toLowerCase();
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  return '';
}

// Wrapped rather than run at top level so the script can finish by returning.
// Calling process.exit() while the Supabase client still holds sockets trips a
// libuv assertion on Windows — alarming output for a script whose whole job is
// to move production files around.
await main();

async function main() {
const { data: rows, error: listErr } = await db.rpc('_appfiles_list', {
  p_client: CLIENT_ID, p_app: APP_KEY,
});
if (listErr) {
  console.error('Could not list embedded files:', listErr.message);
  console.error('Are the helper RPCs installed? See the block at the end of this file.');
  process.exitCode = 1; return;
}
if (!rows?.length) {
  console.log('Nothing to migrate — no agreements still carry a dataUrl.');
  return;
}

const total = rows.reduce((n, r) => n + Number(r.bytes || 0), 0);
console.log(`${rows.length} embedded file(s), ${MB(total)} of base64, client ${CLIENT_ID} / ${APP_KEY}`);
if (DRY) {
  for (const r of rows) console.log(`  would move: ${r.name} (${MB(Number(r.bytes || 0))})`);
  console.log('\nDry run — nothing changed.');
  return;
}

let moved = 0, movedBytes = 0, failed = 0;

for (const r of rows) {
  const label = `${r.name || 'file'} [tenant ${r.tenant_idx}, agreement ${r.agr_idx}]`;
  try {
    const { data: dataUrl, error: getErr } = await db.rpc('_appfiles_get', {
      p_client: CLIENT_ID, p_app: APP_KEY, p_t: r.tenant_idx, p_a: r.agr_idx,
    });
    if (getErr) throw new Error(getErr.message);
    if (!dataUrl) { console.log(`  skip  ${label} — no dataUrl (already moved?)`); continue; }

    const { mime, bytes } = decodeDataUrl(dataUrl);
    if (!bytes.length) throw new Error('decoded to zero bytes');

    const objectPath = `${CLIENT_ID}/${APP_KEY}/${crypto.randomUUID()}${extFor(r.name, mime)}`;
    const { error: upErr } = await db.storage.from(BUCKET)
      .upload(objectPath, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    // Only now is the document rewritten — the file is already safely stored.
    const { error: setErr } = await db.rpc('_appfiles_setref', {
      p_client: CLIENT_ID, p_app: APP_KEY, p_t: r.tenant_idx, p_a: r.agr_idx,
      p_path: objectPath, p_size: bytes.length, p_mime: mime,
    });
    if (setErr) throw new Error(`rewrite: ${setErr.message} (file is at ${objectPath})`);

    moved++; movedBytes += bytes.length;
    console.log(`  moved ${label} → ${objectPath} (${MB(bytes.length)})`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${label}: ${e.message}`);
  }
}

console.log(`\nMoved ${moved} file(s), ${MB(movedBytes)}. ${failed ? failed + ' failed.' : 'No failures.'}`);
console.log('Check the document size with:');
console.log(`  select pg_size_pretty(octet_length(data::text)::bigint) from public.client_app_data`);
console.log(`   where client_id = ${CLIENT_ID} and app_key = '${APP_KEY}';`);
if (failed) process.exitCode = 1;
}

// =============================================================
// Helper RPCs this script needs (install before running, drop after).
// They exist only so a single agreement can be read and rewritten without
// fetching the whole document — which is the request that currently 500s.
//
// create or replace function public._appfiles_list(p_client bigint, p_app text)
// returns table(tenant_idx int, agr_idx int, name text, bytes int)
// language sql security definer set search_path = public as $$
//   select (t.ord - 1)::int, (a.ord - 1)::int,
//          a.value->>'name',
//          octet_length(coalesce(a.value->>'dataUrl', ''))
//     from public.client_app_data d,
//          lateral jsonb_array_elements(d.data->'tenants') with ordinality t(value, ord),
//          lateral jsonb_array_elements(coalesce(t.value->'agreements', '[]'::jsonb)) with ordinality a(value, ord)
//    where d.client_id = p_client and d.app_key = p_app and a.value ? 'dataUrl';
// $$;
//
// create or replace function public._appfiles_get(p_client bigint, p_app text, p_t int, p_a int)
// returns text language sql security definer set search_path = public as $$
//   select d.data->'tenants'->p_t->'agreements'->p_a->>'dataUrl'
//     from public.client_app_data d
//    where d.client_id = p_client and d.app_key = p_app;
// $$;
//
// create or replace function public._appfiles_setref(
//   p_client bigint, p_app text, p_t int, p_a int, p_path text, p_size bigint, p_mime text)
// returns void language sql security definer set search_path = public as $$
//   update public.client_app_data d
//      set data = jsonb_set(d.data, array['tenants', p_t::text, 'agreements', p_a::text],
//                 ((d.data->'tenants'->p_t->'agreements'->p_a) - 'dataUrl')
//                 || jsonb_build_object('path', p_path, 'size', p_size, 'mime', p_mime))
//    where d.client_id = p_client and d.app_key = p_app;
// $$;
//
// Afterwards:
//   drop function if exists public._appfiles_list(bigint, text);
//   drop function if exists public._appfiles_get(bigint, text, int, int);
//   drop function if exists public._appfiles_setref(bigint, text, int, int, text, bigint, text);
// =============================================================
