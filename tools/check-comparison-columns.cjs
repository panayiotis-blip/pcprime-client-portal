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
/* Enough of a DOM for the controls to register their handlers and for a test to
   fire one. Elements are built from the markup the code just wrote and cached
   until it writes again, so what the test clicks or types into is the same
   object the code bound its listener to — which is the whole point. */
// Handlers are given a real-looking event: the control reads e.target.value.
const fire = (el, ev) => (el.listeners[ev] || []).slice().forEach((f) => f({ target: el }));
const elems = {};                 // id -> {sel -> element[]}
const build = (id, sel) => {
  const out = [];
  const tag = /<(input|button|span|select)\b([^>]*)>/g;
  let m;
  while ((m = tag.exec(html[id] || ''))) {
    const at = m[2];
    const cls = (at.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/);
    if (cls.indexOf(sel.slice(1)) < 0) continue;
    const dataset = {};
    let d; const dre = /data-([a-z]+)="([^"]*)"/g;
    while ((d = dre.exec(at))) dataset[d[1]] = d[2];
    const listeners = {};
    out.push({
      dataset, listeners,
      value: (at.match(/value="([^"]*)"/) || [, ''])[1],
      textContent: '',
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      focus() {}, select() {}, blur() { fire(this, "change"); },
    });
  }
  return out;
};
const all = (id, sel) => {
  const per = elems[id] = elems[id] || {};
  if (!per[sel]) per[sel] = build(id, sel);
  return per[sel];
};
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; elems[id] = {}; },
  querySelectorAll(sel) { return all(id, sel); },
  querySelector(sel) {
    // Only ever asked for '.cmpadd' or one keyed cell by its two data values.
    const m = sel.match(/^\.keyin\[data-k="([^"]*)"\]\[data-l="([^"]*)"\]$/);
    if (m) return all(id, '.keyin').filter((x) => x.dataset.k === m[1] && x.dataset.l === m[2])[0] || null;
    return all(id, sel)[0] || { addEventListener() {} };
  },
  addEventListener() {},
});
const press = (id, sel, i) => {
  const el = all(id, sel)[i];
  if (!el) throw new Error('no ' + sel + ' ' + i + ' in ' + id);
  fire(el, "click");
  return el;
};
const typeInto = (id, sel, i, v) => {
  const el = all(id, sel)[i];
  if (!el) throw new Error('no ' + sel + ' ' + i + ' in ' + id);
  el.value = v;
  fire(el, "change");
  return el;
};

const ctx = {
  console, M, NM,
  D: { cfg: { yearEnd: 12 }, lines: [
    { id: 'B-010', name: 'Fixed assets' }, { id: 'B-110', name: 'Debtors' },
    { id: 'B-210', name: 'Creditors' }, { id: 'B-410', name: 'Long-term loans' },
    { id: 'B-610', name: 'Share capital' }, { id: 'B-640', name: 'Reserves' },
    { id: 'B-650', name: 'Profit for the period' } ],
    // One column already keyed against Jan-Jul 2026 and saved.
    keyed: [{ from: '2026-01', to: '2026-07', name: 'Target', amounts: { 'P-100': 900 } }] },
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
  // The keyed column needs a client to belong to and a host to post to.
  CID: 'c1754',
  POSTED: [],
  parent: { postMessage(m) { ctx.POSTED.push(m); } },
  window: {},
  alert: () => {},
  document: { getElementById: node },
};
vm.createContext(ctx);
// KEYFOCUS and keyNum sit above renderPl and belong to it.
const preFrom = src.indexOf('/* Where the cursor should land');
const preTo = src.indexOf('function renderPl(');
if (preFrom < 0 || preFrom > preTo) throw new Error('the renderPl preamble is not where it was');
const plPre = src.slice(preFrom, preTo);

// The expenses screen keeps its view state and its column helpers above the
// function, the way the profit and loss keeps KEYFOCUS above renderPl.
const expFrom = src.indexOf('/* Expense analysis (FIX-3');
const expTo = src.indexOf('function renderExp(');
if (expFrom < 0 || expFrom > expTo) throw new Error('the renderExp preamble is not where it was');
const expPre = src.slice(expFrom, expTo);

vm.runInContext([cmpBlock, grab('lblShort'), plPre, grab('renderPl'), grab('renderBs'),
                 expPre, grab('renderExp')].join('\n'), ctx);

const strip = (s) => s.replace(/<[^>]+>/g, '').split('').filter(Boolean);
// CMP is a lexical const inside the sandbox, so reach it by evaluating its name.
const CMP = vm.runInContext('CMP', ctx);

// Only the statement's own heading row: the balance sheet grew a second table
// under it in FIX-3 §6, and its headings are not this table's.
const heads = (t) => ((t.split('</thead>')[0] || '').match(/<th[^>]*>(.*?)<\/th>/g) || [])
  .map(x => x.replace(/<[^>]+>/g, ''));
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
// FIX-3 §8 rebuilt this screen: the sparkline is gone, the columns are the
// same comparison list, and the line names now carry a twist to open them.
ok('exp headings', heads(t),
   ['Line', 'Jan 26–Jul 26', '%', 'Jan 25–Jul 25', '%', 'Jul 26 vs Jul 25',
    'Jan 24–Jul 24', '%', 'Jul 25 vs Jul 24']);
// admin is 7 a month throughout, so seven months is 49 in every year and nothing moves
ok('exp admin across three years', rowOf(t, '<span class="twist">▸</span>Admin'),
   ['49', '5.8%', '49', '6.4%', '0', '49', '7.0%', '0']);

// =====================================================================
// FIX-3 §3 — a column the partner types into
// =====================================================================
const keyed = () => all('tblPl', '.keyin');
const valueOf = (line) => (keyed().filter((x) => x.dataset.l === line)[0] || {}).value;

// --- picking the one already saved against this period ---
CMP['pl'] = [];
ctx.renderPl();
typeInto('plCmpBar', '.cmpadd', 0, 'h:Target');
ok('a saved column is offered and added', CMP['pl'], [{ kind: 'hand', name: 'Target' }]);
ok('the column says it is keyed, in its heading', heads(html['tblPl']),
   ['Line', 'Jan 26–Jul 26', '%', 'Target keyed', '%', 'Jul 26 vs Target', '%']);
ok('what was keyed is in the box', valueOf('P-100'), '900');
ok('a line never keyed is an empty box, not a nought', valueOf('P-400'), '');
// 840 of sales against a target of 900, so 60 short
ok('the movement is computed against it', rowOf(html['tblPl'], 'Total revenue'),
   ['840', '100.0%', '900', '100.0%', '(60)', '-6.7%']);

// --- every line is offered, including ones the ledger has never touched ---
ok('nil lines are shown while a column is being typed',
   /<td>Sundry<\/td>/.test(html['tblPl']), true);

// --- typing moves the arithmetic, and the practice's number format is read ---
typeInto('tblPl', '.keyin', keyed().findIndex((x) => x.dataset.l === 'P-200'), '1.234,56');
ok('1.234,56 is read as 1234,56', rowOf(html['tblPl'], 'Total cost of sales').slice(2, 3), ['1.234,56']);
typeInto('tblPl', '.keyin', keyed().findIndex((x) => x.dataset.l === 'P-200'), '1234.56');
ok('1234.56 is read the same way', rowOf(html['tblPl'], 'Total cost of sales').slice(2, 3), ['1.234,56']);
typeInto('tblPl', '.keyin', keyed().findIndex((x) => x.dataset.l === 'P-200'), '1.234');
ok('1.234 is read as a thousand', rowOf(html['tblPl'], 'Total cost of sales').slice(2, 3), ['1.234']);
// 900 of revenue less 1.234 of cost, nothing else keyed
ok('profit before tax follows what was keyed',
   rowOf(html['tblPl'], 'Profit before tax').slice(2, 3), ['(334)']);

// --- a blank is not a nought ---
typeInto('tblPl', '.keyin', keyed().findIndex((x) => x.dataset.l === 'P-200'), '');
ok('clearing a line takes it out of the column',
   rowOf(html['tblPl'], 'Total cost of sales').slice(2, 3), ['—']);
ok('and the total is what is left', rowOf(html['tblPl'], 'Profit before tax').slice(2, 3), ['900']);

// --- Save posts it against the client and the period it was keyed against ---
ctx.POSTED.length = 0;
press('plCmpBar', '.cmpsave', 0);
ok('Save posts one message', ctx.POSTED.length, 1);
ok('with the client, the period and the name', {
  type: ctx.POSTED[0].type, key: ctx.POSTED[0].key,
  from: ctx.POSTED[0].from, to: ctx.POSTED[0].to, name: ctx.POSTED[0].name,
  amounts: ctx.POSTED[0].amounts,
}, { type: 'pcp-keyed-save', key: 'c1754', from: '2026-01', to: '2026-07',
     name: 'Target', amounts: { 'P-100': 900 } });

// --- renaming makes a second column and leaves the first alone ---
typeInto('plCmpBar', '.cmpname', 0, 'Discussed 3 Sep');
ok('the partner names it', CMP['pl'], [{ kind: 'hand', name: 'Discussed 3 Sep' }]);
ok('and it is named in the heading', heads(html['tblPl'])[3], 'Discussed 3 Sep keyed');

// --- the same column against a different period is not the same column ---
PLRANGE = [24, 35];   // Jan 26 to Dec 26
ctx.renderPl();
ok('a target for seven months is not a target for twelve',
   heads(html['tblPl']).slice(3, 4), ['Discussed 3 Sep']);
ok('and it says why', /not keyed for this period/.test(html['plCmpBar']), true);
PLRANGE = [24, 30];

// --- Forget appears only once there is something saved to forget ---
ctx.renderPl();
ok('a renamed column has nothing to forget yet', all('plCmpBar', '.cmpforget').length, 0);
press('plCmpBar', '.cmpsave', 0);
ok('once saved, it can be forgotten', all('plCmpBar', '.cmpforget').length, 1);

// --- and Forget needs two presses ---
ctx.POSTED.length = 0;
press('plCmpBar', '.cmpforget', 0);
ok('one press only arms it', ctx.POSTED.length, 0);
press('plCmpBar', '.cmpforget', 0);
ok('the second posts the delete', (ctx.POSTED[0] || {}).type, 'pcp-keyed-delete');

// --- it never reaches the balance sheet ---
CMP['bs'] = [{ kind: 'hand', name: 'Target' }];
ctx.renderBs();
ok('the balance sheet refuses a keyed column, and says so',
   /keyed columns are on the profit and loss/.test(html['bsCmpBar']), true);
ok('and it prints nothing rather than noughts', rowOf(html['tblBs'], 'Debtors'), ['230', '—', '—']);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
