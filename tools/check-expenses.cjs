/* FIX-3 §8. The shipped renderExp: two views, two levels of drill-down, sorting
   and the nil lines. The ledger below is small enough that every figure in the
   expectations can be worked out in the head. */
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
const cmpBlock = (() => {
  const a = src.indexOf('/* ---------- comparison columns');
  const b = src.indexOf('\n/* ---------- ', a + 40);
  return src.slice(a, b < 0 ? src.length : b);
})();
const expPre = src.slice(src.indexOf('/* Expense analysis (FIX-3'), src.indexOf('function renderExp('));

// 2025 in full, 2026 to July. Revenue 1.000 a month throughout.
//   Selling      100 a month, both years
//   Admin        200 a month in 2025, 150 in 2026 — two accounts under it
//   Finance      nothing at all, ever
const M = [];
for (let m = 1; m <= 12; m++) M.push('2025-' + String(m).padStart(2, '0'));
for (let m = 1; m <= 7; m++) M.push('2026-' + String(m).padStart(2, '0'));
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const y26 = (m) => m.slice(0, 4) === '2026';
const SERIES = {
  'P-100': M.map(() => 1000),
  'P-300': M.map(() => 100),
  'P-400': M.map((m) => y26(m) ? 150 : 200),
  'P-500': M.map(() => 0),
};
// Admin is two nominal accounts; they have to add back to the line.
const ACCOUNTS = [
  { code: '7000', name: 'Office costs', line: 'P-400', m: M.map((m) => y26(m) ? 100 : 120) },
  { code: '7010', name: 'Professional fees', line: 'P-400', m: M.map((m) => y26(m) ? 50 : 80) },
  { code: '6000', name: 'Advertising', line: 'P-300', m: M.map(() => 100) },
];
const POSTINGS = [
  { acc: '7000', date: '2026-03-04', j: 'PJ', ref: 'INV-1', det: 'Stationery', v: 60, m: '2026-03' },
  { acc: '7000', date: '2026-03-19', j: 'PJ', ref: 'INV-2', det: 'Cleaning', v: 40, m: '2026-03' },
];

const html = {}, sel = { expYear: '2026' };
const listeners = {};
const el = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; },
  get value() { return sel[id] === undefined ? '' : sel[id]; },
  set value(v) { sel[id] = v; },
  style: {},
  querySelectorAll(s) {
    const attr = s === '.expline' ? 'line' : s === '.expacct' ? 'acct' : 'sort';
    const re = new RegExp('data-' + attr + '="([^"]*)"', 'g');
    const out = []; let m;
    while ((m = re.exec(html[id] || ''))) {
      const val = m[1];
      out.push({
        dataset: { [attr]: val },
        addEventListener(ev, fn) { listeners[s + '|' + val] = fn; },
      });
    }
    return out;
  },
  querySelector() { return { addEventListener() {} }; },
  addEventListener() {},
});
const ctx = {
  console, M, NM: M.length, MN: MON,
  D: { accounts: ACCOUNTS, cfg: { yearEnd: 12 } },
  LI: { 'P-300': { name: 'Selling' }, 'P-400': { name: 'Admin' }, 'P-500': { name: 'Finance' } },
  REV: ['P-100'], SD: ['P-300'], ADM: ['P-400'], FIN: ['P-500'], COS: [], OI: [],
  PL: (id) => SERIES[id] || M.map(() => 0),
  idx: (m) => M.indexOf(m),
  pInRange: (a, b) => POSTINGS.filter((p) => p.m >= M[a] && p.m <= M[b]),
  periodRange: () => [12, 18],                      // Jan 26 to Jul 26
  priorRange: () => [0, 6],                         // Jan 25 to Jul 25
  clampIdx: (m) => M.indexOf(m),
  monthChoices: () => M.slice(),
  lbl: (m) => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4),
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(Math.round(v)).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  BUsum: () => null, BLINES: () => Object.keys(SERIES),
  periodCtl: () => {}, notes: () => {},
  document: { getElementById: el },
};
vm.createContext(ctx);
vm.runInContext([cmpBlock, grab('lblShort'), expPre, grab('renderExp')].join('\n'), ctx);
const CMP = vm.runInContext('CMP', ctx);

const heads = () => ((html['tblExp'] || '').split('</thead>')[0].match(/<th[^>]*>(.*?)<\/th>/g) || [])
  .map((x) => x.replace(/<[^>]+>/g, ''));
const names = (cls) => ((html['tblExp'] || '')
  .match(new RegExp('<tr class="' + cls + '[^"]*"[^>]*><td>(?:<span[^>]*>[^<]*</span>)?([^<]*)</td>', 'g')) || [])
  .map((x) => x.replace(/.*<\/span>/, '').replace(/<[^>]*>/g, ''));
const rowOf = (name) => {
  const m = (html['tblExp'] || '').match(
    new RegExp('<tr class="exp[a-z]*[^"]*"[^>]*><td><span class="twist">.</span>' + name + '</td>(.*?)</tr>'));
  return m ? (m[1].match(/<td[^>]*>(.*?)<\/td>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')) : null;
};

// ---- §8a, years across (the default) ------------------------------------
CMP['exp'] = [{ kind: 'py' }];
ctx.renderExp();
ok('years across, and the sparkline is gone', heads(),
   ['Line', 'Jan 26–Jul 26', '%', 'Jan 25–Jul 25', '%', 'Jul 26 vs Jul 25']);
// admin: 7 x 150 = 1.050 this year against 7 x 200 = 1.400
ok('admin across two years', rowOf('Admin'), ['1.050', '15.0%', '1.400', '20.0%', '(350)']);
ok('and the % is of that column\'s own sales', rowOf('Selling'),
   ['700', '10.0%', '700', '10.0%', '0']);

// ---- §8c, the nil lines --------------------------------------------------
ok('a line nil in every period shown is hidden', names('expline'), ['Admin', 'Selling']);
ctx.EXPNIL = true;
ctx.renderExp();
ok('and can be brought back', names('expline'), ['Admin', 'Selling', 'Finance']);
ok('the button says which way it is', /Showing nil lines/.test(html['expView']), true);
ctx.EXPNIL = false;

// ---- §8c, sorting --------------------------------------------------------
ctx.renderExp();
ok('sorted by the first column, largest first', names('expline'), ['Admin', 'Selling']);
ctx.EXPSORT = { k: 'name', dir: 1 };
ctx.renderExp();
ok('by name', names('expline'), ['Admin', 'Selling']);
ctx.EXPSORT = { k: 'name', dir: -1 };
ctx.renderExp();
ok('by name, the other way', names('expline'), ['Selling', 'Admin']);
ctx.EXPSORT = { k: 1, dir: -1 };                    // last year, largest first
ctx.renderExp();
ok('by a comparison column', names('expline'), ['Admin', 'Selling']);
ctx.EXPSORT = { k: 0, dir: -1 };

// ---- §8b, level one: the nominal accounts under a line -------------------
ctx.EXPOPEN = { line: 'P-400', acct: null };
ctx.renderExp();
ok('a line opens to its accounts', names('expacct'),
   ['7000  Office costs', '7010  Professional fees']);
// office 7 x 100 = 700 this year against 7 x 120 = 840
ok('across the same columns', rowOf('7000  Office costs'),
   ['700', '10.0%', '840', '12.0%', '(140)']);
// and they add back to the line
ok('and they add back to the line',
   [rowOf('7000  Office costs')[0], rowOf('7010  Professional fees')[0], rowOf('Admin')[0]],
   ['700', '350', '1.050']);

// ---- §8b, level two: the postings ---------------------------------------
ctx.EXPOPEN = { line: 'P-400', acct: '7000' };
ctx.renderExp();
ok('an account opens to its postings',
   /INV-1/.test(html['tblExp']) && /INV-2/.test(html['tblExp']), true);
ok('with the journal so it can be found in BTMS', /<td class="mono">PJ<\/td>/.test(html['tblExp']), true);
ok('and the narrative', /Stationery/.test(html['tblExp']), true);
ok('the other account is not opened', /Professional fees<\/td>[\s\S]*?INV-1/.test(html['tblExp']), false);

ctx.EXPOPEN = { line: 'P-300', acct: '6000' };
ctx.renderExp();
ok('an account with nothing posted in the period says so',
   /Nothing is posted to this account in the period shown/.test(html['tblExp']), true);
ctx.EXPOPEN = { line: null, acct: null };

// ---- §8a, months across --------------------------------------------------
ctx.EXPVIEW = 'months';
ctx.EXPSORT = { k: 'tot', dir: -1 };
ctx.renderExp();
ok('months across, for the year chosen', heads(),
   ['Line', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', '%', '%', '%', '%', '%', '%', '%',
    'Year', '%', 'A year earlier', 'Change']
   .slice(0, 1).concat(
     ['Jan','Feb','Mar','Apr','May','Jun','Jul'].flatMap((m) => [m, '%']),
     ['Year', '%', 'A year earlier', 'Change']));
// 150 a month, seven months, against 1.400 the year before
ok('a month is a month, and the year totals them', rowOf('Admin').slice(0, 2), ['150', '15.0%']);
ok('with the year, last year and the change at the end',
   rowOf('Admin').slice(-4), ['1.050', '15.0%', '1.400', '(350)']);
ok('and the drill-down still works here', (() => {
  ctx.EXPOPEN = { line: 'P-400', acct: null };
  ctx.renderExp();
  return names('expacct');
})(), ['7000  Office costs', '7010  Professional fees']);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
