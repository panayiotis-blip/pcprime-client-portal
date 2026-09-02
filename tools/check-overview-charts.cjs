/* FIX-3 §4. Two things:
   1. OVCHARTS in the built app and CHARTS in chartStore.ts are the same list
      written twice — one in the frame, one in the host that saves the choice.
      They cannot be one list without shipping a module into a blob, so this
      fails if they drift apart.
   2. The shipped renderOverview draws what the client was given and nothing
      else, and the month row says what the month did. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('public/reporting-app.js', 'utf8');
const store = fs.readFileSync('src/reporting/lib/reports/chartStore.ts', 'utf8');

let bad = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) bad++;
  console.log((good ? '  ok   ' : '  FAIL ') + label
    + (good ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
};

// ---- 1. the two lists ----------------------------------------------------
// Key, name and default out of each, in one shape. The app writes
// ["cash","Cash and bank","what it shows",0]; the host writes
// cash: { on: false, name: 'Cash and bank' }.
const readAll = (t, re, pick) => {
  const out = []; let m;
  while ((m = re.exec(t))) out.push(pick(m));
  return out;
};
const inApp = readAll(
  src.slice(src.indexOf('const OVCHARTS='), src.indexOf('function ovOn(')),
  /\["([a-z]+)","([^"]+)","[^"]*",([01])\]/g,
  (m) => [m[1], m[2], +m[3]]);
const inHost = readAll(
  store.slice(store.indexOf('export const CHARTS'), store.indexOf('} as const;')),
  /(\w+):\s*\{ on: (true|false),\s*name: '([^']+)'/g,
  (m) => [m[1], m[3], m[2] === 'true' ? 1 : 0]);

// A list that reads as empty would make the comparison pass by agreeing about
// nothing, which is how a check like this quietly stops checking.
if (inApp.length !== 8 || inHost.length !== 8) {
  console.log('  FAIL the chart lists did not parse: ' + inApp.length + ' in the app, '
    + inHost.length + ' in the host, expected 8 of each');
  process.exit(1);
}
ok('the app and the host know the same charts, defaults and all', inApp, inHost);

// ---- 2. what the overview draws ------------------------------------------
function grab(name) {
  const open = 'function ' + name + '(';
  const a = src.indexOf(open);
  if (a < 0) throw new Error(name + ' not found');
  const b = src.indexOf('\n}\n', a + open.length);
  return src.slice(a, b < 0 ? src.length : b + 3);
}
const pre = src.slice(src.indexOf('/* The charts the overview can draw'), src.indexOf('function renderOverview('));

const M = [];
for (const y of [2024, 2025, 2026]) for (let m = 1; m <= 12; m++) M.push(y + '-' + String(m).padStart(2, '0'));
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const amt = (base, step) => M.map((m) => base + step * (+m.slice(0, 4) - 2024));
const SERIES = { 'P-100': amt(100, 10), 'P-200': amt(40, 4), 'P-300': amt(5, 0),
                 'P-400': amt(7, 0), 'P-500': amt(1, 0), 'P-600': amt(0, 0) };
const BSERIES = { 'B-120': M.map((_, i) => 200 + i), 'B-210': M.map(() => 90),
                  'B-160': M.map((_, i) => 300 + 2 * i) };

const html = {};
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; },
  set textContent(v) { html[id] = v; },
  get textContent() { return html[id] || ''; },
  hidden: true,
  querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
  value: '2',
});
const drawn = [];
const ctx = {
  console, M, NM: M.length, MN: MON,
  D: {
    cfg: { yearEnd: 12, currency: 'EUR', notes: '', charts: { sales: 1, margin: 1, money: 1 } },
    counts: { postings: 1000 },
    agetot: { debpos: 10, debn: 3, crenet: 5, cren: 2, deb: [1, 2, 3, 4], cre: [5, 6, 7, 8] },
  },
  LI: { 'P-300': { name: 'Selling' }, 'P-400': { name: 'Admin' }, 'P-500': { name: 'Interest' } },
  REV: ['P-100'], COS: ['P-200'], SD: ['P-300'], ADM: ['P-400'], FIN: ['P-500'], OI: ['P-600'],
  PL: (id) => SERIES[id] || M.map(() => 0),
  BS: (id) => BSERIES[id] || M.map(() => 0),
  idx: (m) => M.indexOf(m),
  periodRange: () => [24, 30],                 // Jan 26 to Jul 26
  priorRange: () => [12, 18],
  periodLabel: () => 'the period',
  periodCtl: () => {},
  lbl: (m) => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4),
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(v).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  pct: (p) => p === null ? '—' : p.toFixed(1) + '%',
  CHARTS: [],
  reg: (h, ser, lab) => drawn.push('reg'),
  barsChart: (h, items, o) => drawn.push('bars' + (o && o.wide ? ':wide' : '')),
  columnChart: () => drawn.push('column'),
  custSales: () => ({ list: [{ name: 'A customer', v: 500 }] }),
  budgetEntered: () => false,
  BUsum: () => null,
  document: { getElementById: node },
};
vm.createContext(ctx);
vm.runInContext([pre, grab('renderOverview')].join('\n'), ctx);

const cardsIn = (t) => (t.match(/data-chart="([a-z]+)"/g) || []).map((x) => x.slice(12, -1));
const tilesIn = (t) => (t.match(/<div class="k">([^<]*)<\/div><div class="v">([^<]*)<\/div>/g) || [])
  .map((x) => x.replace(/<[^>]+>/g, '|').split('|').filter(Boolean));

ctx.renderOverview();
ok('only the three default charts are drawn', cardsIn(html['ovCharts']), ['sales', 'margin', 'money']);
ok('and the drawing follows the list', drawn, ['reg', 'reg', 'bars:wide']);

// §4c — the month row, for July alone: revenue 120, cost 48, overheads 12,
// finance 1, so profit before tax is 59.
ok('the month row names its month', html['ovMonthNote'], 'The month on its own — Jul 26.');
ok('the month row is the month, not the year', tilesIn(html['ovMonth']),
   [['Revenue', '120'], ['Gross profit', '72'], ['Overheads', '12'], ['Profit before tax', '59'],
    ['Debtors moved', '1'], ['Creditors moved', '0'], ['Cash moved', '2']]);
// and the year-to-date row above it is still the year: seven months of 120
ok('the year-to-date row is untouched', tilesIn(html['ovTiles'])[0], ['Revenue', '840']);

// §4a — the choice decides what appears
drawn.length = 0;
ctx.D.cfg.charts = { sales: 0, margin: 0, money: 0, cash: 1, ageing: 1, customer: 1 };
ctx.renderOverview();
ok('a different client gets different charts', cardsIn(html['ovCharts']), ['cash', 'ageing', 'customer']);
ok('and each is drawn its own way', drawn, ['reg', 'bars:wide', 'bars:wide']);

// a chart with nothing behind it says so rather than drawing an empty picture
drawn.length = 0;
ctx.D.cfg.charts = { sales: 0, margin: 0, money: 0, budget: 1 };
ctx.renderOverview();
ok('expenses against budget, with no budget keyed, explains itself',
   /No budget is keyed for this period/.test(html['ovch-budget']), true);
ok('and draws nothing', drawn, []);

ctx.D.cfg.charts = { sales: 0, margin: 0, money: 0, ageing: 1 };
ctx.D.agetot = {};
ctx.renderOverview();
ok('ageing with none loaded explains itself',
   /nothing to age/.test(html['ovch-ageing']), true);

// A client block cached before this shipped carries no charts at all. It must
// fall back to the defaults, not to an empty front page.
ctx.D.agetot = { deb: [1, 2, 3, 4], cre: [5, 6, 7, 8] };
delete ctx.D.cfg.charts;
ctx.renderOverview();
ok('a block cached before the choice existed still gets its charts',
   cardsIn(html['ovCharts']), ['sales', 'margin', 'money']);

// every chart off is a sentence, not a blank page
ctx.D.cfg.charts = {};
for (const [k] of inApp) ctx.D.cfg.charts[k] = 0;
ctx.renderOverview();
ok('all off says where to turn them back on',
   /Charts on the overview/.test(html['ovCharts']), true);
ok('and draws no cards', cardsIn(html['ovCharts']), []);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
