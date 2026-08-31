// The cash flow statement, indirect.
//
// The template has drawn this screen all along and was handed `cashflow: []`,
// so the tab was switched off. Nothing new has to be read for it: the profit
// and loss and the balance sheet are already rebuilt month by month, and an
// indirect cash flow is arithmetic on those two.
//
// The walk, in the template's own rows:
//
//   profit before tax
//   + depreciation                       a charge that moved no cash
//   − the increase in stock              cash tied up
//   − the increase in debtors            invoiced, not collected
//   + the increase in creditors          incurred, not paid
//   = cash from operations
//   + capital expenditure                what was spent on assets
//   + financing                          loans and shareholders, in and out
//   = the net movement in cash
//   against the movement the bank accounts actually show
//   = unexplained
//
// **The unexplained row is the point of the statement**, not a defect in it.
// Everything above it is derived from the mapped ledger; `actual` is the
// movement on the cash, bank and overdraft lines. Where the two disagree the
// screen says so rather than forcing them together — and the commonest honest
// cause is the tax charge, which the template has no row for: profit BEFORE tax
// is where the walk starts, while the tax liability it created sits in
// creditors. A client whose tax is posted once at the year end, after the
// audit, therefore reconciles in every month but that one.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type CashPeriod = {
  label: string;
  pbt: number; dep: number; stock: number; deb: number; cred: number;
  ops: number; capex: number; fin: number;
  net: number; actual: number; diff: number;
  open: number; close: number;
};

/**
 * Which master line belongs in which part of the walk.
 *
 * Named rather than inferred: the 87 master lines are a fixed list (migration
 * 197) and guessing at them from their wording would be a rule that silently
 * changes meaning the day somebody renames a line.
 */
const DEPRECIATION = ['P-160', 'P-470', 'P-630'];
const STOCK = ['B-110'];
const DEBTORS = ['B-120', 'B-130', 'B-140', 'B-150', 'B-170'];
const CREDITORS = ['B-210', 'B-220', 'B-230', 'B-240', 'B-250', 'B-260'];
/** Cost, intangibles and investments. B-020 is the accumulated depreciation
 *  contra, and its movement is the charge already added back above. */
const CAPITAL = ['B-010', 'B-030', 'B-040'];
const FINANCING = ['B-410', 'B-420', 'B-430', 'B-440', 'B-610', 'B-620'];
/** Cash is what the bank says, less what is overdrawn. */
const CASH = ['B-160'];
const OVERDRAFT = ['B-270'];

/** P&L sections that are income; everything else in the P&L is a cost. */
const INCOME_SECTIONS = new Set(['Revenue', 'Other income']);
/** Excluded from profit BEFORE tax. */
const TAX_SECTION = 'Taxation';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type CashInput = {
  months: string[];
  /** lineId → movement per month, revenue and costs both positive. */
  pl: Record<string, number[]>;
  /** lineId → position per month, each line positive in its natural direction. */
  bs: Record<string, number[]>;
  /** lineId → position before months[0]. */
  bsOpen: Record<string, number>;
  /** The master lines, for their sections. */
  lines: { id: string; sec: string; sub: number }[];
  /** 1–12. A year that ends in June is not a calendar year. */
  yearEndMonth: number;
};

export type FinYear = { year: number; from: number; to: number; label: string; complete: boolean; months: number };

/**
 * The financial years a client holds, latest last. At most three, none empty.
 *
 * Exported because the cash flow and the audit both walk by financial year, and
 * two of them working it out separately is two of them able to disagree.
 */
export function financialYears(months: string[], yearEndMonth: number, take = 3): FinYear[] {
  if (!months.length) return [];
  const endOf = (m: string) => {
    // The financial year a month falls in, named by the calendar year it ends.
    const y = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7));
    return mm <= yearEndMonth ? y : y + 1;
  };
  const years: number[] = [];
  for (const m of months) {
    const y = endOf(m);
    if (!years.includes(y)) years.push(y);
  }
  const wanted = years.slice(-take);
  return wanted.map((y) => {
    let from = -1, to = -1;
    for (let i = 0; i < months.length; i++) {
      if (endOf(months[i]) !== y) continue;
      if (from < 0) from = i;
      to = i;
    }
    // A year is complete when its last month held is the year-end month.
    const lastMonth = Number(months[to].slice(5, 7));
    const complete = lastMonth === yearEndMonth;
    const label = complete ? String(y) : `${y} to ${MONTH_SHORT[lastMonth - 1]}`;
    return { year: y, from, to, label, complete, months: to - from + 1 };
  });
}

export function buildCashflow(input: CashInput): CashPeriod[] {
  const { months, pl, bs, bsOpen, lines, yearEndMonth } = input;
  if (!months.length) return [];

  const sectionOf = new Map(lines.map((l) => [l.id, l]));

  /** A P&L line's movement across a range. */
  const plSum = (ids: string[], from: number, to: number) => {
    let n = 0;
    for (const id of ids) {
      const a = pl[id];
      if (!a) continue;
      for (let i = from; i <= to; i++) n += a[i] ?? 0;
    }
    return n;
  };

  /** A balance sheet line's position at a month index, or before the first. */
  const at = (id: string, i: number) => (i < 0 ? (bsOpen[id] ?? 0) : (bs[id]?.[i] ?? 0));
  const posSum = (ids: string[], i: number) => ids.reduce((n, id) => n + at(id, i), 0);
  const move = (ids: string[], from: number, to: number) => posSum(ids, to) - posSum(ids, from - 1);

  // Profit before tax: income less every cost that is not the tax charge.
  const pbtIds = { income: [] as string[], cost: [] as string[] };
  for (const l of lines) {
    if (l.sub) continue;                     // a subtotal would count twice
    const s = sectionOf.get(l.id);
    if (!s || !l.id.startsWith('P-')) continue;
    if (s.sec === TAX_SECTION) continue;
    (INCOME_SECTIONS.has(s.sec) ? pbtIds.income : pbtIds.cost).push(l.id);
  }

  return financialYears(months, yearEndMonth).map(({ from, to, label }) => {
    const pbt = plSum(pbtIds.income, from, to) - plSum(pbtIds.cost, from, to);
    const dep = plSum(DEPRECIATION, from, to);

    // Cash effects: an asset going up uses cash, a liability going up releases it.
    const stock = -move(STOCK, from, to);
    const deb = -move(DEBTORS, from, to);
    const cred = move(CREDITORS, from, to);
    const ops = pbt + dep + stock + deb + cred;

    const capex = -move(CAPITAL, from, to);
    const fin = move(FINANCING, from, to);
    const net = ops + capex + fin;

    const cashAt = (i: number) => posSum(CASH, i) - posSum(OVERDRAFT, i);
    const open = cashAt(from - 1);
    const close = cashAt(to);
    const actual = close - open;

    return {
      label,
      pbt: round2(pbt), dep: round2(dep), stock: round2(stock),
      deb: round2(deb), cred: round2(cred), ops: round2(ops),
      capex: round2(capex), fin: round2(fin), net: round2(net),
      actual: round2(actual), diff: round2(net - actual),
      open: round2(open), close: round2(close),
    };
  });
}
