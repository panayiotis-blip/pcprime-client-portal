// The trial balance. Specification: docs/reporting/BUILD.md §6.2, verified
// against A&F's July 2026 export.
//
// Two layouts exist; standardise on the one with debtors and creditors in
// DETAIL rather than control totals, which is what `detailed` reports.
//
// The header row names seven columns and the data rows use eight: column 2 is
// empty and everything from Type onwards sits one to the right. Reading the
// header and trusting it puts the opening balance in the Type column and every
// figure one place out — the same offset trap as the journal listing.
//
//   header : Code | Name | Type | Opening Bal. | Debit | Credit | Closing Bal.
//   data   : Code | Name | (nil)| Type         | Opening | Debit | Credit | Closing

import type { Note, Row, TrialBalanceParse, TrialBalanceRow } from './types.ts';
import { cents, filled, num, str } from './cells.ts';

const COL = { code: 0, name: 1, type: 3, opening: 4, debit: 5, credit: 6, closing: 7 } as const;

/** Account types BTMS gives a debtor or creditor ledger account. */
const DETAIL_TYPES = new Set(['debtor', 'creditor']);

export function parseTrialBalance(rows: Row[]): TrialBalanceParse {
  const notes: Note[] = [];
  const out: TrialBalanceRow[] = [];
  let reportTotal: TrialBalanceParse['reportTotal'] = null;
  let detailAccounts = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (filled(row) === 0) continue;
    const first = str(row[COL.code]);
    if (!first) continue;

    // The report's own footer line. Keep it: the reconciliation screen proves
    // the parsed rows against it, and a difference here is a parse error, not
    // a bookkeeping one.
    if (/^Report\s+Total/i.test(first)) {
      reportTotal = {
        opening: num(row[1]),
        debit: num(row[2]),
        credit: num(row[3]),
        closing: num(row[4]),
        records: num(row[6]),
      };
      continue;
    }

    if (/^Code$/i.test(first)) continue;                       // the header row
    if (/^B\.T\.M\.S/i.test(first) || /^Page\s*-/i.test(first)) continue;

    const name = str(row[COL.name]);
    const type = str(row[COL.type]);
    // A row with no name and no figures is page furniture.
    if (!name && filled(row) < 4) continue;

    const opening = num(row[COL.opening]);
    const debit = num(row[COL.debit]);
    const credit = num(row[COL.credit]);
    const closing = num(row[COL.closing]);

    if (type && DETAIL_TYPES.has(type.toLowerCase())) detailAccounts++;

    out.push({
      accountCode: first,
      accountName: name ?? '',
      accountType: type,
      opening, debit, credit, closing,
    });
  }

  if (out.length === 0) {
    notes.push({ kind: 'empty', message: 'No trial balance rows were found in this file.' });
  }

  // Prove the parse against the report's own total before anything downstream
  // trusts it. A mismatch here means rows were missed or double-counted.
  if (reportTotal) {
    const sumDebit = cents(out.reduce((a, r) => a + r.debit, 0));
    const sumCredit = cents(out.reduce((a, r) => a + r.credit, 0));
    if (Math.abs(sumDebit - reportTotal.debit) > 0.01 || Math.abs(sumCredit - reportTotal.credit) > 0.01) {
      notes.push({
        kind: 'account-total-mismatch',
        message:
          `Parsed ${sumDebit.toFixed(2)} / ${sumCredit.toFixed(2)} against the report's own ` +
          `${reportTotal.debit.toFixed(2)} / ${reportTotal.credit.toFixed(2)}. The file has not been read correctly.`,
      });
    }
    if (reportTotal.records && Math.abs(reportTotal.records - out.length) > 0) {
      notes.push({
        kind: 'account-total-mismatch',
        message: `The report states ${reportTotal.records} records; ${out.length} were read.`,
      });
    }
  } else {
    notes.push({
      kind: 'wrong-export',
      message:
        'This file carries no "Report Total :" line, so the parse cannot be proved ' +
        'against the report itself. Export again as Data only (XLS).',
    });
  }

  return {
    ok: out.length > 0 && !notes.some((n) => n.kind === 'account-total-mismatch'),
    rows: out,
    reportTotal,
    detailed: detailAccounts > 0,
    notes,
  };
}
