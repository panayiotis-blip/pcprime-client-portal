// Read-only diag: check the folders table for duplicates and the unique index.
import { supabase, signInAsAdmin } from './_lib.mjs';

await signInAsAdmin();

console.log('--- Folders diagnostic ---');

// Pull every folder for inspection
const { data: folders, error } = await supabase
  .from('folders')
  .select('id, client_id, parent_id, name, category_key, is_system')
  .order('client_id', { ascending: true })
  .order('id', { ascending: true });

if (error) { console.error('✗ read failed:', error.message); process.exit(1); }
console.log(`Total folders: ${folders.length}`);

// Group by (client_id, category_key) for is_system=true
const sysGroups = new Map();
for (const f of folders) {
  if (!f.is_system) continue;
  const key = `${f.client_id}|${f.category_key}`;
  if (!sysGroups.has(key)) sysGroups.set(key, []);
  sysGroups.get(key).push(f);
}

let sysDupeCount = 0;
const sysDupes = [];
for (const [key, rows] of sysGroups.entries()) {
  if (rows.length > 1) {
    sysDupeCount += rows.length - 1;
    sysDupes.push({ key, count: rows.length, ids: rows.map(r => r.id) });
  }
}

console.log(`\nSystem-folder duplicate keys (client_id|category_key with >1 row):`);
if (sysDupes.length === 0) {
  console.log('  ✓ none — system folder uniqueness is intact');
} else {
  console.log(`  ✗ ${sysDupes.length} duplicate keys, ${sysDupeCount} extra rows`);
  for (const d of sysDupes.slice(0, 10)) {
    console.log(`    [${d.key}]  ${d.count} rows  ids=${d.ids.join(',')}`);
  }
  if (sysDupes.length > 10) console.log(`    ... and ${sysDupes.length - 10} more`);
}

// Group user folders by (client_id, parent_id, name)
const userGroups = new Map();
for (const f of folders) {
  if (f.is_system) continue;
  const key = `${f.client_id}|${f.parent_id ?? 'root'}|${(f.name || '').toLowerCase()}`;
  if (!userGroups.has(key)) userGroups.set(key, []);
  userGroups.get(key).push(f);
}

let userDupeCount = 0;
const userDupes = [];
for (const [key, rows] of userGroups.entries()) {
  if (rows.length > 1) {
    userDupeCount += rows.length - 1;
    userDupes.push({ key, count: rows.length, ids: rows.map(r => r.id) });
  }
}

console.log(`\nUser-folder duplicates (same client + parent + name, case-insensitive):`);
if (userDupes.length === 0) {
  console.log('  ✓ none');
} else {
  console.log(`  ⚠ ${userDupes.length} duplicate keys, ${userDupeCount} extra rows`);
  for (const d of userDupes.slice(0, 10)) {
    console.log(`    [${d.key}]  ${d.count} rows  ids=${d.ids.join(',')}`);
  }
  if (userDupes.length > 10) console.log(`    ... and ${userDupes.length - 10} more`);
}

// Per-client total folder count — flag anyone with way more than expected
const SYSTEM_KEYS = ['kyc','contracts','agreements','company_records','audited_accounts','scanned','issued_invoices','other',
                     'scanned_INP','scanned_INS','scanned_PM','scanned_DEP','scanned_JV'];
console.log(`\nExpected default system-folder count per client: ${SYSTEM_KEYS.length}`);

const perClient = new Map();
for (const f of folders) {
  perClient.set(f.client_id, (perClient.get(f.client_id) || 0) + 1);
}

const sorted = [...perClient.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nTop 10 clients by folder count:`);
for (const [cid, n] of sorted.slice(0, 10)) {
  console.log(`  client_id=${cid}: ${n} folders`);
}

// Verify unique index exists (we can only see this via a probe — try an insert that should violate)
console.log(`\nProbing unique index on (client_id, category_key) where is_system = true...`);
// Pick the first system folder to clone
const probe = folders.find(f => f.is_system);
if (!probe) {
  console.log('  (no system folders to probe with — skipping)');
} else {
  const { error: insErr } = await supabase.from('folders').insert({
    client_id: probe.client_id,
    name: '__diag_probe__',
    category_key: probe.category_key,
    is_system: true,
  });
  if (insErr) {
    if (/duplicate key|unique constraint|ux_folders_client_category_system/i.test(insErr.message)) {
      console.log('  ✓ unique index ENFORCED (probe insert was rejected)');
    } else {
      console.log(`  ? unexpected error: ${insErr.message}`);
    }
  } else {
    console.log('  ✗ probe insert SUCCEEDED — unique index is MISSING');
    // Clean up the probe row
    await supabase.from('folders').delete().eq('client_id', probe.client_id).eq('name', '__diag_probe__').eq('is_system', true);
    console.log('  (cleaned up probe row)');
  }
}

console.log('\n--- end diagnostic ---');
