// The BTMS VAT figures summary.
//
// Not a summary of five boxes, despite the name: it is the analytical VAT
// listing, every transaction that carried a VAT code, grouped
//
//   Vat Type : Output
//     Period   -   08/2025
//       ...transactions...
//     Period   -   08/2025   Totals   ...   -878.81
//     Period   -   04/2026
//       ...
//   Vat Type : Output   Totals   ...   -92627.88
//   Vat Type : Input
//     ...
//   Grand Totals ...
//
// Two things about it matter more than the detail.
//
// THE SIGNS ARE BTMS'S. Output tax is negative because it is a credit and input
// tax positive because it is a debit. The boxes are stated as amounts, so the
// output is taken as its magnitude.
//
// THE PERIODS ARE MONTHS, AND NOT ALL OF THEM BELONG. A return for Q2 2026
// carries months 04, 05 and 06/2026 — and also 08/2025, 12/2025 and 03/2026,
// which are items posted late and swept into this return. They are real and
// they were filed, but they are not the quarter's own trading, and the VAT
// screen has a column for exactly that: prior-period items. So they are read
// out separately rather than folded in.
//
// On A&F's Q2 2026 export that split reproduces the filed return to the cent:
// in-period output 91.749,07 and input 64.914,16, with 170,20 of prior-period
// input beside them.

import type { Row } from './types.ts';
import { num, str } from './cells.ts';

// WHERE THE FIGURES SIT, AND WHY IT IS NOT ONE ANSWER.
//
// A transaction row follows the header: Account, Name, Ref, Date, Code, No,
// Batch, Code, %, then Debits Credits BaseDbts BaseCrdts Vat BaseVat at 9..14.
//
// A totals row does NOT. It is written as a label and the word "Totals" and
// then the same six figures — so they start at column 2, seven columns to the
// left of where the same figures sit one row above:
//
//   [0] "Period   -   06/2026"  [1] "Totals"  [2] 11325.42 … [6] -32722.35
//
// And the grand total has no "Totals" cell of its own, so it shifts one further:
//
//   [0] "Grand Totals"  [1] 375178.52 … [5] -27543.52
//
// Reading a totals row at the transaction row's offsets gives nought for every
// figure, which is how this parser first read the whole file as zero.
const TOTALS = { baseDbts: 4, baseCrdts: 5, vat: 6 };
const GRAND = { vat: 5 };

export type VatMonth = {
  /** 'YYYY-MM'. */
  month: string;
  /** Positive amounts, whichever side BTMS wrote them on. */
  vat: number;
  base: number;
};

export type VatSummaryParse = {
  ok: boolean;
  output: VatMonth[];
  input: VatMonth[];
  /** What BTMS totalled each section to, for checking the parse against. */
  stated: { output: number | null; input: number | null; grand: number | null };
  notes: { kind: string; message: string }[];
};

const MONTH_RE = /Period\s*-\s*(\d{1,2})\s*\/\s*(\d{4})/i;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Read the listing into two sets of monthly totals.
 *
 * Only the Totals rows are read. The transaction rows beneath them are the
 * evidence for those totals and BTMS has already added them up; re-adding them
 * here would be a second opinion nobody asked for, and one that would differ
 * the day a row is filtered out of the export.
 */
export function parseVatSummary(rows: Row[]): VatSummaryParse {
  const notes: VatSummaryParse['notes'] = [];
  const output: VatMonth[] = [];
  const input: VatMonth[] = [];
  const stated = { output: null as number | null, input: null as number | null, grand: null as number | null };

  let section: 'output' | 'input' | null = null;

  for (const raw of rows) {
    const first = str(raw?.[0]) ?? '';
    if (!first) continue;

    const type = first.match(/Vat\s*Type\s*:\s*(Output|Input)/i);
    if (type) {
      const which = type[1].toLowerCase() === 'output' ? 'output' : 'input';
      // "Vat Type : Output  Totals" closes the section rather than opening one.
      if (/total/i.test((str(raw?.[1]) ?? ''))) {
        stated[which] = round2(Math.abs(num(raw?.[TOTALS.vat])));
        section = null;
      } else {
        section = which;
      }
      continue;
    }

    if (/^Grand\s*Totals/i.test(first)) {
      stated.grand = round2(num(raw?.[GRAND.vat]));
      continue;
    }

    const m = first.match(MONTH_RE);
    if (!m || !section) continue;
    // The month line appears twice: once opening the block and once closing it
    // with its totals. Only the closing one carries figures.
    if (!/total/i.test((str(raw?.[1]) ?? ''))) continue;

    const month = `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`;
    const vat = Math.abs(num(raw?.[TOTALS.vat]));
    const base = Math.abs(num(raw?.[TOTALS.baseCrdts])) + Math.abs(num(raw?.[TOTALS.baseDbts]));
    (section === 'output' ? output : input).push({
      month, vat: round2(vat), base: round2(base),
    });
  }

  if (!output.length && !input.length) {
    notes.push({
      kind: 'wrong-export',
      message: 'No VAT periods were found. This does not look like a BTMS VAT figures summary — '
        + 'it is the analytical listing, grouped by Vat Type and Period.',
    });
    return { ok: false, output, input, stated, notes };
  }

  // The parse against BTMS's own totals, which is the whole method used
  // everywhere else in this build: a file that does not agree with itself is
  // not a file to trust.
  const sum = (a: VatMonth[]) => round2(a.reduce((n, x) => n + x.vat, 0));
  for (const [which, list] of [['output', output], ['input', input]] as const) {
    const said = stated[which];
    if (said === null) continue;
    const got = sum(list);
    if (Math.abs(got - said) >= 0.005) {
      notes.push({
        kind: 'totals',
        message: `The ${which} periods add to ${got.toFixed(2)} but the file's own `
          + `${which} total says ${said.toFixed(2)}. The export is partial or a period was missed.`,
      });
    }
  }

  return { ok: !notes.some((n) => n.kind !== 'note'), output, input, stated, notes };
}

/** The three months a quarter ending in this month covers. */
export function quarterMonths(period: string): string[] {
  const m = period.match(/^(\d{4})-(\d{2})/);
  if (!m) return [];
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const out: string[] = [];
  for (let back = 2; back >= 0; back--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export type VatBoxes = {
  box1: number; box2: number; box3: number; box4: number; box5: number;
  outBase: number; inBase: number;
  priorBox1: number; priorBox4: number;
  months: { inPeriod: string[]; prior: string[] };
};

/**
 * The five boxes, for the quarter this return is for.
 *
 * Box 2 is EU acquisitions, which this export does not distinguish — BTMS
 * writes them among the outputs under their own VAT code. It is left at nil
 * rather than guessed, and box 3 is box 1 plus it, so the arithmetic still
 * holds and nothing is invented.
 */
export function boxesFor(parse: VatSummaryParse, period: string): VatBoxes {
  const inQuarter = new Set(quarterMonths(period));
  const split = (list: VatMonth[]) => {
    let now = 0, prior = 0, base = 0;
    const inP: string[] = [], pr: string[] = [];
    for (const m of list) {
      if (inQuarter.has(m.month)) { now += m.vat; base += m.base; inP.push(m.month); }
      else { prior += m.vat; pr.push(m.month); }
    }
    return { now: round2(now), prior: round2(prior), base: round2(base), inP, pr };
  };

  const out = split(parse.output);
  const inp = split(parse.input);
  const box1 = out.now, box2 = 0, box3 = round2(box1 + box2), box4 = inp.now;

  return {
    box1, box2, box3, box4, box5: round2(box3 - box4),
    outBase: out.base, inBase: inp.base,
    priorBox1: out.prior, priorBox4: inp.prior,
    months: {
      inPeriod: [...new Set([...out.inP, ...inp.inP])].sort(),
      prior: [...new Set([...out.pr, ...inp.pr])].sort(),
    },
  };
}
