/**
 * BTMS chart of accounts — parser
 *
 * Source report: the account list, exported as XLS. BUILD.md §6.5.
 *
 * THE HEADER ROW IS OFFSET BY TWO. Row 0 reads
 *
 *   Phone · Type · Active · Header · Report Category · Credit Limit · Disc. %
 *
 * which is seven labels for nine columns, because the code and the name
 * are not labelled at all. "Phone" names column 2. Reading that row as
 * column names shifts every field by two and produces a chart in which
 * every account's type is its phone number. The columns are read by
 * position here and the header row is skipped, never interpreted.
 *
 * The last row is "Number Of  Records:" with the count beside it. It is a
 * footer, not an account — and it is BTMS's own control total, so the parse
 * is checked against it rather than trusted.
 *
 * Verified against A&F: 8.467 accounts — 8.113 debtors, 150 creditors,
 * 204 nominal, 10 header accounts, 18 report categories. Every one of the
 * 4.863 accounts posted to across six years of ledgers appears in it, with
 * no name disagreeing.
 */

import type { Note, Row } from './types.ts';

/** Column positions. The header row's labels do not line up with these. */
const COL = {
  code: 0,
  name: 1,
  phone: 2,
  type: 3,
  active: 4,
  header: 5,
  category: 6,
} as const;

/**
 * How many leading characters of a sub-account code name its control.
 * A&F's debtors are 221…, its creditors 311…, and neither 221 nor 311 is
 * itself an account: the control is implied by the numbering, not present
 * as a row.
 */
const CONTROL_LEN = 3;

/** The two types that carry one account per trading partner. */
const SUB_LEDGER_TYPES = new Set(['Debtor', 'Creditor']);

export type ChartAccount = {
  code: string;
  name: string;
  /** Debtors and creditors carry one; nominal accounts do not. */
  phone: string | null;
  /** Asset · Liability · Equity · Income · Expenditure · Debtor · Creditor */
  accountType: string | null;
  active: boolean;
  /** A section heading — CURRENT ASSETS, EXPENSES — not a postable account. */
  isHeader: boolean;
  /** BTMS's own "Report Category". Seeds the suggested mapping in P2. */
  btmsCategory: string | null;
  /** What a debtor or creditor rolls up to. Null for everything else. */
  controlCode: string | null;
};

export type ChartParse = {
  ok: boolean;
  accounts: ChartAccount[];
  /** The count off the file's own "Number Of Records:" footer. */
  reportedRecords: number | null;
  counts: {
    byType: Record<string, number>;
    headers: number;
    subLedger: number;
    nominal: number;
  };
  notes: Note[];
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Only a debtor or creditor rolls up. Deriving the control from the code
 * alone would be wrong: 31100034 is a supplier, and so is 31100 — they are
 * siblings, not parent and child, and the longest matching prefix says
 * otherwise. The type is what makes this exact.
 */
function controlFor(code: string, accountType: string | null): string | null {
  if (!accountType || !SUB_LEDGER_TYPES.has(accountType)) return null;
  return code.length > CONTROL_LEN ? code.slice(0, CONTROL_LEN) : null;
}

export function parseChartOfAccounts(rows: Row[]): ChartParse {
  const accounts: ChartAccount[] = [];
  const notes: Note[] = [];
  const seen = new Set<string>();
  let reportedRecords: number | null = null;
  let duplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const code = str(r[COL.code]);
    if (!code) continue;

    // The footer carries the count and ends the file.
    if (code.toLowerCase().startsWith('number of')) {
      const n = Number(r[1]);
      reportedRecords = Number.isFinite(n) ? n : null;
      continue;
    }

    // The header row, identified by its first label rather than by position,
    // because a future export may or may not repeat it per page.
    if (code === 'Phone') continue;

    // The journal listing and the detail ledger both start their rows with
    // these. Someone picking the wrong export should be told which one.
    if (code.startsWith('Journal:') || code.startsWith('Journal No') || code.startsWith('Account :-')) {
      notes.push({
        kind: 'wrong-export',
        message:
          'This is a journal listing or detail ledger, not a chart of accounts. ' +
          'Export the account list instead.',
        row: i + 1,
      });
      return {
        ok: false, accounts: [], reportedRecords: null,
        counts: { byType: {}, headers: 0, subLedger: 0, nominal: 0 },
        notes,
      };
    }

    const name = str(r[COL.name]);
    if (!name) {
      notes.push({ kind: 'unparsable-row', message: `Account ${code} has no name.`, row: i + 1 });
    }

    if (seen.has(code)) { duplicates++; continue; }
    seen.add(code);

    const accountType = str(r[COL.type]) || null;
    accounts.push({
      code,
      name,
      phone: str(r[COL.phone]) || null,
      accountType,
      active: r[COL.active] !== 0,
      isHeader: r[COL.header] === 1,
      btmsCategory: str(r[COL.category]) || null,
      controlCode: controlFor(code, accountType),
    });
  }

  const byType: Record<string, number> = {};
  let headers = 0, subLedger = 0;
  for (const a of accounts) {
    const t = a.accountType ?? 'unknown';
    byType[t] = (byType[t] ?? 0) + 1;
    if (a.isHeader) headers++;
    if (a.accountType && SUB_LEDGER_TYPES.has(a.accountType)) subLedger++;
  }

  if (accounts.length === 0) {
    notes.push({ kind: 'empty', message: 'No accounts found. Check the export is the account list.' });
  }

  // BTMS's own count. A short export is the danger here exactly as it is for
  // the ledger, and this file states what it should contain.
  if (accounts.length && reportedRecords !== null && reportedRecords !== accounts.length) {
    notes.push({
      kind: 'truncated',
      message:
        `The file says it holds ${reportedRecords.toLocaleString('en-GB')} accounts but ` +
        `${accounts.length.toLocaleString('en-GB')} were read. It is incomplete or was edited after export.`,
    });
  }

  if (duplicates) {
    notes.push({
      kind: 'unparsable-row',
      message: `${duplicates} duplicate account code${duplicates === 1 ? '' : 's'} ignored; the first of each was kept.`,
    });
  }

  const blocking = notes.some(
    (n) => n.kind === 'empty' || n.kind === 'truncated' || n.kind === 'wrong-export',
  );

  return {
    accounts,
    reportedRecords,
    counts: { byType, headers, subLedger, nominal: accounts.length - subLedger },
    notes,
    ok: accounts.length > 0 && !blocking,
  };
}
