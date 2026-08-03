// Pull the text out of a PDF page range using the pdfjs already in the repo.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

const [file, from = '1', to = '999'] = process.argv.slice(2);
const data = new Uint8Array(readFileSync(file));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
console.log('PAGES:', doc.numPages);
const lo = Math.max(1, +from), hi = Math.min(doc.numPages, +to);
for (let p = lo; p <= hi; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  // Group items into lines by y position so table rows stay readable.
  const lines = new Map();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const key = Math.round(y / 4) * 4;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x: it.transform[4], s: it.str });
  }
  const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  console.log(`\n───── page ${p} ─────`);
  console.log(ordered.join('\n'));
}
