// Cell-level helpers shared by the BTMS parsers.

import type { Cell, Row } from './types.ts';

/** How many cells in the row actually carry something. */
export function filled(row: Row): number {
  let n = 0;
  for (const c of row) if (c !== null && c !== undefined && c !== '') n++;
  return n;
}

export function str(c: Cell): string | null {
  if (c === null || c === undefined) return null;
  const s = String(c).trim();
  return s === '' ? null : s;
}

/**
 * A figure. BTMS writes numbers as numbers in the data-only export, but a
 * column can still arrive as text with thousands separators when someone
 * re-saves the file, and "1.234,56" and "1,234.56" both occur in the wild.
 * Anything that is not a number is 0 rather than NaN: a NaN in a debit column
 * silently poisons every total downstream.
 */
export function num(c: Cell): number {
  if (typeof c === 'number') return Number.isFinite(c) ? c : 0;
  if (c === null || c === undefined) return 0;
  let s = String(c).trim();
  if (s === '' || s === '-') return 0;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export function intOrNull(c: Cell): number | null {
  if (c === null || c === undefined || c === '') return null;
  const n = num(c);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Excel serial to ISO date. The 1900 system with its deliberate 1900-02-29
 * that never existed: serial 60 is that phantom day, so anything above it is
 * one day out unless the epoch is stepped back accordingly.
 *
 * Serials below 1000 are rejected. That is what catches the T-Analysis trap:
 * a tag row carrying "002" would otherwise parse as 1900-01-01 and post a
 * phantom entry — 127 of them, in an early build.
 */
export function serialToISO(c: Cell): string | null {
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  if (c < 1000 || c > 80000) return null;          // ~1902 to ~2119
  const days = Math.floor(c);
  const epoch = Date.UTC(1899, 11, 30);            // 1900 system, phantom leap day
  const d = new Date(epoch + days * 86400000);
  return d.toISOString().slice(0, 10);
}

/** First day of the month an ISO date falls in. */
export function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01';
}

/** Rounds to cents, so a sum of floats compares honestly against a report total. */
export function cents(n: number): number {
  return Math.round(n * 100) / 100;
}
