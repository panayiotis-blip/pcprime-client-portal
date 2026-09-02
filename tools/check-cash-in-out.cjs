/* FIX-3 §7. The shipped renderCashIO, against a hand-built month of banking.
   What is under test is the part a person would be misled by if it were wrong:
   that the closing balance follows from the opening balance and the movement,
   that a transfer between the client's own accounts is not counted as money in
   or out, that a figure names who is behind it, and that the categories put
   each receipt and payment where the work order says. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('public/reporting-app.js', 'utf8');

let bad = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) bad++;
  console.log((good ? '  ok   ' : '  FAIL ') + label
    + (good ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
};
const blockAt = (mark) => {
  const a = src.indexOf(mark);
  if (a < 0) throw new Error(mark + ' is not in the built app');
  const b = src.indexOf('\n/* ---------- ', a + mark.length);
  return src.slice(a, b < 0 ? src.length : b);
};

// The month spine is the months that HAVE postings — which is what
// ledger_months returns, and therefore what the real payload carries.
const M = ['2026-01', '2026-02'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Two bank accounts and a January of banking, written out so every figure below
// can be added up by hand. `line` is the report line of the OTHER side.
//   in:  customer 5.000 · a loan 2.000 · a VAT refund 300
//   out: suppliers 1.200 + 800 · payroll 900 · VAT 400 · an overhead 250
//   and 1.000 moved from the current account to the cash account
const ACC = [
  ['1000', 'Current account'],       // 0  bank
  ['1010', 'Cash account'],          // 1  bank
  ['4000', 'A customer'],            // 2  B-120
  ['5000', 'A supplier'],            // 3  B-210
  ['5001', 'Another supplier'],      // 4  B-210
  ['2200', 'Payroll control'],       // 5  B-220
  ['2500', 'VAT control'],           // 6  B-250
  ['4100', 'The bank'],              // 7  B-410
  ['7000', 'Office costs'],          // 8  P-400
];
const LINE = ['B-160', 'B-160', 'B-120', 'B-210', 'B-210', 'B-220', 'B-250', 'B-410', 'P-400'];
// and a quieter February, so the monthly average has something to average.
//        d  b  c     v      x
const R = [
  [0, 0, 2,  5000, 0],   // customer receipt
  [1, 0, 7,  2000, 0],   // loan received
  [2, 0, 6,   300, 0],   // VAT refund
  [3, 0, 3, -1200, 0],   // supplier
  [4, 0, 4,  -800, 0],   // another supplier
  [5, 0, 5,  -900, 0],   // payroll
  [6, 0, 6,  -400, 0],   // VAT paid
  [7, 0, 8,  -250, 0],   // an overhead
  [8, 0,-1, -1000, 1],   // moved to the cash account
  [8, 1,-1,  1000, 1],   // and arriving there
  [31, 0, 2, 1000, 0],   // February: a customer
  [32, 0, 3, -600, 0],   //           a supplier
  [33, 0, 8, -150, 0],   //           an overhead
];
const cashio = {
  ep: '2026-01-01',
  acc: ACC, line: LINE,
  rd: ['REF1'], td: ['a detail'], jr: ['BPM'],
  d: R.map((r) => r[0]), b: R.map((r) => r[1]), c: R.map((r) => r[2]),
  v: R.map((r) => r[3]), x: R.map((r) => r[4]),
  r: R.map(() => 0), t: R.map(() => 0), j: R.map(() => 0),
};

const html = {}, sel = { cioYear: '2026', cioBank: '' };
const listeners = {};
const node = (id) => ({
  get innerHTML() { return html[id] || ''; },
  set innerHTML(v) { html[id] = v; },
  get value() { return sel[id] === undefined ? '' : sel[id]; },
  set value(v) { sel[id] = v; },
  dataset: {},
  querySelectorAll(s) {
    // Only the clickable figures are ever asked for.
    const out = [];
    const re = /data-g="([^"]*)" data-m="([^"]*)"/g;
    let m;
    while ((m = re.exec(html[id] || ''))) {
      // Copied out of the match: `m` is reset to null when the loop ends, and
      // these are read later, when the handler is fired.
      const g = m[1], mm = m[2];
      out.push({
        dataset: { g, m: mm }, classList: { add() {} },
        addEventListener(ev, fn) { listeners[id + '|' + mm + '|' + g] = fn; },
      });
    }
    return out;
  },
  addEventListener() {},
});
const ctx = {
  console, M, NM: M.length, MN: MON, CID: 'c1',
  D: { cashio, cfg: {} },
  BS: (id) => id === 'B-160' ? [3750, 4000] : [0, 0],
  idx: (m) => M.indexOf(m),
  lbl: (m) => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4),
  eur: (v) => (v < 0 ? '(' : '') + Math.abs(Math.round(v)).toLocaleString('de-DE') + (v < 0 ? ')' : ''),
  notes: () => {},
  document: { getElementById: node },
};
vm.createContext(ctx);
vm.runInContext(blockAt('/* ---------- cash in and out (FIX-3'), ctx);

const rowOf = (t, name) => {
  const m = (t || '').match(new RegExp('<tr[^>]*><td>' + name + '</td>(.*?)</tr>'));
  return m ? (m[1].match(/<td[^>]*>(.*?)<\/td>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')) : null;
};
const jan = (r) => r && r[0];
const total = (r) => r && r[r.length - 2];

ctx.renderCashIO();
let t = html['tblCashIO'];

// ---- the categories -----------------------------------------------------
ok('a receipt from a customer', jan(rowOf(t, 'Customer receipts')), '5.000');
ok('a loan received', jan(rowOf(t, 'Loans received')), '2.000');
ok('a VAT refund is money in, not negative money out', jan(rowOf(t, 'VAT and tax refunds')), '300');
ok('suppliers, both of them', jan(rowOf(t, 'Suppliers')), '(2.000)');
ok('payroll', jan(rowOf(t, 'Payroll and contributions')), '(900)');
ok('VAT paid', jan(rowOf(t, 'VAT and taxes')), '(400)');
ok('an overhead lands on overheads', jan(rowOf(t, 'Overheads and costs')), '(250)');
ok('money in totals', jan(rowOf(t, 'Total money in')), '7.300');
ok('money out totals', jan(rowOf(t, 'Total money out')), '(3.550)');

// ---- a transfer is not money in or out ----------------------------------
ok('a transfer between the client\'s own accounts is not on the combined view',
   rowOf(t, "Between the client's own accounts"), null);
// 7.300 in less 3.550 out; the 1.000 moved nets to nothing across both accounts
ok('net movement ignores it', jan(rowOf(t, 'Net movement')), '3.750');
ok('closing balance follows the movement', jan(rowOf(t, 'Closing balance')), '3.750');

// ---- one account at a time ----------------------------------------------
sel['cioBank'] = '1';                       // the cash account only
ctx.renderCashIO();
t = html['tblCashIO'];
ok('on one account the transfer IS real money',
   jan(rowOf(t, "In or out of the client's own accounts")), '1.000');
ok('and it is all that account did', jan(rowOf(t, 'Net movement')), '1.000');
ok('with nothing in or out', [jan(rowOf(t, 'Total money in')), jan(rowOf(t, 'Total money out'))],
   ['—', '—']);

sel['cioBank'] = '0';                       // the current account
ctx.renderCashIO();
t = html['tblCashIO'];
ok('the account that paid it out shows the other side',
   jan(rowOf(t, "In or out of the client's own accounts")), '(1.000)');
ok('and its net movement is the lot', jan(rowOf(t, 'Net movement')), '2.750');
sel['cioBank'] = '';

// ---- the monthly average -------------------------------------------------
ctx.renderCashIO();
t = html['tblCashIO'];
const heads = (t.split('</thead>')[0].match(/<th[^>]*>(.*?)<\/th>/g) || [])
  .map((x) => x.replace(/<[^>]+>/g, ''));
ok('there is a monthly average column', heads[heads.length - 1], 'Monthly average');
// 5.000 in January and 1.000 in February, so 3.000 a month over the two shown.
ok('and it averages every month shown',
   rowOf(t, 'Customer receipts'), ['5.000', '1.000', '6.000', '3.000']);
ok('the total column adds the months shown, and the average divides them',
   rowOf(t, 'Suppliers'), ['(2.000)', '(600)', '(2.600)', '(1.300)']);

ok('February opens where January closed',
   rowOf(t, 'Opening balance').slice(0, 2), ['—', '3.750']);
ok('and closes where the balance sheet says it does',
   rowOf(t, 'Closing balance').slice(0, 2), ['3.750', '4.000']);

// ---- the largest twenty --------------------------------------------------
ok('the largest twenty payments are listed', /The largest twenty payments/.test(html['cioWho']), true);
const bigCard = html['cioWho'].slice(html['cioWho'].indexOf('The largest twenty payments'));
const paidTo = [];
{
  const re = /<tr><td class="mono">[^<]*<\/td><td>([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(bigCard))) paidTo.push(m[1]);
}
// the last month shown is February, and its two payments in size order
ok('largest first, for the last month shown', paidTo, ['A supplier', 'Office costs']);
ok('and the transfer is not among them', paidTo.indexOf("Between the client's own accounts"), -1);

// ---- pressing a figure answers "who" -------------------------------------
ctx.renderCashIO();
const fire = listeners['tblCashIO|2026-01|out-supp'];
ok('a figure can be pressed', typeof fire, 'function');
fire();
ok('and it names who is behind it',
   /A supplier/.test(html['cioWho']) && /Another supplier/.test(html['cioWho']), true);
ok('with the journal reference so it can be found in BTMS',
   /BPM/.test(html['cioWho']) && /REF1/.test(html['cioWho']), true);
ok('and it says which figure it is explaining',
   /Suppliers — Jan 26/.test(html['cioWho']), true);

// ---- a client with no bank account at all --------------------------------
ctx.D.cashio = { ep: null, acc: [], line: [], v: [] };
ctx.CID = 'c2';
ctx.renderCashIO();
ok('no bank postings is explained, not an error',
   /nothing to list. That is not an error/.test(html['tblCashIO']), true);

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
