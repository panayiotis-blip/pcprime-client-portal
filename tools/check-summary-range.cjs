/* FIX-3 §5. The shipped renderSummary, against a ledger whose arithmetic can be
   done in the head: the percentages switch changes the column count and nothing
   else, and the total column is the total of the MONTHS SHOWN under a heading
   that says which they are. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('public/reporting-app.js', 'utf8');
const store = fs.readFileSync('src/reporting/lib/reports/packStore.ts', 'utf8');

let bad = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) bad++;
  console.log((good ? '  ok   ' : '  FAIL ') + label
    + (good ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
};

// The default the frame falls back to and the default the host stores have to
// agree, or a client with no decision sees one thing and saves another.
const hostDefault = /summaryPercent: \{ on: (true|false)/.exec(store);
const appDefault = /return k==="summaryPercent"\?([01]):0;/.exec(src);
ok('the frame and the host agree on the default',
   appDefault && appDefault[1] === '1', hostDefault && hostDefault[1] === 'true');

function grab(name) {
  const open = 'function ' + name + '(';
  const a = src.indexOf(open);
  if (a < 0) throw new Error(name + ' not found');
  const b = src.indexOf('\n}\n', a + open.length);
  return src.slice(a, b < 0 ? src.length : b + 3);
}

// 2026 runs to July only; 2025 is a full year. Revenue is 100 a month in 2025
// and 120 in 2026, cost of sales 40 and 48.
const M = [];
for (let m = 1; m <= 12; m++) M.push('2025-' + String(m).padStart(2, '0'));
for (let m = 1; m <= 7; m++) M.push('2026-' + String(m).padStart(2, '0'));
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const per = (base, step) => M.map((m) => base + step * (+m.slice(0, 4) - 2025));
const SERIES = { 'P-100': per(100, 20), 'P-200': per(40, 8), 'P-400': per(7, 0) };

const html = {};
const sel = {};
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; },
  set textContent(v) { html[id] = v; },
  get textContent() { return html[id] || ''; },
  get value() { return sel[id] === undefined ? '' : sel[id]; },
  set value(v) { sel[id] = v; },
  className: '', addEventListener() {},
});
const ctx = {
  console, M, NM: M.length, MN: MON,
  D: { cfg: { pack: { summaryPercent: 1 } } },
  LI: { 'P-100': { name: 'Sales' }, 'P-200': { name: 'Purchases' }, 'P-400': { name: 'Admin' } },
  REV: ['P-100'], COS: ['P-200'], SD: [], ADM: ['P-400'], FIN: [], OI: [],
  PL: (id) => SERIES[id] || M.map(() => 0),
  idx: (m) => M.indexOf(m),
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(v).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  notes: () => {},
  document: { getElementById: node },
};
vm.createContext(ctx);
const pre = src.slice(src.indexOf("/* Whether this client's pack prints"), src.indexOf('function renderSummary('));
vm.runInContext([pre, grab('renderSummary')].join('\n'), ctx);

const headRow = (n) => {
  const rows = (html['tblSummary'] || '').match(/<tr>[\s\S]*?<\/tr>/g) || [];
  const all = (html['tblSummary'] || '').split('</thead>')[0];
  return ((all.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [])[n] || '')
    .match(/<th[^>]*>(.*?)<\/th>/g) || [];
};
const heads = (n) => headRow(n).map((x) => x.replace(/<[^>]+>/g, ''));
const rowOf = (name) => {
  const m = (html['tblSummary'] || '').match(new RegExp('<tr[^>]*><td>' + name + '</td>(.*?)</tr>'));
  return m ? (m[1].match(/<td[^>]*>(.*?)<\/td>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')) : null;
};

// ---- a part year: the ledger stops in July -------------------------------
sel['sumYear'] = '2026';
ctx.renderSummary();
ok('only the months held are offered', sel['sumFrom'] + '..' + sel['sumTo'], '2026-01..2026-07');
ok('the total column is named for the months shown', heads(0).slice(-1), ['Jan–Jul']);
// seven months at 120
ok('and totals them', rowOf('Sales').slice(-2), ['840', '100.0%']);
ok('the note says what is shown', html['sumWhat'],
   'Jan–Jul 2026 — 7 months, and the total column is those months.');

// ---- §5b: a chosen range ------------------------------------------------
sel['sumFrom'] = '2026-03'; sel['sumTo'] = '2026-05';
ctx.renderSummary();
ok('three months across', heads(0).length, 1 + 3 + 1);
ok('headed for those months', heads(0).slice(1), ['Mar', 'Apr', 'May', 'Mar–May']);
ok('and the total is those three, not the year', rowOf('Sales').slice(-2), ['360', '100.0%']);

// From after To is not a range: To follows.
sel['sumFrom'] = '2026-06'; sel['sumTo'] = '2026-02';
ctx.renderSummary();
ok('from after to is corrected, not left showing nothing', sel['sumTo'], '2026-06');
ok('and shows that one month', rowOf('Sales').slice(-2), ['120', '100.0%']);

// ---- §5a: the percentages switch ----------------------------------------
sel['sumFrom'] = '2026-01'; sel['sumTo'] = '2026-07';
ctx.D.cfg.pack = { summaryPercent: 0 };
ctx.renderSummary();
ok('with percentages off a month is one column', heads(0).length, 1 + 7 + 1);
ok('the EUR/% second row loses its % too', heads(1), Array(8).fill('EUR'));
ok('and the figures are unchanged', rowOf('Sales').slice(-1), ['840']);
ok('the button says which way it is', html['sumPct'], 'Percentages off');
ctx.D.cfg.pack = { summaryPercent: 1 };
ctx.renderSummary();
ok('back on, two columns a month', heads(0).length, 1 + 7 + 1);
ok('and the button says so', html['sumPct'], 'Percentages on');

// ---- a block cached before the choice existed ----------------------------
delete ctx.D.cfg.pack;
ctx.renderSummary();
ok('no pack at all falls back to what the summary always did', html['sumPct'], 'Percentages on');

// ---- a full year keeps its name -----------------------------------------
sel['sumYear'] = '2025'; sel['sumFrom'] = ''; sel['sumTo'] = '';
ctx.renderSummary();
ok('a full year is still called Year', heads(0).slice(-1), ['Year']);
ok('and says so plainly', html['sumWhat'], 'Every month of 2025.');
ok('twelve months at 100', rowOf('Sales').slice(-2), ['1.200', '100.0%']);

// ---- a year with nothing in it ------------------------------------------
sel['sumYear'] = '2024'; sel['sumFrom'] = ''; sel['sumTo'] = '';
ctx.renderSummary();
ok('a year with no postings says so rather than drawing an empty table',
   /Nothing is posted in 2024/.test(html['tblSummary']), true);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
