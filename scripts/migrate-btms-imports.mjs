// =============================================================
// migrate-btms-imports.mjs — move the reporting app's own copies into the
// client's BTMS data folder, where the files were always meant to live
// =============================================================
// Migration 204 put a "BTMS data" folder on every client, in the portal's own
// folders/documents tables, under the private documents bucket. The reason is
// in that migration: the folder IS the client, so nothing is typed and nothing
// can be mistyped, it works from any machine, and it is backed up with
// everything else.
//
// The five importers were then written to upload somewhere else — a
// reporting-imports bucket of their own — so every file loaded so far went
// there and the client folders stayed empty. The code no longer does that.
// This moves what is already in the old bucket across.
//
// What it does, per object:
//   * works out the client and the kind from the path
//   * copies the bytes into the documents bucket, under <client>/btms/
//   * writes the public.documents row, in the client's BTMS data folder
//   * writes a reporting.btms_file_checks row so the folder can say what the
//     file is without opening it — verdict 'warning', because these files were
//     stored before the gate existed and were never put through it. Claiming
//     'ok' would be claiming a check that never ran.
//   * repoints reporting.imports.storage_path, and stock_valuations.file_path,
//     at the new location
//
// It does NOT delete anything: not the old objects, not the old bucket. The
// old copies stay until somebody looks and agrees they are redundant.
//
// SAFE TO RE-RUN. An object whose digest is already recorded against a
// document in that client's BTMS folder is skipped.
//
//   node scripts/migrate-btms-imports.mjs --dry-run
//   node scripts/migrate-btms-imports.mjs
//
// It signs in as the admin in .env.scripts rather than using the service role,
// because the reporting schema is granted to `authenticated` and to nobody
// else (migration 190). That is the better way round in any case: the move
// happens under the same access model as the application, so a file cannot
// land anywhere a person could not have put it.
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
    const quoted = (q) => v.startsWith(q) && v.endsWith(q) && v.length > 1;
    if (quoted('"') || quoted("'")) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env.scripts'));
loadEnvFile(path.join(ROOT, '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const ADMIN_EMAIL = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : process.env.SUPABASE_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3] : process.env.SUPABASE_ADMIN_PASSWORD || '';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (.env or .env.scripts).');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Admin credentials required: SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD');
  console.error('in .env.scripts, or passed as the first two arguments.');
  process.exit(1);
}

const DRY = process.argv.includes('--dry-run');
const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const rep = () => db.schema('reporting');

async function signIn() {
  const { data, error } = await db.auth.signInWithPassword({
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  if (error) { console.error('x Sign-in failed:', error.message); process.exit(1); }
  return data.user;
}

const OLD = 'reporting-imports';
const NEW = 'documents';

/** The kind a path says the file is. The old paths encode the feed. */
function kindOf(objectPath) {
  const p = objectPath.toLowerCase();
  if (p.includes('/ledger/')) return 'ledger';
  if (p.includes('/chart/')) return 'chart';
  if (p.includes('/trial-balance/')) return 'trial_balance';
  if (p.includes('/stock/')) return 'stock';
  if (p.includes('/payroll/')) {
    if (p.includes('/cost-analysis-')) return 'payroll_cost';
    if (p.includes('/paysheet-')) return 'payroll_sheet';
  }
  return 'unknown';
}

const safe = (name) => name.replace(/[^\w.\-]+/g, '_').slice(0, 120);

/** The same words checkFile.ts uses, for a file the old bucket never named. */
const KIND_LABEL = {
  ledger: 'Journal listing',
  chart: 'Chart of accounts',
  trial_balance: 'Trial balance',
  stock: 'Stock valuation',
  // No dash inside the label: the period is joined with one, and
  // "Payroll — paysheet — 2026-08" reads like a mistake.
  payroll_cost: 'Payroll cost analysis',
  payroll_sheet: 'Payroll paysheet',
};

/** Everything under a prefix, depth-first — the API lists one level at a time. */
async function listAll(prefix = '') {
  const { data, error } = await db.storage.from(OLD).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
  const out = [];
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A folder comes back with no id; a real object always has one.
    if (entry.id === null || entry.id === undefined) {
      out.push(...(await listAll(full)));
    } else {
      out.push({ path: full, size: entry.metadata?.size ?? null, createdAt: entry.created_at ?? null });
    }
  }
  return out;
}

/** Where each kind of report lives, as migration 215 arranges it. */
const SUBFOLDER = {
  ledger: ['btms_ledger', 'Journal listings'],
  detailed_ledger: ['btms_detail', 'Ledgers'],
  trial_balance: ['btms_tb', 'Trial balances'],
  chart: ['btms_coa', 'Chart of accounts'],
  vat_summary: ['btms_vat', 'VAT'],
  payroll_cost: ['btms_payroll', 'Payroll'],
  payroll_sheet: ['btms_payroll', 'Payroll'],
  stock: ['btms_stock', 'Stock'],
  bank_statement: ['btms_bank', 'Bank'],
  other: ['btms_other', 'Other'],
};

/** The client's BTMS data folder, made if it is not there yet. */
const folderCache = new Map();
async function findOrMake(clientId, key, name, parentId) {
  const cacheKey = `${clientId}:${key}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
  const found = await db.from('folders')
    .select('id').eq('client_id', clientId).eq('category_key', key)
    .order('id').limit(1);
  if (found.error) throw new Error(`folders: ${found.error.message}`);
  let id = found.data?.[0]?.id ?? null;
  if (!id) {
    if (DRY) return -1;
    const made = await db.from('folders').insert({
      client_id: clientId, parent_id: parentId, name, category_key: key, is_system: true,
    }).select('id').single();
    if (made.error) throw new Error(`folders insert: ${made.error.message}`);
    id = made.data.id;
  }
  folderCache.set(cacheKey, id);
  return id;
}

/**
 * The subfolder this report belongs in, with its parent made first.
 *
 * A file that landed in the parent would be in the right client and the wrong
 * place, which is the confusion the subfolders exist to end.
 */
async function btmsFolder(clientId, kind) {
  const parent = await findOrMake(clientId, 'btms', 'BTMS data', null);
  const sub = SUBFOLDER[kind];
  if (!sub || parent === -1) return parent;
  return findOrMake(clientId, sub[0], sub[1], parent);
}

const yearMonth = (period) => ({
  year: period ? String(period).slice(0, 4) : null,
  month: period && String(period).length >= 7 ? String(period).slice(5, 7) : null,
});

const NEVER_CHECKED =
  'Moved here from the reporting application’s own bucket. It was stored before ' +
  'the folder gate existed, so it was never checked against its own control totals.';

async function main() {
  console.log(DRY ? '— dry run: nothing will be written —\n' : '— migrating —\n');

  const me = await signIn();
  console.log(`signed in as ${ADMIN_EMAIL}\n`);

  const objects = await listAll();
  console.log(`${objects.length} object${objects.length === 1 ? '' : 's'} in ${OLD}\n`);
  if (!objects.length) return;

  // Every import row, so an object can be matched to what it was imported as.
  const imports = await rep().from('imports').select(
    'id, client_id, feed, storage_path, original_filename, checksum, period_from, ' +
    'period_to, months_covered, row_count, total_debit, total_credit, uploaded_by, status',
  );
  if (imports.error) throw new Error(`imports: ${imports.error.message}`);

  // One object can carry several import rows: a rejected attempt, a withdrawal,
  // and the one that stands. Keyed naively the LAST row wins, which for A&F's
  // chart of accounts is a rejected one — so the move would have described the
  // file by a failed attempt and repointed that row while the committed import
  // went on pointing at the old bucket. The committed row is the one whose
  // filename and period describe what is actually in the folder.
  const byPath = new Map();
  for (const i of imports.data ?? []) {
    const held = byPath.get(i.storage_path);
    if (!held || (held.status !== 'committed' && i.status === 'committed')) {
      byPath.set(i.storage_path, i);
    }
  }

  let moved = 0, skipped = 0, failed = 0;

  for (const obj of objects) {
    const clientId = Number(obj.path.split('/')[0]);
    const kind = kindOf(obj.path);
    const imp = byPath.get(obj.path) ?? null;

    // The paysheet is the one object with no import row of its own: payroll is
    // committed as a pair and the record names the cost analysis. Left alone it
    // would be the only file in the folder still called by its checksum, which
    // is the thing the derived names exist to end. Its period is its partner's,
    // and it is only borrowed where the pairing is unambiguous.
    let paired = null;
    if (!imp && kind === 'payroll_sheet') {
      const payrolls = (imports.data ?? []).filter(
        (i) => i.client_id === clientId && i.feed === 'payroll_calc' && i.status === 'committed',
      );
      if (payrolls.length === 1) paired = payrolls[0];
    }

    // A name from the type and the period, as portalFolder derives one, rather
    // than the checksum the old bucket named its objects by.
    const derived = () => {
      const p = paired?.period_to ?? paired?.period_from ?? null;
      const raw = obj.path.split('/').pop() ?? '';
      const dot = raw.lastIndexOf('.');
      const ext = dot > 0 ? raw.slice(dot) : '';
      const label = KIND_LABEL[kind] ?? 'BTMS export';
      return p ? `${label} — ${String(p).slice(0, 7)}${ext}` : `${label}${ext}`;
    };
    const fileName = imp?.original_filename ?? derived();

    if (!Number.isFinite(clientId)) {
      console.log(`  x ${obj.path} — no client in the path; left alone`);
      failed++;
      continue;
    }

    // The period, as the import recorded it. A journal listing covers a span.
    let period = null;
    const from = imp ?? paired;
    if (from) {
      const months = from.months_covered ?? [];
      period = kind === 'ledger' && months.length > 1
        ? `${months[0]} to ${months[months.length - 1]}`
        : (from.period_to ?? from.period_from ?? null);
    }
    const digest = imp?.checksum ?? null;

    // Already moved? The digest recorded against a document in this client's
    // folder is the same file, whatever it is called now.
    if (digest) {
      const seen = await rep().from('btms_file_checks')
        .select('document_id').eq('client_id', clientId).eq('digest', digest).limit(1);
      if (seen.error) throw new Error(`checks: ${seen.error.message}`);
      if (seen.data?.length) {
        console.log(`  . ${obj.path} — already in the folder`);
        skipped++;
        continue;
      }
    }

    const stamp = obj.createdAt ? Date.parse(obj.createdAt) : Date.now();
    const newPath = `${clientId}/btms/${stamp}_${safe(fileName)}`;
    const { year, month } = yearMonth(period);

    console.log(`  > ${obj.path}`);
    console.log(`      client ${clientId} · ${kind} · ${period ?? 'no period'} · as "${fileName}"`);
    console.log(`      to ${NEW}/${newPath}`);
    console.log(imp
      ? `      repoints import ${imp.id} (${imp.feed}, ${imp.status})`
      : '      no import row points at this object');

    if (DRY) { moved++; continue; }

    try {
      const dl = await db.storage.from(OLD).download(obj.path);
      if (dl.error || !dl.data) throw new Error(`download: ${dl.error?.message}`);
      const bytes = Buffer.from(await dl.data.arrayBuffer());

      const up = await db.storage.from(NEW).upload(newPath, bytes, {
        contentType: 'application/vnd.ms-excel',
        upsert: false,
      });
      if (up.error) throw new Error(`upload: ${up.error.message}`);

      const folderId = await btmsFolder(clientId, kind);
      const doc = await db.from('documents').insert({
        client_id: clientId,
        folder_id: folderId,
        doc_type: 'btms_export',
        category: 'btms',
        year,
        month,
        file_name: fileName,
        mime_type: 'application/vnd.ms-excel',
        storage_path: newPath,
        storage_bucket: NEW,
        // Whoever did the original import keeps their name on the file; only
        // where the old bucket knows of nobody does the mover sign for it.
        uploaded_by: imp?.uploaded_by ?? me?.id ?? null,
      }).select('id').single();
      if (doc.error) throw new Error(`documents: ${doc.error.message}`);

      const facts = {};
      if (imp?.row_count != null) facts.Rows = String(imp.row_count);
      if (imp?.total_debit != null) facts.Debits = String(imp.total_debit);
      if (imp?.total_credit != null) facts.Credits = String(imp.total_credit);

      const chk = await rep().from('btms_file_checks').insert({
        document_id: doc.data.id,
        client_id: clientId,
        kind,
        period,
        verdict: 'warning',
        problems: [],
        warnings: [NEVER_CHECKED],
        facts,
        digest,
      });
      if (chk.error) throw new Error(`btms_file_checks: ${chk.error.message}`);

      if (imp) {
        // Every row pointing at this object, not just the one that named it.
        // A rejected attempt and the committed import can share a path, and
        // leaving either of them pointing into a bucket that is being retired
        // is leaving a record that names a file nobody can find.
        const u = await rep().from('imports').update({ storage_path: newPath })
          .eq('client_id', clientId).eq('storage_path', obj.path);
        if (u.error) throw new Error(`imports update: ${u.error.message}`);
        const sv = await rep().from('stock_valuations')
          .update({ file_path: newPath }).eq('client_id', clientId).eq('file_path', obj.path);
        if (sv.error) throw new Error(`stock_valuations update: ${sv.error.message}`);
      }

      console.log('      moved');
      moved++;
    } catch (e) {
      console.log(`      x ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${moved} moved · ${skipped} already there · ${failed} failed`);
  if (!DRY && moved) {
    console.log(
      `\nThe old objects are still in ${OLD}. Nothing deletes them; that is a` +
      '\nseparate decision, once somebody has looked at the client folders.',
    );
  }
}

main().catch((e) => {
  console.error('\nx', e.message);
  process.exit(1);
});
