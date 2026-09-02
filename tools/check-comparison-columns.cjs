/* Exercises the SHIPPED renderPl / renderBs / cmpCols against a made-up ledger.
   The figures are invented; what is under test is the shape — how many columns,
   what they are headed, and that a movement is the column to its left less the
   column it sits beside. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('public/reporting-app.js', 'utf8');

function grab(name) {
  const open = 'function ' + name + '(';
  const a = src.indexOf(open);
  if (a < 0) throw new Error(name + ' not found');
  // Same rule the generator cuts on: the closing brace in column one.
  const b = src.indexOf('\n}\n', a + open.length);
  return src.slice(a, b < 0 ? src.length : b + 3);
}
const cmpFrom = src.indexOf('/* ---------- comparison columns');
const cmpTo = src.indexOf('/* ---------- appended by tools', cmpFrom);
if (cmpFrom < 0 || cmpTo < 0) throw new Error('the comparison block is not where it was');
const cmpBlock = src.slice(cmpFrom, cmpTo);

const M = [];
for (const y of [2024, 2025, 2026]) for (let m = 1; m <= 12; m++) M.push(y + '-' + String(m).padStart(2, '0'));
const NM = M.length;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* One revenue line and one cost line, worth 100 and 40 a month in 2024, rising
   by 10 and 4 each year, so every figure below can be checked by hand. */
const amt = (base, step) => M.map(m => base + step * (+m.slice(0, 4) - 2024));
const SERIES = { 'P-100': amt(100, 10), 'P-200': amt(40, 4), 'P-300': amt(5, 0),
                 'P-400': amt(7, 0), 'P-500': amt(1, 0), 'P-600': amt(0, 0) };
const BSERIES = { 'B-010': M.map(() => 500), 'B-110': M.map((_, i) => 200 + i),
                  'B-210': M.map(() => 90), 'B-410': M.map(() => 0),
                  'B-610': M.map(() => 300), 'B-640': M.map(() => 0), 'B-650': M.map(() => 0) };

let PLRANGE = [24, 30];   // Jan 26 to Jul 26
const html = {};
/* Enough of a DOM for the control to register its handlers and for the test to
   fire one: the buttons are found by reading back the markup the control just
   wrote, so what is clicked is what a person would click. */
const bound = {};
const fake = (id, sel, attr, val) => ({
  dataset: { [attr]: val },
  addEventListener(ev, fn) { (bound[id + ' ' + sel] = bound[id + ' ' + sel] || []).push(fn); },
});
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; delete bound[id + ' .cmpshape']; delete bound[id + ' .cmpx']; },
  querySelectorAll(sel) {
    const attr = sel === '.cmpshape' ? 'y' : 'k';
    const re = new RegExp('class="[^"]*' + sel.slice(1) + '[^"]*" data-' + attr + '="([^"]*)"', 'g');
    const out = []; let m;
    while ((m = re.exec(html[id] || ''))) out.push(fake(id, sel, attr, m[1]));
    return out;
  },
  querySelector: () => ({ addEventListener() {} }),
  addEventListener() {},
});
const press = (id, sel, i) => {
  const el = node(id).querySelectorAll(sel)[i];
  if (!el) throw new Error('no ' + sel + ' in ' + id);
  (bound[id + ' ' + sel] || [])[i]();
};

const ctx = {
  console, M, NM,
  D: { cfg: { yearEnd: 12 }, lines: [
    { id: 'B-010', name: 'Fixed assets' }, { id: 'B-110', name: 'Debtors' },
    { id: 'B-210', name: 'Creditors' }, { id: 'B-410', name: 'Long-term loans' },
    { id: 'B-610', name: 'Share capital' }, { id: 'B-640', name: 'Reserves' },
    { id: 'B-650', name: 'Profit for the period' } ] },
  LI: { 'P-100': { name: 'Sales' }, 'P-200': { name: 'Purchases' }, 'P-300': { name: 'Selling' },
        'P-400': { name: 'Admin' }, 'P-500': { name: 'Interest' }, 'P-600': { name: 'Sundry' } },
  REV: ['P-100'], COS: ['P-200'], SD: ['P-300'], ADM: ['P-400'], FIN: ['P-500'], OI: ['P-600'],
  PL: (id) => SERIES[id] || M.map(() => 0),
  BS: (id) => BSERIES[id] || M.map(() => 0),
  sumL: (ids, a, b) => ids.reduce((t, id) => t + (SERIES[id] || []).slice(a, b + 1).reduce((q, w) => q + w, 0), 0),
  ytdStart: (j) => Math.floor(j / 12) * 12,
  BUsum: () => null, BLINES: () => Object.keys(SERIES),
  periodRange: () => PLRANGE,
  priorRange: () => PLRANGE[0] - 12 < 0 ? null : [PLRANGE[0] - 12, PLRANGE[1] - 12],
  clampIdx: (m) => M.indexOf(m),
  monthChoices: () => M.slice(),
  lbl: (m) => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4),
  periodLabel: () => 'the period',
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(v).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  pct: (p) => p === null ? '—' : p.toFixed(1) + '%',
  notes: () => {}, periodCtl: () => {},
  document: { getElementById: node },
};
vm.createContext(ctx);
vm.runInContext([cmpBlock, grab('lblShort'), grab('renderPl'), grab('renderBs'),
                 grab('renderExp')].join('\n'), ctx);

const strip = (s) => s.replace(/<[^>]+>/g, '').split('').filter(Boolean);
// CMP is a lexical const inside the sandbox, so reach it by evaluating its name.
const CMP = vm.runInContext('CMP', ctx);

const heads = (t) => (t.match(/<th[^>]*>(.*?)<\/th>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
const rowOf = (t, name) => {
  const re = new RegExp('<tr[^>]*><td>' + name + '</td>(.*?)</tr>');
  const m = t.match(re);
  return m ? (m[1].match(/<td[^>]*>(.*?)<\/td>/g) || []).map(x => x.replace(/<[^>]+>/g, '')) : null;
};

let bad = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) bad++;
  console.log((good ? '  ok   ' : '  FAIL ') + label + (good ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
};

// --- one comparison, the default: same period last year ---
ctx.renderPl();
let t = html['tblPl'];
ok('pl default headings', heads(t),
   ['Line', 'Jan 26–Jul 26', '%', 'Jan 25–Jul 25', '%', 'Jul 26 vs Jul 25', '%']);
// 7 months at 120 against 7 at 110
ok('pl sales row', rowOf(t, 'Sales'), ['840', '100.0%', '770', '100.0%', '70', '9.1%']);

// --- §2a: as many as wanted, any period end ---
CMP['pl'] = [{ kind: 'py' }, { kind: 'at', to: '2024-07' }];
ctx.renderPl();
t = html['tblPl'];
ok('pl three columns, two movements', heads(t),
   ['Line', 'Jan 26–Jul 26', '%', 'Jan 25–Jul 25', '%', 'Jul 26 vs Jul 25', '%',
    'Jan 24–Jul 24', '%', 'Jul 25 vs Jul 24', '%']);
ok('pl sales across three years', rowOf(t, 'Sales'),
   ['840', '100.0%', '770', '100.0%', '70', '9.1%', '700', '100.0%', '70', '10.0%']);

// --- §2c: budget with nothing keyed says so, and is never a default ---
CMP['pl'] = [{ kind: 'budget' }];
ctx.renderPl();
t = html['tblPl'];
ok('pl budget not keyed', heads(t), ['Line', 'Jan 26–Jul 26', '%', 'Budget', '%', 'Jul 26 vs Budget', '%']);
ok('pl budget prints none, not nought', rowOf(t, 'Sales'),
   ['840', '100.0%', '—', '—', '—', '—']);

// --- a comparison the ledger cannot reach ---
CMP['pl'] = [{ kind: 'py' }];
PLRANGE = [0, 6];   // Jan 24 to Jul 24; there is no 2023
ctx.renderPl();
ok('pl comparison out of range', heads(html['tblPl']).slice(3, 5), ['Same period last year', '%']);
PLRANGE = [24, 30];

// --- §2b: three and five years across, in one click ---
CMP['pl'] = [{ kind: 'py' }];
ctx.renderPl();
press('plCmpBar', '.cmpshape', 0);          // "3 years across"
ok('three years across replaces the list', CMP['pl'],
   [{ kind: 'at', to: '2025-07' }, { kind: 'at', to: '2024-07' }]);
ok('three years across, headings', heads(html['tblPl']).filter(x => x.indexOf('–') > 0),
   ['Jan 26–Jul 26', 'Jan 25–Jul 25', 'Jan 24–Jul 24']);
press('plCmpBar', '.cmpshape', 1);          // "5 years across"
// only 2024 and 2025 are in the ledger, so five years asks for four and gets two
ok('five years across stops at the ledger', CMP['pl'],
   [{ kind: 'at', to: '2025-07' }, { kind: 'at', to: '2024-07' }]);

// --- a column can be taken off again ---
press('plCmpBar', '.cmpx', 0);
ok('removing a chip drops that column', CMP['pl'], [{ kind: 'at', to: '2024-07' }]);

// --- the balance sheet: two year ends beside the position (§2a, §2d) ---
CMP['bs'] = [{ kind: 'at', to: '2025-12' }, { kind: 'at', to: '2024-12' }];
ctx.renderBs();
t = html['tblBs'];
ok('bs headings', heads(t),
   ['Line', 'Jul 26', 'Dec 25', 'Jul 26 vs Dec 25', 'Dec 24', 'Dec 25 vs Dec 24']);
// debtors are 200+i, so Jul 26 is index 30, Dec 25 index 23, Dec 24 index 11
ok('bs debtors and movement', rowOf(t, 'Debtors'), ['230', '223', '7', '211', '12']);

// --- Expense analysis takes the same list ---
CMP['exp'] = [{ kind: 'py' }, { kind: 'at', to: '2024-07' }];
ctx.renderExp();
t = html['tblExp'];
ok('exp headings', heads(t),
   ['Line', 'Jan 26–Jul 26', '% of sales', 'Jan 25–Jul 25', '% of sales', 'Jul 26 vs Jul 25',
    'Jan 24–Jul 24', '% of sales', 'Jul 25 vs Jul 24', 'Monthly shape']);
// admin is 7 a month throughout, so seven months is 49 in every year and nothing moves
ok('exp admin across three years', rowOf(t, 'Admin').slice(0, 8),
   ['49', '5.8%', '49', '6.4%', '0', '49', '7.0%', '0']);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
