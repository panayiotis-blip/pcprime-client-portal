/* FIX-3 §6. The shipped renderRatios and bsRatioFoot, against a balance sheet
   and a profit and loss small enough to check in the head.

   The three rules are what is under test: the two figures under every ratio,
   the same columns as the statements, and a ratio that cannot be computed
   saying why rather than printing a nought. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('public/reporting-app.js', 'utf8');

let bad = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) bad++;
  console.log((good ? '  ok   ' : '  FAIL ') + label
    + (good ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
};

function grab(name) {
  const open = 'function ' + name + '(';
  const a = src.indexOf(open);
  if (a < 0) throw new Error(name + ' not found');
  const b = src.indexOf('\n}\n', a + open.length);
  return src.slice(a, b < 0 ? src.length : b + 3);
}
/* One appended block, bounded by the next one. The generator appends several
   and they sit in patch order, not in the order they were written, so a slice
   that runs to the end of the file quietly swallows its neighbours. */
const blockAt = (mark) => {
  const a = src.indexOf(mark);
  if (a < 0) throw new Error(mark + ' is not in the built app');
  const b = src.indexOf('\n/* ---------- ', a + mark.length);
  return src.slice(a, b < 0 ? src.length : b);
};
const block = blockAt('/* ---------- ratios (FIX-3');
const cmp = blockAt('/* ---------- comparison columns');

// Two years of months. Revenue 1.000 a month in 2025 and 1.200 in 2026; cost of
// sales 600 and 720. Every balance sheet line is flat, so a position at a month
// end is the same figure whichever month end is chosen.
const M = [];
for (const y of [2025, 2026]) for (let m = 1; m <= 12; m++) M.push(y + '-' + String(m).padStart(2, '0'));
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const yr = (m) => +m.slice(0, 4);
const SERIES = {
  'P-100': M.map((m) => yr(m) === 2025 ? 1000 : 1200),      // revenue
  'P-200': M.map((m) => yr(m) === 2025 ? 600 : 720),        // cost of sales
  'P-500': M.map(() => 10),                                  // finance costs
};
//   non-current assets 2.000 · stock 300 · debtors 900 · cash 200
//   current liabilities: trade creditors 400, overdraft 100
//   non-current liabilities 500
const BSERIES = {
  'B-010': M.map(() => 2000),
  'B-110': M.map(() => 300), 'B-120': M.map(() => 900), 'B-160': M.map(() => 200),
  'B-210': M.map(() => 400), 'B-270': M.map(() => 100),
  'B-410': M.map(() => 500),
};
const LINES = [
  { id: 'B-010', name: 'Fixed assets' },
  { id: 'B-110', name: 'Stock' }, { id: 'B-120', name: 'Trade debtors' },
  { id: 'B-160', name: 'Cash and bank' },
  { id: 'B-210', name: 'Trade creditors' }, { id: 'B-270', name: 'Bank overdraft' },
  { id: 'B-410', name: 'Long-term loans' },
  { id: 'B-610', name: 'Share capital' }, { id: 'B-640', name: 'Reserves' },
  { id: 'B-650', name: 'Profit for the period' },
];

let RANGE = [12, 23];               // the whole of 2026
const html = {};
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; },
  querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }), addEventListener() {},
});
const ctx = {
  console, M, NM: M.length,
  D: { cfg: { yearEnd: 12 }, lines: LINES },
  REV: ['P-100'], COS: ['P-200'], SD: [], ADM: [], FIN: ['P-500'], OI: [],
  PL: (id) => SERIES[id] || M.map(() => 0),
  BS: (id) => BSERIES[id] || M.map(() => 0),
  sumL: (ids, a, b) => ids.reduce((t, id) => t + (SERIES[id] || M.map(() => 0)).slice(a, b + 1)
    .reduce((q, w) => q + w, 0), 0),
  ytdStart: (j) => Math.floor(j / 12) * 12,
  periodRange: () => RANGE,
  priorRange: () => RANGE[0] - 12 < 0 ? null : [RANGE[0] - 12, RANGE[1] - 12],
  clampIdx: (m) => M.indexOf(m),
  monthChoices: () => M.slice(),
  lbl: (m) => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4),
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(Math.round(v)).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  BUsum: () => null, BLINES: () => Object.keys(SERIES),
  periodCtl: () => {}, notes: () => {},
  document: { getElementById: node },
};
vm.createContext(ctx);
vm.runInContext([cmp, block].join('\n'), ctx);
const CMP = vm.runInContext('CMP', ctx);

const rowOf = (t, name) => {
  const m = t.match(new RegExp('<tr[^>]*><td>' + name.replace(/[()]/g, '\\$&') + '</td>(.*?)</tr>'));
  return m ? (m[1].match(/<td[^>]*>(.*?)<\/td>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')) : null;
};
const heads = (t) => (t.match(/<th[^>]*>(.*?)<\/th>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));

CMP['ra'] = [{ kind: 'py' }];
ctx.renderRatios();
let t = html['tblRatios'];

// The columns are the statements' columns, through the same machinery.
ok('the same columns as the statements', heads(t), ['Ratio', 'Jan 26–Dec 26', 'Jan 25–Dec 25']);

// current assets 300+900+200 = 1.400; current liabilities 400+100 = 500
ok('current ratio', rowOf(t, 'Current ratio'), ['2.80×', '2.80×']);
ok('and the two figures under it', [rowOf(t, 'Current assets'), rowOf(t, 'Current liabilities')],
   [['1.400', '1.400'], ['500', '500']]);
// (1.400 - 300) / 500
ok('quick ratio takes the stock out', rowOf(t, 'Quick ratio (acid test)'), ['2.20×', '2.20×']);
ok('working capital is money, not a multiple', rowOf(t, 'Working capital'), ['900', '900']);

// debtors 900 / revenue 14.400 x 365 = 22,8 -> 23
ok('debtor days are over the period, not annualised', rowOf(t, 'Debtor days'), ['23 days', '27 days']);
// creditors 400 / cost 8.640 x 365 = 16,9 -> 17
ok('creditor days', rowOf(t, 'Creditor days'), ['17 days', '20 days']);
// stock 300 / cost 8.640 x 365 = 12,7 -> 13
ok('stock days', rowOf(t, 'Stock days'), ['13 days', '15 days']);
// cost 8.640 / stock 300
ok('stock turnover', rowOf(t, 'Stock turnover'), ['28.80×', '24.00×']);

// gross profit 14.400 - 8.640 = 5.760, over 14.400
ok('gross margin', rowOf(t, 'Gross margin'), ['40.0%', '40.0%']);
// 2026: 5.640 over 14.400; 2025: 4.680 over 12.000
ok('net margin', rowOf(t, 'Net margin'), ['39.2%', '39.0%']);
ok('and shows the profit it used', rowOf(t, 'Profit before tax'), ['5.640', '4.680']);
// borrowings 500 + 100 = 600; equity = 2.000 + 1.400 - 500 - 500 = 2.400
ok('gearing', rowOf(t, 'Gearing (debt to equity)'), ['25.0%', '25.0%']);
// (5.640 + 120) / 120
ok('interest cover', rowOf(t, 'Interest cover'), ['48.00×', '40.00×']);

// §6 rule three — growth is against the column to the right, and the last
// column has nothing to its right and says so.
ok('revenue growth against the older column', rowOf(t, 'Revenue growth'),
   ['20.0%', 'no earlier column to compare with']);

// a ratio that cannot be computed says why
ctx.BSERIES = null;
const noStock = BSERIES['B-110'];
BSERIES['B-110'] = M.map(() => 0);
ctx.renderRatios();
ok('no stock is a reason, not a nought', rowOf(html['tblRatios'], 'Stock days'),
   ['no stock held', 'no stock held']);
ok('and so is no stock for the turnover', rowOf(html['tblRatios'], 'Stock turnover'),
   ['no stock held', 'no stock held']);
BSERIES['B-110'] = noStock;

// a comparison the ledger cannot reach keeps its place and says so
RANGE = [0, 11];                    // 2025, with no 2024 behind it
ctx.renderRatios();
ok('a column the ledger cannot reach says so', rowOf(html['tblRatios'], 'Current ratio'),
   ['2.80×', 'not in the ledger']);
RANGE = [12, 23];

// A budget column with nothing keyed says so before it gets here (§2c), so
// the refusal is only reachable with a budget actually keyed.
CMP['ra'] = [{ kind: 'budget' }];
ctx.BUsum = () => 1;
ctx.renderRatios();
ok('a budget column is refused with a reason', rowOf(html['tblRatios'], 'Current ratio'),
   ['2.80×', 'a ratio is not budgeted']);

// ---- the foot of the balance sheet ---------------------------------------
const foot = ctx.bsRatioFoot([{ label: 'Dec 26', at: 23 }, { label: 'Dec 25', at: 11 }]);
ok('the foot carries the four a month end can answer',
   (foot.match(/<tr[^>]*><td>([^<]+)<\/td>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')),
   ['Current ratio', 'Quick ratio (acid test)', 'Working capital', 'Gearing (debt to equity)']);
ok('and agrees with the screen', rowOf(foot, 'Current ratio')[0], '2.80×');
ok('it says where the rest are', /on the Ratios screen/.test(foot), true);

// ---- and the ratios agree with the statement they are drawn from ---------
// bsAt reads the balance sheet the way renderBs builds it — same subtotal rule,
// same treatment of the cumulative result and the balancing plug. A ratio that
// disagrees with the statement beside it is worse than no ratio, so the two are
// held to each other here rather than by inspection.
vm.runInContext([grab('renderBs'), grab('lblShort')].join('\n'), ctx);
CMP['bs'] = [];
ctx.renderBs();
const bsTable = html['tblBs'];

// The foot has to be in the renderBs that SHIPS. The first attempt put it there
// with a patch that ran before the one replacing renderBs wholesale, so the call
// was written and then thrown away — and the guard passed, because the line it
// matched exists in the template's version too. Assert on the output.
ok('the balance sheet carries the headline ratios', /The headline ratios/.test(bsTable), true);
ok('and they are under the sheet, not above it',
   bsTable.indexOf('The headline ratios') > bsTable.indexOf('Net assets'), true);
const netAssets = (bsTable.match(/<tr class="tot"><td>Net assets<\/td><td[^>]*>([^<]*)</) || [])[1];
const figures = vm.runInContext('bsAt(23)', ctx);
ok('the balance sheet and the ratios agree on equity',
   netAssets, ctx.eur(figures.eq));
ok('and on current assets and liabilities',
   [ctx.eur(figures.ca), ctx.eur(figures.cl)],
   // one column on the sheet, so the first cell of each subtotal row
   [rowOf(bsTable, 'Current assets')[0], rowOf(bsTable, 'Current liabilities')[0]]);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
