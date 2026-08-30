/**
 * BTMS stock valuation — parser. BUILD.md §6.6.
 *
 * One row per item: code, description, a flag, quantity, unit cost, value.
 * The quantity arrives as TEXT ("2", "-3") and the value as a number, so the
 * quantity is coerced rather than trusted.
 *
 * The last two rows are a footer:
 *
 *   Number of Records | 1563 | GrandTotals | 4488 | 581816.8
 *   Page -1 of 1
 *
 * That is the report's own control total and the parse is checked against it,
 * the same as the trial balance. A stock figure read short goes straight into
 * cost of sales.
 *
 * Negative and zero quantities are counted rather than dropped. A negative
 * stock line is a real thing in BTMS — it means goods went out that were never
 * booked in — and it is the first thing to look at when the valuation and the
 * ledger disagree, which §6.6 says they usually do.
 */

import type { Note, Row } from './types.ts';

const COL = { code: 0, name: 1, qty: 4, cost: 5, value: 7 } as const;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

export type StockItem = {
  code: string;
  name: string;
  qty: number;
  cost: number;
  value: number;
};

export type StockParse = {
  ok: boolean;
  items: StockItem[];
  /** The report's own "Number of Records / GrandTotals" line. */
  footer: { items: number; units: number; value: number } | null;
  totals: { items: number; units: number; value: number };
  /** Lines carrying a negative quantity, and what they are worth. */
  negative: { items: number; value: number };
  zero: number;
  notes: Note[];
};

export function parseStockValuation(rows: Row[]): StockParse {
  const items: StockItem[] = [];
  const notes: Note[] = [];
  let footer: StockParse['footer'] = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const first = str(r[COL.code]);
    if (!first) continue;

    if (/^number of records/i.test(first)) {
      footer = { items: num(r[1]), units: num(r[3]), value: num(r[4]) };
      continue;
    }
    if (/^page/i.test(first)) continue;

    // An item row is one that carries a value in the last column. Anything
    // else with text in column 0 is a heading or a page break.
    if (r[COL.value] === null || r[COL.value] === undefined) continue;

    items.push({
      code: first,
      name: str(r[COL.name]),
      qty: num(r[COL.qty]),
      cost: num(r[COL.cost]),
      value: num(r[COL.value]),
    });
  }

  const totals = items.reduce(
    (a, it) => ({ items: a.items + 1, units: a.units + it.qty, value: a.value + it.value }),
    { items: 0, units: 0, value: 0 },
  );
  totals.units = Math.round(totals.units * 100) / 100;
  totals.value = Math.round(totals.value * 100) / 100;

  const negativeItems = items.filter((it) => it.qty < 0);
  const negative = {
    items: negativeItems.length,
    value: Math.round(negativeItems.reduce((a, it) => a + it.value, 0) * 100) / 100,
  };
  const zero = items.filter((it) => it.qty === 0).length;

  if (!items.length) {
    notes.push({ kind: 'empty', message: 'No stock items found. Check the export.' });
  }

  if (items.length && footer) {
    const off =
      footer.items !== totals.items ||
      Math.abs(footer.units - totals.units) >= 0.005 ||
      Math.abs(footer.value - totals.value) >= 0.005;
    if (off) {
      notes.push({
        kind: 'truncated',
        message:
          `The file says ${footer.items.toLocaleString('en-GB')} items, ` +
          `${footer.units.toLocaleString('en-GB')} units and ${footer.value.toFixed(2)}, ` +
          `but ${totals.items.toLocaleString('en-GB')}, ${totals.units.toLocaleString('en-GB')} ` +
          `and ${totals.value.toFixed(2)} were read. It is incomplete or was edited after export.`,
      });
    }
  }

  const blocking = notes.some((n) => n.kind === 'empty' || n.kind === 'truncated');
  return { ok: items.length > 0 && !blocking, items, footer, totals, negative, zero, notes };
}
