// Static audit of the TaxisNet field map against the official schemas.
//
// The export-time validator only fires when someone clicks Export, so a key
// that the Ministry's schema would reject can sit in the map unnoticed. This
// checks every key the map can emit, up front:
//
//   1. does the key exist in the official enumeration (keys XSD)?
//   2. does every grid id exist?
//   3. which of our keys appear in the real sample filings, and with what
//      value shape (money/date formats we must match)?
//
// Run: node scripts/audit-taxisnet-map.mjs
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const XSD = path.join(ROOT, 'supabase', 'xsd-tep-ext-2024');

// ---- official keys, straight from the XSDs -------------------------------
function enumsFrom(file) {
  const xml = readFileSync(file, 'utf8');
  return new Set([...xml.matchAll(/<xsd:enumeration\s+value="([^"]+)"/g)].map((m) => m[1]));
}
const official = {
  epr1m: enumsFrom(path.join(XSD, 'epr1m_2024', 'cy-epr1m-2024-keys.xsd')),
  epr1a: enumsFrom(path.join(XSD, 'epr1a_2024', 'cy-epr1a-2024-keys.xsd')),
};

// ---- our map, parsed from the TS source (no build step needed) -----------
const src = readFileSync(path.join(ROOT, 'src', 'services', 'taxisnet', 'fieldMap.ts'), 'utf8');

// Split the file into the two form blocks so keys are attributed correctly.
const cut = src.indexOf('const EPR1A');
const blocks = { epr1m: src.slice(0, cut), epr1a: src.slice(cut) };

const mapped = { epr1m: [], epr1a: [] };
for (const [form, block] of Object.entries(blocks)) {
  // Flat entries: { key: 'x', source: 'y', ..., confidence: 'z' }
  for (const m of block.matchAll(/\{\s*key:\s*'([^']+)'[^}]*?confidence:\s*'(\w+)'/g)) {
    mapped[form].push({ key: m[1], kind: 'flat', confidence: m[2] });
  }
  // Grids: gridId then its columns.
  for (const g of block.matchAll(/gridId:\s*'([^']+)'[\s\S]*?cols:\s*\[([\s\S]*?)\]/g)) {
    const gridId = g[1];
    for (const c of g[2].matchAll(/col:\s*'([^']+)'[^}]*?field:\s*'([^']+)'[^}]*?confidence:\s*'(\w+)'/g)) {
      mapped[form].push({ key: gridId + c[1], kind: 'grid', gridId, field: c[2], confidence: c[3] });
    }
  }
  // The Part 1 T.I.C. key.
  const t = block.match(/ticFieldKey:\s*'([^']+)'/);
  if (t) mapped[form].push({ key: t[1], kind: 'flat', confidence: 'confirmed' });
}

// ---- real filings, for cross-reference ------------------------------------
const sampleKeys = new Map(); // key -> example value shape
const sampleDir = path.join(XSD, 'Samples');
for (const f of readdirSync(sampleDir).filter((n) => n.endsWith('.xml'))) {
  const xml = readFileSync(path.join(sampleDir, f), 'utf8');
  for (const m of xml.matchAll(/key="([^"]+)"\s*>([^<]*)</g)) {
    if (!sampleKeys.has(m[1])) sampleKeys.set(m[1], m[2]);
  }
}

// ---- report ---------------------------------------------------------------
let bad = 0, unconfirmed = 0, inSample = 0;
for (const form of ['epr1m', 'epr1a']) {
  const rows = mapped[form];
  console.log(`\n=== ${form} — ${rows.length} mapped keys ===`);
  const missing = rows.filter((r) => !official[form].has(r.key));
  if (missing.length) {
    bad += missing.length;
    console.log(`  ✗ NOT IN OFFICIAL SCHEMA (${missing.length}) — TaxisNet would reject these:`);
    for (const r of missing) console.log(`      ${r.key}${r.field ? '  (' + r.field + ')' : ''}  [${r.confidence}]`);
  } else {
    console.log('  ✓ every mapped key exists in the official enumeration');
  }
  const seen = rows.filter((r) => sampleKeys.has(r.key));
  inSample += seen.length;
  console.log(`  · appear in a real sample filing: ${seen.length}/${rows.length}`);
  for (const r of seen) console.log(`      ${r.key} = ${JSON.stringify(sampleKeys.get(r.key))}  [${r.confidence}]`);
  const inf = rows.filter((r) => r.confidence === 'inferred');
  unconfirmed += inf.length;
  console.log(`  · still inferred: ${inf.length}`);
}

// Value shapes in the real filings — what our formatters must produce.
const shapes = { money: new Set(), date: new Set(), other: new Set() };
for (const [, v] of sampleKeys) {
  if (/^-?\d+,\d+$/.test(v)) shapes.money.add('comma decimal e.g. ' + v);
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) shapes.date.add('d/m/yyyy e.g. ' + v);
}
console.log('\n=== value shapes seen in real filings ===');
console.log('  money:', [...shapes.money].slice(0, 2).join(' | ') || '(none)');
console.log('  dates:', [...shapes.date].slice(0, 2).join(' | ') || '(none)');
console.log(`\nSUMMARY: ${bad} invalid key(s), ${unconfirmed} still inferred, ${inSample} corroborated by a real filing.`);
process.exit(bad ? 1 : 0);
