/* FIX-3 §9. The shipped sales additions: the five new tiles, the ratios block,
   and the days-to-pay table — against a customer ledger small enough to add up
   in the head.

   It also holds the one correction in §9: custSales used to decide which
   accounts were the sales ledger by testing /^221/ on the code, which is A&F's
   chart and nobody else's. It uses the mapping now. Both are exercised. */
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
const blockAt = (mark) => {
  const a = src.indexOf(mark);
  if (a < 0) throw new Error(mark + ' is not in the built app');
  const b = src.indexOf('\n/* ---------- ', a + mark.length);
  return src.slice(a, b < 0 ? src.length : b);
};

// 2025 and 2026, six months each.
const M = [];
for (let m = 1; m <= 6; m++) M.push('2025-0' + m);
for (let m = 1; m <= 6; m++) M.push('2026-0' + m);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Four customers. Alpha is big and long-standing; Beta bought only in 2025 and
// is therefore lost; Gamma is steady; Delta's first sale ever is in 2026, so
// Delta is new. One credit note. One account outside the 221 range that is
// mapped to Trade debtors but never sells — A&F's Bills Receivable in miniature.
const SALES = [
  // 2025
  { acc: '2210', an: 'Alpha Ltd',  date: '2025-02-10', m: '2025-02', j: 'SIN', v: 6000, ref: '', det: '' },
  { acc: '2211', an: 'Beta Ltd',   date: '2025-03-11', m: '2025-03', j: 'SIN', v: 2000, ref: '', det: '' },
  { acc: '2212', an: 'Gamma Ltd',  date: '2025-04-12', m: '2025-04', j: 'SIN', v: 2000, ref: '', det: '' },
  // 2026
  { acc: '2210', an: 'Alpha Ltd',  date: '2026-02-10', m: '2026-02', j: 'SIN', v: 8000, ref: '', det: '' },
  { acc: '2212', an: 'Gamma Ltd',  date: '2026-04-12', m: '2026-04', j: 'SIN', v: 1000, ref: '', det: '' },
  { acc: '2213', an: 'Delta Ltd',  date: '2026-05-13', m: '2026-05', j: 'SIN', v: 1000, ref: '', det: '' },
  { acc: '2210', an: 'Alpha Ltd',  date: '2026-06-14', m: '2026-06', j: 'SRT', v: -500, ref: '', det: '' },
  // never a sale, but on Trade debtors
  { acc: '2243', an: 'Bills Receivable', date: '2026-03-01', m: '2026-03', j: 'BPM', v: 700, ref: '', det: '' },
];
const ACCOUNTS = [
  { code: '2210', name: 'Alpha Ltd', line: 'B-120', m: M.map(() => 0) },
  { code: '2211', name: 'Beta Ltd', line: 'B-120', m: M.map(() => 0) },
  { code: '2212', name: 'Gamma Ltd', line: 'B-120', m: M.map(() => 0) },
  { code: '2213', name: 'Delta Ltd', line: 'B-120', m: M.map(() => 0) },
  { code: '2243', name: 'Bills Receivable', line: 'B-120', m: M.map(() => 0) },
];
// Net sales 10.000 in 2026 and 10.000 in 2025; cost of sales 6.000 both years.
const SERIES = {
  'P-100': M.map((m) => m.slice(0, 4) === '2026' ? 10000 / 6 : 10000 / 6),
  'P-200': M.map(() => 6000 / 6),
};

let RANGE = [6, 11];                      // Jan 26 to Jun 26
const html = {};
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; },
  querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }), addEventListener() {},
});
const ctx = {
  console, M, NM: M.length, MN: MON, CID: 'c1',
  D: {
    cfg: { yearEnd: 12 }, accounts: ACCOUNTS,
    agetot: { deb: [100, 0, 0, 900], debpos: 1000 },
    deb: [{ code: '2210', name: 'Alpha Ltd', bal: 2000 },
          { code: '2212', name: 'Gamma Ltd', bal: 250 }],
  },
  REV: ['P-100'], COS: ['P-200'], SD: [], ADM: [], FIN: [], OI: [],
  PL: (id) => SERIES[id] || M.map(() => 0),
  BS: (id) => id === 'B-120' ? M.map(() => 2500) : M.map(() => 0),
  SALESJ: ['SIN', 'SRT'],
  postings: () => ({ rows: SALES }),
  pInRange: (a, b) => SALES.filter((p) => p.m >= M[a] && p.m <= M[b]),
  periodRange: () => RANGE,
  priorRange: () => RANGE[0] - 6 < 0 ? null : [RANGE[0] - 6, RANGE[1] - 6],
  clampIdx: (m) => M.indexOf(m),
  monthChoices: () => M.slice(),
  lbl: (m) => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4),
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(Math.round(v)).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  BUsum: () => null, BLINES: () => Object.keys(SERIES),
  sumL: (ids, a, b) => ids.reduce((t, id) => t + (SERIES[id] || M.map(() => 0)).slice(a, b + 1)
    .reduce((q, w) => q + w, 0), 0),
  ytdStart: (j) => j < 6 ? 0 : 6,
  periodCtl: () => {}, notes: () => {},
  document: { getElementById: node },
};
vm.createContext(ctx);
vm.runInContext([
  blockAt('/* ---------- comparison columns'),
  blockAt('/* ---------- ratios (FIX-3'),
  grab('custSales'),
  blockAt('/* ---------- sales analysis: the additions'),
].join('\n'), ctx);
const CMP = vm.runInContext('CMP', ctx);

const rowOf = (t, name) => {
  const m = (t || '').match(new RegExp('<tr[^>]*><td>' + name.replace(/[()]/g, '\\$&') + '</td>(.*?)</tr>'));
  return m ? (m[1].match(/<td[^>]*>(.*?)<\/td>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')) : null;
};

// ---- the correction: which accounts are the sales ledger -----------------
ok('the sales ledger comes from the mapping', vm.runInContext('isSalesAcc("2243")', ctx), true);
ok('and a client with no mapping falls back to the prefix', (() => {
  const held = ctx.D.accounts; ctx.D.accounts = []; ctx.CID = 'c-nomap';
  const r = [vm.runInContext('isSalesAcc("2210")', ctx), vm.runInContext('isSalesAcc("9000")', ctx)];
  ctx.D.accounts = held; ctx.CID = 'c1';
  return r;
})(), [true, false]);
// Bills Receivable is now IN the sales ledger, but it has no sales journal line,
// so nothing about the figures changes — which is the point.
const C26 = vm.runInContext('custSales(6,11)', ctx);
ok('and it changes no figure, because it never sells',
   [C26.gross, C26.inv, C26.list.map((x) => x.code).sort()],
   [10000, 3, ['2210', '2212', '2213']]);

// ---- §9b, the ratios ----------------------------------------------------
CMP['slr'] = [{ kind: 'py' }];
ctx.renderSalesRatios();
let t = html['tblSlRatios'];
ok('the ratios run across the same columns',
   (t.split('</thead>')[0].match(/<th[^>]*>(.*?)<\/th>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')),
   ['Ratio', 'Jan 26–Jun 26', 'Jan 25–Jun 25']);
// 2026: Alpha 7.500, Gamma 1.000, Delta 1.000 — 9.500 invoiced net of the note
// 2025: Alpha 6.000, Beta 2.000, Gamma 2.000 — 10.000
// Alpha 7.500 of the 9.500 the customers came to, net of their own notes.
ok('the largest customer, as a share', rowOf(t, 'The largest customer, as a share'), ['78.9%', '60.0%']);
ok('and the two figures under it',
   [rowOf(t, 'That customer'), rowOf(t, 'Invoiced, net of credit notes')],
   [['7.500', '6.000'], ['9.500', '10.000']]);
// Delta's first sale ever is in 2026: 1.000 of 10.000
ok('new customer revenue', rowOf(t, 'New customer revenue, as a share'), ['10.5%', '100.0%']);
// one note of 500 against 10.000 invoiced
// 500 of notes against 10.000 invoiced; no notes at all in 2025, which is a
// figure and not a gap, so it reads as nought rather than as a reason.
ok('credit note rate', rowOf(t, 'Credit note rate'), ['5.0%', '0.0%']);
ok('revenue per customer', rowOf(t, 'Revenue per customer'), ['3.167', '3.333']);
// 10.000 sales less 6.000 cost
ok('gross margin', rowOf(t, 'Gross margin'), ['40.0%', '40.0%']);
// debtors 2.500 over sales 10.000 across 181 days
ok('debtor days', rowOf(t, 'Debtor days'), ['45 days', '45 days']);
// the ageing is as at the latest month, so only the first column can answer
ok('over-90 answers for one column and says why for the other',
   rowOf(t, 'Debtors over 90 days, as a share'),
   ['90.0%', 'the ageing is held only as at the latest month']);
// 10.000 against 10.000
ok('revenue growth', rowOf(t, 'Revenue growth'), ['0.0%', 'no earlier column to compare with']);
// Alpha+Gamma+Delta this year 9.500; the same three last year 6.000+2.000 = 8.000
ok('growth of the ten largest', rowOf(t, 'Growth of the ten largest'),
   ['18.8%', 'no earlier column to compare with']);
// this period's top ten IS everybody, so there is nobody else left
ok('growth of everyone else', rowOf(t, 'Growth of everyone else'),
   ['-100.0%', 'no earlier column to compare with']);

// ---- a column the ledger cannot reach ------------------------------------
RANGE = [0, 5];
ctx.renderSalesRatios();
ok('a comparison out of range keeps its place and says so',
   rowOf(html['tblSlRatios'], 'Gross margin'), ['40.0%', 'not in the ledger']);
RANGE = [6, 11];

// ---- the days-to-pay table -----------------------------------------------
ctx.renderSalesRatios();
const pay = html['tblSlPay'];
ok('largest customers first', (pay.match(/<tr><td>([^<]*)<\/td>/g) || [])
   .map((x) => x.replace(/<[^>]+>/g, '')), ['Alpha Ltd', 'Gamma Ltd', 'Delta Ltd']);
// Alpha: 2.000 owed against 7.500 invoiced over 181 days
ok('and their own days', rowOf(pay, 'Alpha Ltd'), ['7.500', '2.000', '48 days']);
ok('a customer with no ageing says so, rather than showing a nought',
   rowOf(pay, 'Delta Ltd'), ['1.000', 'no ageing', '—']);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
