// Build the template's data payload from the database.
//
// BUILD.md §4: template-app.built_5.html is a complete, working implementation
// and a prototype in exactly two respects — its data is embedded JSON rather
// than queried, and its per-user state is in browser storage. Everything else
// is the specification. So this does not rebuild its screens. It produces the
// JSON the template already knows how to read, from real data.
//
// It runs in the browser, in the signed-in session, for one reason: every read
// then goes through RLS exactly as any other screen's does. Nothing here can
// see what the application could not, and no credential has to exist anywhere
// for it to work.
//
// The shape, learned from the template itself:
//
//   months    ['2021-01', …]                   the spine; everything aligns to it
//   lines     [{id, st, sec, name, sub}]       the 87 master report lines
//   pl        {lineId: [movement per month]}
//   bs        {lineId: [position per month]}   cumulative, from bsOpen
//   bsOpen    {lineId: position before months[0]}
//   accounts  [{code, name, line, m: [...]}]
//   post      dictionary-compressed columnar postings
//   exceptions[{sev, check, desc, amt, month, acct, aname, line, jrn, jno,
//              batch, ref, date, note}]
//
// `post` is why the template is 3,3MB rather than 60: acc, jrn, td and rd are
// dictionaries and a/d/r/t/v/j are indices into them, one entry per posting.

import { supabase } from '../../../lib/supabase';
import { allRows } from '../import/pages.ts';

const rep = () => supabase.schema('reporting');

const monthKey = (iso: string) => String(iso).slice(0, 7);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Hand the browser back its thread.
 *
 * The posting loop runs 174.026 times and used to hold the main thread for the
 * whole of it, on top of a 7MB stringify and a 3,3MB fetch. The page froze —
 * no progress, no paint, and twice the tab stopped answering altogether. A
 * yield every few thousand rows costs a little time and keeps the thing alive
 * and honest about how far it has got.
 */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const YIELD_EVERY = 5000;

/** Sections whose natural balance is a credit, so a report shows them positive. */
const CREDIT_SECTIONS = new Set([
  'Revenue', 'Other income', 'Current liabilities', 'Non-current liabilities', 'Equity',
]);

export type BuildProgress = (step: string, done?: number, total?: number) => void;

export type ClientBlock = Record<string, unknown>;

export type BuildResult = {
  block: ClientBlock;
  generated: string;
  months: number;
  postings: number;
  accounts: number;
  exceptions: number;
  trialBalances: number;
  openingFrom: string | null;
  sectionsOff: string[];
};

export async function buildClientBlock(
  clientId: number,
  onProgress: BuildProgress = () => {},
): Promise<BuildResult> {
  onProgress('Reading the client');
  const { data: client, error: cErr } = await supabase
    .from('clients').select('id, name, client_code').eq('id', clientId).single();
  if (cErr) throw new Error(`client: ${cErr.message}`);
  const c = client as { id: number; name: string; client_code: string | null };

  const { data: settingsRow } = await rep().from('client_settings')
    .select('year_end_month, currency, report_name').eq('client_id', clientId).maybeSingle();
  const settings = settingsRow as
    { year_end_month: number; currency: string; report_name: string | null } | null;

  onProgress('Reading the months held');
  const { data: lm, error: lmErr } = await rep().rpc('ledger_months', { p_client: clientId });
  if (lmErr) throw new Error(`ledger_months: ${lmErr.message}`);
  const months = ((lm ?? []) as { period_month: string }[]).map((r) => monthKey(r.period_month));
  if (!months.length) throw new Error('This client has no postings, so there is nothing to build.');
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  onProgress('Reading the report lines');
  const { data: tpl } = await rep().from('templates')
    .select('id').eq('kind', 'report_lines').is('client_id', null).limit(1).maybeSingle();
  if (!tpl) throw new Error('The master report lines are missing (migration 197).');
  const { data: rlData, error: rlErr } = await rep().from('report_lines')
    .select('line_id, statement, section, line_name, sort_order, is_subtotal')
    .eq('template_id', (tpl as { id: number }).id).order('sort_order');
  if (rlErr) throw new Error(`report_lines: ${rlErr.message}`);
  const rl = (rlData ?? []) as {
    line_id: string; statement: string; section: string; line_name: string; is_subtotal: boolean;
  }[];

  const lines = rl.map((l) => ({
    id: l.line_id,
    st: l.statement === 'pl' ? 'Profit & Loss' : 'Balance Sheet',
    sec: l.section,
    name: l.line_name,
    sub: l.is_subtotal ? 1 : 0,
  }));
  const lineSection = new Map(rl.map((l) => [l.line_id, l]));

  onProgress('Reading the chart of accounts');
  const coa = await allRows<{ code: string; name: string; control_code: string | null }>(
    (f, t) => rep().from('coa_accounts').select('code, name, control_code')
      .eq('client_id', clientId).range(f, t));
  const byCode = new Map(coa.map((a) => [String(a.code), a]));
  const controlOf = (code: string) => {
    const a = byCode.get(code);
    return a && a.control_code ? String(a.control_code) : code;
  };

  onProgress('Reading the mapping');
  const defaults = await allRows<{ account_code: string; line_id: string | null }>(
    (f, t) => rep().from('mapping_defaults').select('account_code, line_id')
      .eq('client_id', clientId).range(f, t));
  const overrides = await allRows<{ account_code: string; line_id: string }>(
    (f, t) => rep().from('mappings').select('account_code, line_id')
      .eq('client_id', clientId).range(f, t));
  const lineFor = new Map<string, string | null>(
    defaults.map((d) => [String(d.account_code), d.line_id]));
  for (const o of overrides) lineFor.set(String(o.account_code), o.line_id);

  // Every posting, in one call, already dictionary-compressed (migration 200).
  //
  // Read as rows through PostgREST instead, the policy on postings is evaluated
  // ONCE PER ROW — 174.026 times a page, 175 pages — and the request dies on
  // the statement timeout. The function checks access once and lets the
  // database do the packing, which is also what the template wants anyway.
  onProgress('Reading the postings');
  const { data: packed, error: pkErr } = await rep()
    .rpc('postings_columnar', { p_client: clientId });
  if (pkErr) throw new Error(`postings: ${pkErr.message}`);
  const post = packed as {
    ep: string | null;
    acc: [string, string][]; jrn: string[]; rd: string[]; td: string[];
    a: number[]; d: number[]; r: number[]; t: number[]; v: number[]; j: number[];
  };
  if (!post?.ep) throw new Error('This client has no postings, so there is nothing to build.');

  // The statements are rebuilt from the packed form: the account, the date and
  // the value of every posting are all in it, so nothing else needs fetching.
  onProgress('Building the statements', 0, post.v.length);
  const zeros = () => new Array(months.length).fill(0) as number[];
  const pl: Record<string, number[]> = {};
  const bsMove: Record<string, number[]> = {};
  const acctSeries = new Map<string, number[]>();

  const epMsBase = Date.parse(post.ep + 'T00:00:00Z');
  const monthOfIndex = new Map<number, number>();   // day offset -> month index
  const codeOfAcc = post.acc.map((x) => String(x[0]));
  const controlOfAcc = codeOfAcc.map((c) => controlOf(c));

  for (let i = 0; i < post.v.length; i++) {
    if (i > 0 && i % YIELD_EVERY === 0) {
      onProgress('Building the statements', i, post.v.length);
      await breathe();
    }
    const day = post.d[i];
    let mi = monthOfIndex.get(day);
    if (mi === undefined) {
      mi = monthIndex.get(monthKey(new Date(epMsBase + day * 86400000).toISOString())) ?? -1;
      monthOfIndex.set(day, mi);
    }
    if (mi < 0) continue;
    const net = post.v[i];
    const rc = controlOfAcc[post.a[i]];

    let s = acctSeries.get(rc);
    if (!s) { s = zeros(); acctSeries.set(rc, s); }
    s[mi] += net;

    const lineId = lineFor.get(rc);
    if (!lineId) continue;                       // deliberately not reported
    const l = lineSection.get(lineId);
    if (!l) continue;
    const signed = CREDIT_SECTIONS.has(l.section) ? -net : net;
    const target = l.statement === 'pl' ? pl : bsMove;
    if (!target[lineId]) target[lineId] = zeros();
    target[lineId][mi] += signed;
  }

  // ---- the opening position ------------------------------------------
  // The ledger holds no opening balances — A&F's 3999 TAKE ON BALANCES has no
  // postings and the first posting is 1 January 2021. A trial balance is a
  // position, so where one exists the opening follows from it:
  //
  //     opening = trial balance closing − movement up to that month
  //
  // Without one the opening is nil, and the balance sheet is movement since
  // the first month held. The app says which of the two it is rather than
  // leaving a reader to assume.
  onProgress('Reading the trial balances');
  type TB = {
    period_month: string; is_annual: boolean; account_code: string; account_name: string | null;
    account_type: string | null; opening: number; debit: number; credit: number; closing: number;
  };
  // Every trial balance, annual as well as monthly. Reading only the monthly
  // ones left A&F's 2024 and 2025 year-ends imported but invisible — the app
  // said "1 trial balance" while the database held three.
  const tbRows = await allRows<TB>((f, t) => rep().from('trial_balance')
    .select('period_month, is_annual, account_code, account_name, account_type, opening, debit, credit, closing')
    .eq('client_id', clientId).eq('detailed', false).range(f, t));

  // The opening is derived from a MONTHLY one: a year-end names a month too,
  // and taking the later of the two kinds could read a December year-end as
  // though it were that December's month-end.
  const monthlyTb = tbRows.filter((r) => !r.is_annual);

  const bsOpen: Record<string, number> = {};
  let openingFrom: string | null = null;
  if (monthlyTb.length) {
    const tbMonth = monthlyTb.map((r) => monthKey(r.period_month)).sort().pop()!;
    const at = monthIndex.get(tbMonth);
    if (at !== undefined) {
      openingFrom = tbMonth;
      const closeByLine: Record<string, number> = {};
      for (const r of monthlyTb) {
        if (monthKey(r.period_month) !== tbMonth) continue;
        const lineId = lineFor.get(controlOf(String(r.account_code)));
        if (!lineId) continue;
        const l = lineSection.get(lineId);
        if (!l || l.statement !== 'bs') continue;
        const signed = CREDIT_SECTIONS.has(l.section) ? -Number(r.closing) : Number(r.closing);
        closeByLine[lineId] = (closeByLine[lineId] ?? 0) + signed;
      }
      for (const [lineId, close] of Object.entries(closeByLine)) {
        const moved = (bsMove[lineId] ?? zeros()).slice(0, at + 1).reduce((a, b) => a + b, 0);
        bsOpen[lineId] = round2(close - moved);
      }
    }
  }

  const bs: Record<string, number[]> = {};
  for (const [lineId, series] of Object.entries(bsMove)) {
    const out = zeros();
    let running = bsOpen[lineId] ?? 0;
    for (let i = 0; i < months.length; i++) { running += series[i]; out[i] = round2(running); }
    bs[lineId] = out;
  }
  for (const [lineId, arr] of Object.entries(pl)) pl[lineId] = arr.map(round2);

  const accounts = [...acctSeries.entries()]
    .map(([code, m]) => ({
      code,
      name: byCode.get(code)?.name ?? '',
      line: lineFor.get(code) ?? '',
      m: m.map(round2),
    }))
    .filter((a) => a.m.some((v) => Math.abs(v) >= 0.005))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // ---- VAT ------------------------------------------------------------
  // No feed of its own: every posting carries its code, rate and amount, and
  // §6.3 says the ledger is what a return is compared against. Migration 201
  // applies the box rules — the journal decides the side, the base decides the
  // sign, and reverse charge raises a notional output equal to its input.
  onProgress('Working out the VAT');
  const { data: vatData, error: vatErr } = await rep().rpc('vat_figures', { p_client: clientId });
  if (vatErr) throw new Error(`vat_figures: ${vatErr.message}`);
  const vatOut = (vatData ?? {}) as {
    monthly?: Record<string, Record<string, number>>;
    quarters?: { q: string; codes: Record<string, unknown>; box1: number; box2: number; box3: number; box4: number; box5: number }[];
  };
  const vat = vatOut.monthly ?? {};
  const vatq = vatOut.quarters ?? [];

  // ---- stock ----------------------------------------------------------
  // Stored with the ledger figure beside it, so the difference §6.6 insists on
  // is a fact recorded at import rather than something recomputed later
  // against a mapping that may since have changed.
  onProgress('Reading the stock valuations');
  const stockRows = await allRows<{
    valued_at: string; items: number; units: number; value: number;
    ledger_value: number | null; negative_items: number | null; negative_value: number | null;
    file_path: string | null;
  }>((f, t) => rep().from('stock_valuations')
    .select('valued_at, items, units, value, ledger_value, negative_items, negative_value, file_path')
    .eq('client_id', clientId).order('valued_at').range(f, t));
  // The name the file was given, not the name it was stored under. Storage
  // paths are the sha256, so the last segment of one is a checksum, and the
  // template was showing "0fdea8c827….xls" where a person needs
  // "a&f stock valuation 31-12-2024.xls".
  const stockImports = await allRows<{ storage_path: string | null; original_filename: string | null }>(
    (f, t) => rep().from('imports').select('storage_path, original_filename')
      .eq('client_id', clientId).eq('feed', 'stock').eq('status', 'committed').range(f, t));
  const nameOfPath = new Map(
    stockImports.filter((i) => i.storage_path).map((i) => [String(i.storage_path), i.original_filename ?? '']),
  );

  const stock = stockRows.map((s) => ({
    date: String(s.valued_at),
    file: nameOfPath.get(String(s.file_path ?? '')) ?? '',
    items: Number(s.items),
    units: Number(s.units),
    value: Number(s.value),
    footer: [Number(s.items), Number(s.units), Number(s.value)],
    ledger: Number(s.ledger_value ?? 0),
    diff: round2(Number(s.value) - Number(s.ledger_value ?? 0)),
    neg: Number(s.negative_items ?? 0),
    negval: Number(s.negative_value ?? 0),
    zero: 0,
  }));

  // ---- payroll ---------------------------------------------------------
  // The template shows one month: the latest held, with its departments, its
  // employees and the grand totals.
  onProgress('Reading the payroll');
  const payPeriods = await allRows<{
    period: string; employees: number | null;
    gross: number | null; deductions: number | null; contributions: number | null;
    net: number | null; cost: number | null; gross_ytd: number | null; cost_ytd: number | null;
  }>((f, t) => rep().from('payroll_periods')
    .select('period, employees, gross, deductions, contributions, net, cost, gross_ytd, cost_ytd')
    .eq('client_id', clientId).order('period').range(f, t));

  let payroll: Record<string, unknown> = {};
  if (payPeriods.length) {
    const latest = payPeriods[payPeriods.length - 1];
    const payLines = await allRows<{
      scope: string; ref: string; name: string | null; headcount: number | null;
      rate: number | null; hours: number | null;
      gross: number | null; deductions: number | null; contributions: number | null;
      net: number | null; cost: number | null; gross_ytd: number | null; cost_ytd: number | null;
      detail: Record<string, unknown> | null;
    }>((f, t) => rep().from('payroll_lines')
      .select('scope, ref, name, headcount, rate, hours, gross, deductions, contributions, net, cost, gross_ytd, cost_ytd, detail')
      .eq('client_id', clientId).eq('period', latest.period).range(f, t));

    const pair = (now: number | null, ytd: number | null): [number, number] =>
      [Number(now ?? 0), Number(ytd ?? 0)];

    const deps = payLines.filter((l) => l.scope === 'department').map((l) => ({
      dep: l.ref,
      earn: (l.detail?.earn ?? {}) as Record<string, [number, number]>,
      ded: (l.detail?.ded ?? {}) as Record<string, [number, number]>,
      con: (l.detail?.con ?? {}) as Record<string, [number, number]>,
      tr: (l.detail?.tr ?? {}) as Record<string, [number, number]>,
      gross: pair(l.gross, l.gross_ytd),
      cost: pair(l.cost, l.cost_ytd),
      emps: Number(l.headcount ?? 0),
    }));

    const emps = payLines.filter((l) => l.scope === 'employee').map((l) => ({
      code: l.ref,
      name: l.name ?? '',
      rate: Number(l.rate ?? 0),
      hours: Number(l.hours ?? 0),
      basic: Number((l.detail?.basic as number) ?? 0),
      earn: (l.detail?.earn ?? {}) as Record<string, number>,
      ded: (l.detail?.ded ?? {}) as Record<string, number>,
      con: (l.detail?.con ?? {}) as Record<string, number>,
      tr: (l.detail?.tr ?? {}) as Record<string, number>,
      gross: Number(l.gross ?? 0),
      dedT: Number(l.deductions ?? 0),
      conT: Number(l.contributions ?? 0),
      cost: Number(l.cost ?? 0),
      net: Number(l.net ?? 0),
    }));

    payroll = {
      period: String(latest.period).slice(5, 7) + '/' + String(latest.period).slice(0, 4),
      deps,
      emps,
      tot: { dep: 'TOTALS' },
      grand: {
        gross: Number(latest.gross ?? 0),
        dedT: Number(latest.deductions ?? 0),
        conT: Number(latest.contributions ?? 0),
        cost: Number(latest.cost ?? 0),
        net: Number(latest.net ?? 0),
        grossY: Number(latest.gross_ytd ?? 0),
        costY: Number(latest.cost_ytd ?? 0),
      },
    };
  }

  onProgress('Reading the review findings');
  type Ex = {
    sev: string; check_name: string; description: string; amount: number | null;
    month: string | null; account: string | null; report_line: string | null;
    journal: string | null; journal_no: string | null; batch: string | null;
    reference: string | null; txn_date: string | null; detail: string | null;
  };
  const ex = await allRows<Ex>((f, t) => rep().from('exceptions')
    .select('sev, check_name, description, amount, month, account, report_line, journal, journal_no, batch, reference, txn_date, detail')
    .eq('client_id', clientId).range(f, t));
  const exceptions = ex.map((e) => ({
    sev: e.sev,
    check: e.check_name,
    desc: e.description,
    amt: e.amount === null ? 0 : Number(e.amount),
    month: e.month ? monthKey(e.month) : '',
    acct: e.account ?? '',
    aname: e.account ? (byCode.get(String(e.account))?.name ?? '') : '',
    line: e.report_line ? (lineSection.get(e.report_line)?.line_name ?? e.report_line) : '',
    jrn: e.journal ?? '',
    jno: e.journal_no ?? '',
    batch: e.batch ?? '',
    ref: e.reference ?? '',
    date: e.txn_date
      ? new Date(e.txn_date + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' })
      : '',
    note: e.detail ?? '',
  }));

  const tbByPeriod = new Map<string, unknown[]>();
  for (const r of tbRows) {
    const k = monthKey(r.period_month) + (r.is_annual ? "|Y" : "");
    if (!tbByPeriod.has(k)) tbByPeriod.set(k, []);
    tbByPeriod.get(k)!.push({
      code: String(r.account_code), name: r.account_name ?? '', type: r.account_type ?? '',
      open: Number(r.opening), deb: Number(r.debit), cre: Number(r.credit), close: Number(r.closing),
    });
  }
  // A year-end and a month-end can name the same month, so they are keyed
  // apart above and labelled apart here. "December 2025" and "Year ended
  // December 2025" are not the same statement and must not collapse into one.
  const tb = [...tbByPeriod.entries()].sort().map(([key, rows]) => {
    const period = key.slice(0, 7);
    const annual = key.endsWith('|Y');
    const when = new Date(period + '-01T00:00:00Z')
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return {
      period,
      label: annual ? `Year ended ${when}` : when,
      file: '',
      rows,
    };
  });

  // A section with no feed behind it is switched OFF rather than shown empty.
  // BUILD.md §8: a switched-off section is hidden from the rail.
  const features: Record<string, number> = {
    pl: 1, bs: 1, summary: 1, expenses: 1, sales: 1,
    ledgers: 1, accounts: 1, stmt: 1, trans: 1, mapping: 1, data: 1, review: 1,
    vat: 1,
    // On only when there is something behind them.
    stock: stock.length ? 1 : 0,
    payroll: Object.keys(payroll).length ? 1 : 0,
    budget: 0, cash: 0, cashmove: 0, projects: 0, audit: 0,
  };

  const name = settings?.report_name || c.name;
  const payload = {
    generated: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    clients: {
      c: {
        client: name,
        months, lines, pl, bs, bsOpen, accounts, post, exceptions, tb, vat, vatq, stock, payroll,
        postings: post.v.length,
        counts: { postings: post.v.length, accounts: accounts.length },
        cfg: {
          name,
          short: c.client_code || name.slice(0, 12),
          yearEnd: settings?.year_end_month ?? 12,
          currency: settings?.currency ?? 'EUR',
          features,
          notes: openingFrom
            ? `Opening balances derived from the ${openingFrom} trial balance.`
            : 'No trial balance imported: the balance sheet is movement since the first month held, not a position.',
        },
        vatFiled: [], deb: [], cre: [],
        agetot: {}, ageHist: {}, ageFlags: {}, cashflow: [], cashmove: {}, cashjrn: {},
        budget: {}, audit: {}, untagged: [], projects: [],
      },
    },
    order: ['c'],
  };

  // The stringify is a second or so of held thread on a client this size, so
  // the progress line is put up first and the browser given a chance to paint
  // it. Otherwise the page appears to have died at the very last step.
  onProgress('Writing it out');
  await breathe();

  return {
    block: payload.clients.c,
    generated: payload.generated,
    months: months.length,
    postings: post.v.length,
    accounts: accounts.length,
    exceptions: exceptions.length,
    trialBalances: tb.length,
    openingFrom,
    sectionsOff: Object.entries(features).filter(([, v]) => !v).map(([k]) => k),
  };
}

/**
 * The template with this client's data in it, as a file.
 * The template is served from public/ so the browser can read it back.
 *
 * A charset is declared even if the template does not carry one, and the blob
 * is typed with it. template-app.built_5.html begins at <title> with no <head>
 * and no <meta charset>, which is harmless when a server sends the charset in
 * a header and wrong the moment the file is opened from disk: the browser
 * guesses, guesses Latin-1, and ΑΝΤΩΝΗΣ & ΦΟΥΛΗΣ ΗΛΕΚΤΡΑΓΟΡΑ ΛΤΔ becomes
 * mojibake. Every Greek client name in the register would have done the same.
 */
export async function buildTemplateHtml(json: string, opts: { lazy?: boolean } = {}): Promise<Blob> {
  const res = await fetch('/reporting-template.html');
  if (!res.ok) {
    throw new Error(
      'The template is not being served. Copy template-app.built_5.html to public/reporting-template.html.',
    );
  }
  const html = await res.text();
  const open = html.indexOf('<script id="afdata" type="application/json">');
  if (open < 0) throw new Error('That template has no afdata block.');
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);

  const declaresCharset = /<meta[^>]+charset/i.test(html.slice(0, 4000));
  const head = declaresCharset ? '' : '<meta charset="utf-8">\n';

  const tail = html.slice(end);
  const rest = opts.lazy ? withLazyLoader(tail) : tail;

  return new Blob(
    [head, html.slice(0, start), json, rest],
    { type: 'text/html;charset=utf-8' },
  );
}

/**
 * Ask the portal for a client's figures at sign-in, instead of carrying every
 * client's figures into the page.
 *
 * §4 says the template's layout and wording are the specification, and this
 * does not touch either. It changes the one thing §4 names as prototype: the
 * data is embedded rather than queried. Sixty-three clients and 174.026
 * postings cannot all be read before a sign-in screen that needs sixty-three
 * NAMES, and the app appeared to hang because it tried.
 *
 * Nothing in the template is rewritten. A capture-phase listener on its own
 * Sign in button runs first, fetches the chosen client, drops it into ALL, and
 * then lets the click through — so the template's own signIn() does the work it
 * always did, against data that is there by the time it looks.
 */
function withLazyLoader(tail: string): string {
  const shim = `
<script>
(function(){
  // Opened on its own, with no portal behind it, there is nobody to ask. Better
  // to sign in against the empty block and say so than to hang on a question
  // that will never be answered.
  if (parent === window) return;

  var loaded = {};

  function ask(key){
    return new Promise(function(resolve, reject){
      var timer = setTimeout(function(){
        window.removeEventListener('message', on);
        reject(new Error('the portal did not answer'));
      }, 600000);
      function on(e){
        var d = e.data;
        if(!d || d.type !== 'pcp-client-data' || d.key !== key) return;
        clearTimeout(timer);
        window.removeEventListener('message', on);
        if(d.error) reject(new Error(d.error)); else resolve(d.block);
      }
      window.addEventListener('message', on);
      parent.postMessage({ type:'pcp-need-client', key:key }, '*');
    });
  }

  var note = document.getElementById('loginNote');
  var said = note ? note.textContent : '';
  var go = document.getElementById('loginGo');
  var sel = document.getElementById('loginClient');

  function guard(e){
    var key = sel.value;
    if(loaded[key]) return;              // already here: let the real handler run
    e.stopImmediatePropagation();
    e.preventDefault();
    var who = (ALL.clients[key] && ALL.clients[key].cfg) ? ALL.clients[key].cfg.name : key;
    if(note) note.textContent = 'Reading ' + who + '\\u2026';
    go.disabled = true;
    ask(key).then(function(block){
      if(block) ALL.clients[key] = block;
      loaded[key] = true;
      go.disabled = false;
      if(note) note.textContent = said;
      go.click();                        // second pass falls through to signIn()
    }).catch(function(err){
      go.disabled = false;
      if(note) note.textContent = 'Could not read ' + who + ': ' + err.message;
    });
  }

  go.addEventListener('click', guard, true);
  document.getElementById('loginPass').addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    if(loaded[sel.value]) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    go.click();
  }, true);
})();
</script>
`;
  const close = tail.lastIndexOf('</body>');
  return close < 0 ? tail + shim : tail.slice(0, close) + shim + tail.slice(close);
}

/**
 * Every client that has data, in one payload — so the TEMPLATE does the
 * choosing.
 *
 * The template opens on its own sign-in with a client dropdown, and that is the
 * design: §4 says its layout and wording are the specification, and a chooser
 * of mine in front of it is a second front door to the same building. This
 * builds the whole thing so the template's own screen has something to choose
 * from.
 *
 * Only clients with postings are included. A client with nothing loaded would
 * be a name in a dropdown leading to an empty report, which is worse than not
 * being offered.
 *
 * The cost is honest and worth stating: each client carries its own postings,
 * and A&F alone is 7MB. This is right while a handful of clients are loaded and
 * will not be right for sixty — at which point the template should ask for one
 * client's data when it is chosen rather than carry all of it at once.
 */
export async function buildAllClients(
  onProgress: (step: string, done?: number, total?: number) => void = () => {},
): Promise<{ json: string; clients: { id: number; name: string; postings: number }[] }> {
  onProgress('Finding the clients with data');
  const { data, error } = await rep().rpc('clients_for_reporting');
  if (error) throw new Error(`clients_for_reporting: ${error.message}`);
  const offered = (data ?? []) as
    { client_id: number; client_name: string; data_source: string; postings: number }[];
  if (!offered.length) {
    throw new Error(
      'No client is marked as kept on BTMS. Set that on Reporting setup — a client is offered ' +
      'here because somebody said its books are on BTMS, not because a file happens to have been imported.',
    );
  }

  const clients: Record<string, ClientBlock> = {};
  const order: string[] = [];
  const listed: { id: number; name: string; postings: number }[] = [];
  let generated = '';

  for (let i = 0; i < offered.length; i++) {
    const c = offered[i];
    const key = `c${c.client_id}`;
    order.push(key);

    // A client is offered because somebody said its books are on BTMS, not
    // because a file has been imported — the list is how you see what is still
    // to do. One with nothing loaded gets an empty block with every section
    // off, rather than being left out or breaking the build.
    if (!c.postings) {
      clients[key] = emptyClient(c.client_name);
      listed.push({ id: c.client_id, name: c.client_name, postings: 0 });
      continue;
    }

    onProgress(`Building ${c.client_name}`, i, offered.length);
    const built = await buildClientBlock(c.client_id, (step, done, total) =>
      onProgress(`${c.client_name} — ${step}`, done, total));
    clients[key] = built.block;
    listed.push({ id: c.client_id, name: c.client_name, postings: built.postings });
    generated = built.generated;
  }
  if (!generated) {
    generated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return {
    json: JSON.stringify({ generated, clients, order }),
    clients: listed,
  };
}

/**
 * Every offered client, by NAME only — which is all a sign-in screen needs.
 *
 * This is one query. buildAllClients is sixty-three, one of which reads 174.026
 * postings, and putting that in front of the sign-in made the app look broken:
 * a load screen, a long think, and no dropdown. The figures are fetched when a
 * client is actually chosen — see withLazyLoader.
 */
export async function buildClientList(): Promise<{
  json: string;
  clients: { id: number; name: string; postings: number }[];
}> {
  const { data, error } = await rep().rpc('clients_for_reporting');
  if (error) throw new Error(`clients_for_reporting: ${error.message}`);
  const offered = (data ?? []) as
    { client_id: number; client_name: string; data_source: string; postings: number }[];
  if (!offered.length) {
    throw new Error(
      'No client is marked as kept on BTMS. Set that on Reporting setup — a client is offered ' +
      'here because somebody said its books are on BTMS, not because a file happens to have been imported.',
    );
  }

  const clients: Record<string, ClientBlock> = {};
  const order: string[] = [];
  const listed: { id: number; name: string; postings: number }[] = [];
  for (const c of offered) {
    const key = `c${c.client_id}`;
    order.push(key);
    clients[key] = emptyClient(c.client_name);
    listed.push({ id: c.client_id, name: c.client_name, postings: Number(c.postings) || 0 });
  }

  const generated = new Date().toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric' });
  return { json: JSON.stringify({ generated, clients, order }), clients: listed };
}

/** One client's block, wrapped as a payload the template can read. */
export function oneClientPayload(built: BuildResult): string {
  return JSON.stringify({
    generated: built.generated,
    clients: { c: built.block },
    order: ['c'],
  });
}

/**
 * A client that is offered but has nothing loaded yet.
 *
 * It appears in the template's list because somebody said its books are on
 * BTMS — that is what the list is for, showing what is still to do — and every
 * section is switched off, so it opens on a plain statement of that rather than
 * on a page of zeroes that reads like a report.
 */
function emptyClient(name: string): ClientBlock {
  const off: Record<string, number> = {
    pl: 0, bs: 0, summary: 0, expenses: 0, sales: 0, ledgers: 0, accounts: 0,
    stmt: 0, trans: 0, mapping: 0, review: 0, vat: 0, stock: 0, payroll: 0,
    budget: 0, cash: 0, cashmove: 0, projects: 0, audit: 0,
    // Data import is off as well, and that one is not a nicety. The template's
    // FEEDS table is a hardcoded list of A&F's own file names — prototype
    // scaffolding — so leaving the section on would show one client's ledger
    // and chart of accounts, marked LOADED, under sixty-two other clients'
    // names. The overriding rule is that this application must never mix up
    // client data or client information, and a filename is client information.
    // Company setup always renders, so an empty client still opens on
    // something: its own name and the note below.
    data: 0,
  };
  // One month, not none. The template boots against ALL.order[0] before it
  // fills its own client dropdown, and boot reads M[0] and M[NM-1] to print the
  // period on screen. With months: [] that is lbl(undefined), the script dies
  // at that line, and the dropdown is never filled — which is exactly what an
  // empty first client did: a sign-in page with nothing to choose. A client
  // with no data still has a month it has no data FOR.
  const month = new Date().toISOString().slice(0, 7);

  return {
    client: name,
    months: [month], lines: [], pl: {}, bs: {}, bsOpen: {}, accounts: [],
    post: { ep: null, acc: [], jrn: [], rd: [], td: [], a: [], d: [], r: [], t: [], v: [], j: [] },
    exceptions: [], tb: [], vat: {}, vatq: [], stock: [], payroll: {},
    postings: 0,
    counts: { postings: 0, accounts: 0 },
    cfg: {
      name,
      short: name.slice(0, 12),
      yearEnd: 12,
      currency: 'EUR',
      features: off,
      notes: 'Nothing has been imported for this client yet.',
    },
    vatFiled: [], deb: [], cre: [],
    agetot: {}, ageHist: {}, ageFlags: {}, cashflow: [], cashmove: {}, cashjrn: {},
    budget: {}, audit: {}, untagged: [], projects: [],
  };
}
