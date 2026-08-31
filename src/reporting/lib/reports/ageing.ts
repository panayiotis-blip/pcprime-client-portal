// Debtors and creditors, aged.
//
// The template has had a Debtors & creditors screen all along, and it was being
// handed `agetot: {}` — so its first line, A.deb.map(...), threw on every
// client, and the Overview's "Owed to you" and "You owe" tiles printed an em
// dash. This is the data those screens were written for.
//
// There is no ageing feed and there does not need to be. The analytical journal
// listing carries every posting on every debtor and creditor account with its
// date, and BTMS's chart of accounts says which accounts those are
// (account_type 'Debtor' / 'Creditor'). What is missing from the ledger is the
// allocation — which receipt paid which invoice — so the ageing is derived the
// way an accountant derives it from a ledger that does not allocate: oldest
// first.
//
//   Every debit on a debtor account is something owed. Every credit is taken
//   off the oldest unpaid amount first. What is still open at the reporting
//   date is aged from ITS OWN date into the four buckets the template draws.
//
// That is FIFO allocation, and it is the standard assumption when a ledger
// carries no allocation of its own. It is stated here rather than buried
// because it is an assumption: where a client pays a specific invoice out of
// order, this ages that balance older than it truly is. It never changes the
// balance, only which bucket the balance sits in.
//
// Creditors are the mirror: a credit is something owed, a debit reduces it. The
// signs are flipped so that "You owe" reads as a positive number, which is what
// the screen says.

const DAY = 86400000;

/** Current, 31–60, 61–90, over 90 — the four the template draws. */
export type Buckets = [number, number, number, number];

export type AgeRow = {
  code: string;
  name: string;
  /** Positive is owed: by the customer on a debtor, to the supplier on a creditor. */
  bal: number;
  b: Buckets;
  /** The date of the last posting on the account, 'YYYY-MM-DD'. */
  last: string;
};

export type AgeHist = { m: string; tot: number; o90: number; neg: number };

export type AgeFlag = {
  code: string; name: string; bal: number; prev: number;
  o90: number; last: string; flags: string[];
};

export type AgeTotals = {
  debnet: number; debpos: number; debneg: number; debn: number; debnegn: number;
  crenet: number; cren: number; crenegn: number;
  deb: Buckets; cre: Buckets;
};

export type Ageing = {
  agetot: AgeTotals;
  deb: AgeRow[];
  cre: AgeRow[];
  ageHist: { deb: AgeHist[]; cre: AgeHist[] };
  ageFlags: { deb: AgeFlag[]; cre: AgeFlag[] };
};

/** One account's postings, as day offsets from the epoch and signed values. */
type Account = { code: string; name: string; days: number[]; vals: number[] };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * How many month-ends of history to rebuild.
 *
 * The screen's own statistics reach back thirteen ("against a year ago"), so
 * anything less than that leaves a tile reading an em dash. Twenty-four gives
 * the chart two years and keeps the work bounded: the ageing at a month-end is
 * a pass over that account's postings up to it, and the cost is months times
 * postings, not months times accounts.
 */
const HISTORY_MONTHS = 24;

/** Flagged accounts are for reading, not scrolling. */
const MAX_FLAGS = 200;

/**
 * Age one account's open items at a date.
 *
 * `sign` is +1 for debtors (a debit is owed) and −1 for creditors (a credit
 * is owed), so everything below works in "amount owed" terms and the caller
 * never sees the ledger's direction.
 */
function ageAccount(
  a: Account, asAtDay: number, sign: number,
): { bal: number; b: Buckets } {
  // Open items, oldest first, each carrying the day it arose.
  const openDay: number[] = [];
  const openAmt: number[] = [];
  let credit = 0;                    // payments with nothing left to consume
  let bal = 0;

  for (let i = 0; i < a.days.length; i++) {
    const d = a.days[i];
    if (d > asAtDay) break;          // days are sorted; nothing later counts
    const v = a.vals[i] * sign;
    bal += v;
    if (v > 0) {
      // An amount owed. Anything paid on account eats into it first.
      let owed = v;
      if (credit > 0) {
        const used = Math.min(credit, owed);
        credit -= used;
        owed -= used;
      }
      if (owed > 0.005) { openDay.push(d); openAmt.push(owed); }
    } else if (v < 0) {
      // A payment. Oldest open item first — the assumption stated at the top.
      let pay = -v;
      for (let k = 0; k < openAmt.length && pay > 0.005; k++) {
        if (openAmt[k] <= 0) continue;
        const used = Math.min(openAmt[k], pay);
        openAmt[k] -= used;
        pay -= used;
      }
      if (pay > 0.005) credit += pay;
    }
  }

  const b: Buckets = [0, 0, 0, 0];
  for (let k = 0; k < openAmt.length; k++) {
    if (openAmt[k] <= 0.005) continue;
    const age = asAtDay - openDay[k];
    const slot = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    b[slot] += openAmt[k];
  }
  return { bal: round2(bal), b: [round2(b[0]), round2(b[1]), round2(b[2]), round2(b[3])] };
}

const summarise = (rows: AgeRow[]): { net: number; pos: number; neg: number; n: number; negn: number; b: Buckets } => {
  let net = 0, pos = 0, neg = 0, n = 0, negn = 0;
  const b: Buckets = [0, 0, 0, 0];
  for (const r of rows) {
    net += r.bal;
    if (r.bal > 0.005) pos += r.bal;
    if (r.bal < -0.005) { neg += r.bal; negn++; }
    if (Math.abs(r.bal) >= 0.005) n++;
    for (let k = 0; k < 4; k++) b[k] += r.b[k];
  }
  return {
    net: round2(net), pos: round2(pos), neg: round2(neg), n, negn,
    b: [round2(b[0]), round2(b[1]), round2(b[2]), round2(b[3])],
  };
};

export type AgeingInput = {
  /** 'YYYY-MM' for every month held, in order. */
  months: string[];
  /** The packed postings' epoch date, 'YYYY-MM-DD'. */
  epoch: string;
  /** Per posting: the account index, the day offset and the signed value. */
  a: number[]; d: number[]; v: number[];
  /** Per account index: its code. */
  codeOfAcc: string[];
  /** code → { name, type } from the chart of accounts. */
  info: Map<string, { name: string; type: string | null }>;
};

/** The last day of a 'YYYY-MM', as an offset from the epoch. */
const monthEndDay = (month: string, epochMs: number) => {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return Math.round((Date.UTC(y, m, 0) - epochMs) / DAY);
};

export async function buildAgeing(
  input: AgeingInput,
  breathe: () => Promise<void>,
  onProgress: (step: string, done?: number, total?: number) => void = () => {},
): Promise<Ageing> {
  const { months, epoch, a, d, v, codeOfAcc, info } = input;
  const epochMs = Date.parse(epoch + 'T00:00:00Z');

  // ---- gather, once, only the accounts that can be aged ----------------
  onProgress('Ageing the debtors and creditors', 0, v.length);
  const kindOfAcc: (1 | -1 | 0)[] = codeOfAcc.map((code) => {
    const t = info.get(code)?.type ?? null;
    return t === 'Debtor' ? 1 : t === 'Creditor' ? -1 : 0;
  });

  const held = new Map<number, Account>();
  for (let i = 0; i < v.length; i++) {
    if (i > 0 && i % 20000 === 0) {
      onProgress('Ageing the debtors and creditors', i, v.length);
      await breathe();
    }
    const ai = a[i];
    if (!kindOfAcc[ai]) continue;
    let acc = held.get(ai);
    if (!acc) {
      const code = codeOfAcc[ai];
      acc = { code, name: info.get(code)?.name ?? '', days: [], vals: [] };
      held.set(ai, acc);
    }
    acc.days.push(d[i]);
    acc.vals.push(v[i]);
  }

  // The FIFO walk reads them in date order, and postings_columnar does not
  // promise one. Sorting per account is cheaper than sorting all of them.
  for (const acc of held.values()) {
    let sorted = true;
    for (let i = 1; i < acc.days.length; i++) if (acc.days[i] < acc.days[i - 1]) { sorted = false; break; }
    if (sorted) continue;
    const order = acc.days.map((_, i) => i).sort((x, y) => acc.days[x] - acc.days[y]);
    acc.days = order.map((i) => acc.days[i]);
    acc.vals = order.map((i) => acc.vals[i]);
  }

  const debtors: Account[] = [];
  const creditors: Account[] = [];
  for (const [ai, acc] of held) (kindOfAcc[ai] === 1 ? debtors : creditors).push(acc);

  // ---- the position now ------------------------------------------------
  const asAt = months.length ? monthEndDay(months[months.length - 1], epochMs) : 0;
  const dayToIso = (day: number) => new Date(epochMs + day * DAY).toISOString().slice(0, 10);

  const rowsFor = (accounts: Account[], sign: number, at: number): AgeRow[] => {
    const out: AgeRow[] = [];
    for (const acc of accounts) {
      const { bal, b } = ageAccount(acc, at, sign);
      const moved = b[0] || b[1] || b[2] || b[3];
      if (Math.abs(bal) < 0.005 && !moved) continue;
      let last = -1;
      for (let i = acc.days.length - 1; i >= 0; i--) if (acc.days[i] <= at) { last = acc.days[i]; break; }
      out.push({ code: acc.code, name: acc.name, bal, b, last: last < 0 ? '' : dayToIso(last) });
    }
    return out.sort((x, y) => Math.abs(y.bal) - Math.abs(x.bal));
  };

  onProgress('Ageing the debtors and creditors');
  await breathe();
  const deb = rowsFor(debtors, 1, asAt);
  await breathe();
  const cre = rowsFor(creditors, -1, asAt);

  const ds = summarise(deb);
  const cs = summarise(cre);
  const agetot: AgeTotals = {
    debnet: ds.net, debpos: ds.pos, debneg: ds.neg, debn: ds.n, debnegn: ds.negn,
    crenet: cs.net, cren: cs.n, crenegn: cs.negn,
    deb: ds.b, cre: cs.b,
  };

  // ---- how it has moved -------------------------------------------------
  // The chart wants a net balance, an over-90 figure and the credit balances
  // at each month-end. Only the last two years: the screen's own statistics
  // reach back thirteen months and no further.
  const span = months.slice(Math.max(0, months.length - HISTORY_MONTHS));
  const hist = async (accounts: Account[], sign: number): Promise<AgeHist[]> => {
    const out: AgeHist[] = [];
    for (const m of span) {
      const at = monthEndDay(m, epochMs);
      let tot = 0, o90 = 0, neg = 0;
      for (const acc of accounts) {
        const { bal, b } = ageAccount(acc, at, sign);
        tot += bal;
        o90 += b[3];
        if (bal < -0.005) neg += bal;
      }
      out.push({ m, tot: round2(tot), o90: round2(o90), neg: round2(neg) });
      await breathe();
    }
    return out;
  };

  onProgress('Rebuilding the ageing history', 0, span.length * 2);
  const ageHist = { deb: await hist(debtors, 1), cre: await hist(creditors, -1) };

  // ---- what is worth looking at ----------------------------------------
  // The month before, for the "grew on last month" comparison and the column
  // the flags table prints beside the balance.
  const prevAt = months.length > 1 ? monthEndDay(months[months.length - 2], epochMs) : asAt;
  const flagsFor = (accounts: Account[], sign: number, rows: AgeRow[]): AgeFlag[] => {
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const out: AgeFlag[] = [];
    for (const acc of accounts) {
      const row = byCode.get(acc.code);
      if (!row) continue;
      const prev = ageAccount(acc, prevAt, sign).bal;
      const flags: string[] = [];
      if (row.b[3] > 0.005) flags.push('over 90 days');
      // A debtor in credit, or a creditor in debit: the same fact from either
      // side, and the template names them differently on each screen.
      if (row.bal < -0.005) flags.push(sign === 1 ? 'credit balance' : 'debit balance');
      if (row.bal - prev > 0.005) flags.push('grew on last month');
      const lastDay = row.last ? Math.round((Date.parse(row.last + 'T00:00:00Z') - epochMs) / DAY) : -1;
      if (Math.abs(row.bal) >= 0.005 && lastDay >= 0 && asAt - lastDay > 90) {
        flags.push('no movement 90+ days');
      }
      if (!flags.length) continue;
      out.push({
        code: row.code, name: row.name, bal: row.bal, prev: round2(prev),
        o90: row.b[3], last: row.last, flags,
      });
    }
    return out.sort((x, y) => Math.abs(y.bal) - Math.abs(x.bal)).slice(0, MAX_FLAGS);
  };

  onProgress('Flagging the ledger accounts');
  await breathe();
  const ageFlags = { deb: flagsFor(debtors, 1, deb), cre: flagsFor(creditors, -1, cre) };

  return { agetot, deb, cre, ageHist, ageFlags };
}
