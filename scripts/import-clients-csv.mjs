// One-time import: clients_import.csv → public.clients
//
// Maps:
//   name      → name
//   tic       → tax_number
//   category  → business_type
//   status    → status   (normalized to: active | inactive | deceased)
//   comments  → kyc_notes  (no `notes` column exists on clients)
//   section   → ignored (per task scope)
//
// Skips rows whose tax_number already exists in public.clients.
// Rows with empty tax_number are inserted (cannot dedupe without a key).
//
// Usage:
//   node scripts/import-clients-csv.mjs                       # creds from .env.scripts
//   node scripts/import-clients-csv.mjs <email> <password>    # creds via CLI args
//   node scripts/import-clients-csv.mjs --dry-run             # parse + dedupe check, no inserts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase, signInAsAdmin } from './_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'clients_import.csv');

const dryRun = process.argv.includes('--dry-run');

// ---------- minimal CSV parser (handles quoted fields, commas, "" escape, CRLF) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const normalizeStatus = (s) => {
  const v = (s || '').trim().toLowerCase();
  if (v === 'active' || v === 'inactive' || v === 'deceased') return v;
  return 'active'; // safe default for unknown values
};

const clean = (v) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

// ---------- read & parse CSV ----------
const raw = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const allRows = parseCsv(raw).filter(r => r.some(c => c && c.trim() !== ''));
const header = allRows.shift().map(h => h.trim().toLowerCase());
const idx = (name) => header.indexOf(name);
const iName = idx('name');
const iTic = idx('tic');
const iCategory = idx('category');
const iStatus = idx('status');
const iComments = idx('comments');
if ([iName, iTic, iCategory, iStatus, iComments].some(x => x === -1)) {
  console.error('CSV header missing expected columns. Got:', header);
  process.exit(1);
}

const records = allRows.map(r => ({
  name: clean(r[iName]),
  tax_number: clean(r[iTic]),
  business_type: clean(r[iCategory]),
  status: normalizeStatus(r[iStatus]),
  kyc_notes: clean(r[iComments]),
}));

console.log(`--- Client CSV Import ---`);
console.log(`CSV:    ${CSV_PATH}`);
console.log(`Rows:   ${records.length}`);
console.log(`Mode:   ${dryRun ? 'DRY RUN (no inserts)' : 'LIVE'}`);
console.log('');

const skippedNoName = records.filter(r => !r.name);
if (skippedNoName.length) {
  console.log(`! ${skippedNoName.length} row(s) have no name and will be skipped.`);
}
const validRecords = records.filter(r => r.name);

// ---------- Supabase ----------
const { email } = await signInAsAdmin();
console.log(`✓ Signed in as ${email}.`);

// Fetch existing tax_numbers to dedupe.
const { data: existing, error: existingErr } = await sb
  .from('clients')
  .select('tax_number')
  .not('tax_number', 'is', null);
if (existingErr) {
  console.error('✗ Could not read existing clients:', existingErr.message);
  process.exit(1);
}
const existingTaxNumbers = new Set(
  existing.map(r => r.tax_number).filter(Boolean).map(t => t.trim().toUpperCase())
);
console.log(`✓ Existing clients with tax_number in DB: ${existingTaxNumbers.size}`);

// Also dedupe within the CSV itself (in case a tin appears twice).
const seenInCsv = new Set();
const toInsert = [];
const dupesCsv = [];
const dupesDb = [];
for (const r of validRecords) {
  const key = r.tax_number ? r.tax_number.toUpperCase() : null;
  if (key && existingTaxNumbers.has(key)) { dupesDb.push(r); continue; }
  if (key && seenInCsv.has(key))           { dupesCsv.push(r); continue; }
  if (key) seenInCsv.add(key);
  toInsert.push(r);
}

console.log('');
console.log(`Summary before insert:`);
console.log(`  Valid rows:                 ${validRecords.length}`);
console.log(`  Duplicates already in DB:   ${dupesDb.length}`);
console.log(`  Duplicates within CSV:      ${dupesCsv.length}`);
console.log(`  To insert:                  ${toInsert.length}`);
console.log('');

if (dryRun) {
  console.log('DRY RUN — no inserts performed.');
  console.log('Sample of first 3 to-insert rows:');
  console.log(JSON.stringify(toInsert.slice(0, 3), null, 2));
  process.exit(0);
}

// Insert in chunks to keep payload small.
const CHUNK = 50;
let inserted = 0;
const failures = [];
for (let i = 0; i < toInsert.length; i += CHUNK) {
  const batch = toInsert.slice(i, i + CHUNK);
  const { data, error } = await supabase.from('clients').insert(batch).select('id');
  if (error) {
    console.error(`✗ Batch ${i / CHUNK + 1} failed:`, error.message);
    failures.push({ start: i, size: batch.length, error: error.message });
    continue;
  }
  inserted += (data?.length ?? batch.length);
  process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
}
process.stdout.write('\n');

console.log('');
console.log('--- Import complete ---');
console.log(`Inserted:                ${inserted}`);
console.log(`Skipped (DB duplicates): ${dupesDb.length}`);
console.log(`Skipped (CSV duplicates):${dupesCsv.length}`);
console.log(`Skipped (no name):       ${skippedNoName.length}`);
if (failures.length) {
  console.log(`Failed batches:          ${failures.length}`);
  for (const f of failures) console.log(`  - rows ${f.start}..${f.start + f.size - 1}: ${f.error}`);
}
