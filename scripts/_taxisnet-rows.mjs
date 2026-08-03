// Dump a sample filing's grid rows intact, so columns can be read across a
// single row (first-value-per-key mixes rows and invites wrong conclusions).
import { readFileSync } from 'node:fs';

const [file, want] = process.argv.slice(2);
const xml = readFileSync(file, 'utf8');
for (const g of xml.matchAll(/<mof:grid id="([^"]+)">([\s\S]*?)<\/mof:grid>/g)) {
  const id = g[1];
  if (want && !id.includes(want)) continue;
  console.log(`\n=== grid ${id} ===`);
  for (const r of g[2].matchAll(/<mof:row number="(\d+)">([\s\S]*?)<\/mof:row>/g)) {
    const cells = [...r[2].matchAll(/key="([^"]+)"\s*>([^<]*)</g)]
      .map((m) => m[1].replace(id, '') + '=' + m[2]);
    console.log(`  row ${r[1]}: ` + cells.join('  '));
  }
}
