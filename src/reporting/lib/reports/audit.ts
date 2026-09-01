// The monthly audit: materiality, the analytical review, and what to vouch.
//
// The template has drawn this screen all along and was handed `audit: {}`, so
// the tab was switched off. Everything it wants is derivable from the ledger and
// the two statements already rebuilt — nothing new is read for it except the
// review engine's own exceptions.
//
// It is the one screen whose template side was written against A&F's own years.
// renderAudit had `const ys=["2024","2025","2026"]` baked into it, annualised
// the last column over exactly seven months, and renderMat read `AU.res["2025"]`
// and `AU.ga25`. A client with different years would have found the screen
// reading someone else's calendar or dying on an undefined year. Those are
// patched in the generator to read `AU.years`, `AU.partial` and `AU.ga`, and
// this file is what fills them.
//
// The materiality figures are a starting point for a conversation, not a policy.
// Planning materiality is 0,75% of revenue because that is what the prototype
// set; the benchmark picker offers the usual alternatives and recomputes from
// them, which is the whole point of the screen.

import { financialYears } from './cashflow.ts';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type AuditYear = { rev: number; cos: number; gp: number; pbt: number; gpp: number };

export type AuditRow = {
  d: string; a: string; an: string; ln: string; t: string; v: number; j: string; r: string;
};

export type Audit = {
  /** The three financial years the analytical review compares, oldest first. */
  years: string[];
  /** Months held in the last of them, so the annualisation is that client's. */
  partial: number;
  /** The year the materiality is computed on. */
  basis: string;
  res: Record<string, AuditYear>;
  /** Gross assets at the basis year end. */
  ga: number;
  pm: number;
  opts: [string, number][];
  aboveN: number;
  above: AuditRow[];
  cutN: number;
  cut: { d: string; side: string; a: string; t: string; v: number; j: string; r: string }[];
  jtypes: [string, number, number, string][];
  jv: { n: number; months: number; val: number; big: { d: string; a: string; t: string; v: number; j: string }[] };
  tests: [string, string, string, string][];
};

const INCOME_SECTIONS = new Set(['Revenue', 'Other income']);
const ASSET_SECTIONS = new Set(['Non-current assets', 'Current assets']);
const TAX_SECTION = 'Taxation';

/** Performance materiality, as the template's own note assumes. */
const PERFORMANCE = 0.75;
/** Clearly trivial, likewise. */
const TRIVIAL = 0.05;

/** Journals a BTMS ledger habitually carries, so the table reads as English. */
const JOURNAL_NOTE: Record<string, string> = {
  SI: 'Sales invoices raised from the sales module',
  SC: 'Sales credit notes',
  PI: 'Purchase invoices entered from supplier documents',
  PC: 'Purchase credit notes',
  CB: 'Cash book — receipts and payments',
  CP: 'Cash payments',
  CR: 'Cash receipts',
  JV: 'Manual journals — the ones worth reading',
  PJ: 'Payroll journal',
  OB: 'Opening balances',
};

export type AuditInput = {
  months: string[];
  pl: Record<string, number[]>;
  bs: Record<string, number[]>;
  bsOpen: Record<string, number>;
  lines: { id: string; sec: string; name: string; sub: number }[];
  yearEndMonth: number;
  /** The packed postings, as postings_columnar returns them. */
  post: {
    /** Null on a client with no postings; the build returns null for those. */
    ep: string | null;
    acc: [string, string][]; jrn: string[]; rd: string[]; td: string[];
    a: number[]; d: number[]; r: number[]; t: number[]; v: number[]; j: number[];
  };
  /** account code → the report line it maps to. */
  lineFor: Map<string, string | null>;
  /** The review engine's findings, and what has been signed off. */
  exceptions: { check_name: string; sev: string; amount: number | null; ex_key: string }[];
  signedKeys: Set<string>;
};

export function buildAudit(input: AuditInput): Audit | null {
  const { months, pl, bs, bsOpen, lines, yearEndMonth, post, lineFor, exceptions, signedKeys } = input;
  if (!months.length || !post?.ep) return null;

  const byId = new Map(lines.map((l) => [l.id, l]));
  const fy = financialYears(months, yearEndMonth, 3);
  if (!fy.length) return null;

  // ---- the analytical review -------------------------------------------
  const idsIn = (test: (sec: string) => boolean, statement: 'P-' | 'B-') =>
    lines.filter((l) => !l.sub && l.id.startsWith(statement) && test(l.sec)).map((l) => l.id);

  const REV = idsIn((s) => s === 'Revenue', 'P-');
  const COS = idsIn((s) => s === 'Cost of sales', 'P-');
  const INCOME = idsIn((s) => INCOME_SECTIONS.has(s), 'P-');
  const COST = idsIn((s) => !INCOME_SECTIONS.has(s) && s !== TAX_SECTION, 'P-');
  const ASSETS = idsIn((s) => ASSET_SECTIONS.has(s), 'B-');
  const DEBTORS = ['B-120', 'B-130'];
  const CREDITORS = ['B-210'];
  const STOCK = ['B-110'];

  const plSum = (ids: string[], from: number, to: number) => {
    let n = 0;
    for (const id of ids) {
      const a = pl[id];
      if (!a) continue;
      for (let i = from; i <= to; i++) n += a[i] ?? 0;
    }
    return n;
  };
  const at = (id: string, i: number) => (i < 0 ? (bsOpen[id] ?? 0) : (bs[id]?.[i] ?? 0));
  const posSum = (ids: string[], i: number) => ids.reduce((n, id) => n + at(id, i), 0);

  const res: Record<string, AuditYear> = {};
  for (const y of fy) {
    const rev = plSum(REV, y.from, y.to);
    const cos = plSum(COS, y.from, y.to);
    const pbt = plSum(INCOME, y.from, y.to) - plSum(COST, y.from, y.to);
    res[String(y.year)] = {
      rev: round2(rev), cos: round2(cos), gp: round2(rev - cos), pbt: round2(pbt),
      gpp: rev ? round2((rev - cos) / rev * 100) : 0,
    };
  }

  // ---- materiality ------------------------------------------------------
  // Computed on the last COMPLETE year where there is one. A part-year would
  // set a threshold on part of a year's trading, which is too low, and every
  // posting would look material.
  const complete = fy.filter((y) => y.complete);
  const basisYear = (complete.length ? complete[complete.length - 1] : fy[fy.length - 1]);
  const basis = String(basisYear.year);
  const b = res[basis];
  const ga = round2(posSum(ASSETS, basisYear.to));

  const pm = round2(Math.abs(b.rev) * 0.0075);
  const opts: [string, number][] = [
    ['Revenue 0,5%', round2(Math.abs(b.rev) * 0.005)],
    ['Revenue 1%', round2(Math.abs(b.rev) * 0.01)],
    ['Gross assets 1%', round2(Math.abs(ga) * 0.01)],
    ['Gross assets 2%', round2(Math.abs(ga) * 0.02)],
    ['Profit before tax 5%', round2(Math.abs(b.pbt) * 0.05)],
  ];

  // ---- what to vouch, and where the period is most easily wrong ---------
  const epMs = Date.parse(post.ep + 'T00:00:00Z');   // non-null past the guard above
  const iso = (day: number) => new Date(epMs + day * 86400000).toISOString().slice(0, 10);
  const codeOf = post.acc.map((x) => String(x[0]));
  const nameOf = post.acc.map((x) => String(x[1] ?? ''));

  const isPl = codeOf.map((c) => {
    const id = lineFor.get(c);
    return !!id && id.startsWith('P-');
  });
  const lineName = codeOf.map((c) => {
    const id = lineFor.get(c);
    return id ? (byId.get(id)?.name ?? id) : '';
  });

  // The audit period is the latest year: vouching last year's postings again
  // is not what this screen is for.
  const last = fy[fy.length - 1];
  const firstDay = Math.round((Date.UTC(
    Number(months[last.from].slice(0, 4)), Number(months[last.from].slice(5, 7)) - 1, 1,
  ) - epMs) / 86400000);
  const lastDay = Math.round((Date.UTC(
    Number(months[last.to].slice(0, 4)), Number(months[last.to].slice(5, 7)), 0,
  ) - epMs) / 86400000);

  const threshold = pm * PERFORMANCE;
  const trivial = pm * TRIVIAL;

  const above: AuditRow[] = [];
  // Year ends, for the cut-off test: three days either side of each.
  //
  // COMPLETE years only. The last month held is not a year end -- for A&F it
  // is August, because August is as far as the ledger goes -- and testing the
  // cut-off around it would flag a month boundary as though a period had
  // closed there. Nothing is at stake at an ordinary month end.
  const yearEnds = fy.filter((y) => y.complete).map((y) => Math.round((Date.UTC(
    Number(months[y.to].slice(0, 4)), Number(months[y.to].slice(5, 7)), 0,
  ) - epMs) / 86400000));
  const cut: Audit['cut'] = [];

  const jCount = new Map<string, { n: number; v: number }>();
  const jvRows: { d: string; a: string; t: string; v: number; j: string }[] = [];
  const jvMonths = new Set<string>();
  let jvN = 0, jvVal = 0;

  for (let i = 0; i < post.v.length; i++) {
    const ai = post.a[i];
    const day = post.d[i];
    const v = post.v[i];
    const jcode = String(post.jrn[post.j[i]] ?? '');

    const g = jCount.get(jcode) ?? { n: 0, v: 0 };
    g.n++;
    if (v > 0) g.v += v;
    jCount.set(jcode, g);

    if (jcode === 'JV') {
      jvN++;
      if (v > 0) jvVal += v;
      jvMonths.add(iso(day).slice(0, 7));
      jvRows.push({
        d: iso(day), a: codeOf[ai], t: String(post.td[post.t[i]] ?? ''),
        v: round2(v), j: jcode,
      });
    }

    if (Math.abs(v) >= threshold && isPl[ai] && day >= firstDay && day <= lastDay) {
      above.push({
        d: iso(day), a: codeOf[ai], an: nameOf[ai], ln: lineName[ai],
        t: String(post.td[post.t[i]] ?? ''), v: round2(v), j: jcode,
        r: String(post.rd[post.r[i]] ?? ''),
      });
    }

    if (Math.abs(v) >= trivial) {
      for (const ye of yearEnds) {
        const gap = day - ye;
        if (gap >= -3 && gap <= 3) {
          cut.push({
            d: iso(day), side: gap <= 0 ? 'before the year end' : 'after the year end',
            a: codeOf[ai], t: String(post.td[post.t[i]] ?? ''), v: round2(v),
            j: jcode, r: String(post.rd[post.r[i]] ?? ''),
          });
          break;
        }
      }
    }
  }

  above.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  cut.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  jvRows.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));

  const jtypes: [string, number, number, string][] = [...jCount.entries()]
    .map(([k, g]) => [k || '(none)', g.n, round2(g.v), JOURNAL_NOTE[k] ?? ''] as [string, number, number, string])
    .sort((x, y) => y[1] - x[1]);

  // ---- the ratios worth challenging -------------------------------------
  // Annualised on the latest year, so a part year is not read as a full one.
  const scale = last.months ? 12 / last.months : 1;
  const revA = Math.abs(res[String(last.year)].rev) * scale;
  const cosA = Math.abs(res[String(last.year)].cos) * scale;
  const days = (position: number, flow: number) => (flow ? Math.abs(position) / flow * 365 : 0);
  const ratios = {
    debtor: days(posSum(DEBTORS, last.to), revA),
    creditor: days(posSum(CREDITORS, last.to), cosA),
    stock: days(posSum(STOCK, last.to), cosA),
  };

  // ---- the month's checks -----------------------------------------------
  // The review engine's own findings, by check. A point signed off drops out of
  // the count: that is what signing it off means, and the reason is kept
  // against it on the review screen.
  const byCheck = new Map<string, { open: number; cleared: number; high: number; value: number }>();
  for (const e of exceptions) {
    const g = byCheck.get(e.check_name) ?? { open: 0, cleared: 0, high: 0, value: 0 };
    if (signedKeys.has(e.ex_key)) g.cleared++;
    else {
      g.open++;
      if (e.sev === 'high') g.high++;
      g.value += Math.abs(Number(e.amount ?? 0));
    }
    byCheck.set(e.check_name, g);
  }
  // de-DE, not en-GB with its commas replaced. That older way converted the
  // thousands separator and never the decimal point, so 516.283,99 came out as
  // 516.283.99 — right on whole numbers, which is why it went unnoticed.
  const eur = (n: number) => '€' + n.toLocaleString('de-DE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const tests: [string, string, string, string][] = [...byCheck.entries()]
    .sort((x, y) => y[1].open - x[1].open)
    .map(([name, g]) => {
      const result = g.open === 0 ? 'pass' : g.high > 0 ? 'exception' : 'needs work';
      const said = g.open === 0
        ? `Nothing outstanding${g.cleared ? `; ${g.cleared} cleared with a reason` : ''}.`
        : `${g.open} open${g.high ? `, ${g.high} of them high` : ''}`
          + `${g.cleared ? `, ${g.cleared} cleared` : ''} · ${eur(g.value)}.`;
      const next = g.open === 0 ? ''
        : g.high > 0 ? 'Clear the high items or accept them with a reason.'
          : 'Review and sign off on Needs attention.';
      return [name, said, result, next];
    });

  return {
    years: fy.map((y) => String(y.year)),
    partial: last.months,
    basis,
    res,
    ga,
    pm,
    opts,
    aboveN: above.length,
    above,
    cutN: cut.length,
    cut,
    jtypes,
    jv: {
      n: jvN, months: jvMonths.size, val: round2(jvVal),
      big: jvRows.slice(0, 12),
    },
    tests,
  };
}
