// The boundary between the verified parser and the import pipeline.
//
// journalListing.ts is the artifact the acceptance figures were measured
// against — 21.408 postings, 1.206 accounts, debits = credits = 6.922.666,98,
// and all 1.297 journal control totals agreeing — so it is kept exactly as
// verified and maps nothing itself. This file is the only place that knows
// both shapes, and it is where every difference between them is written down.
//
// What the journal listing cannot give, and why:
//
//   * Account names come off the posting rows (column 4). The report is
//     grouped by journal and has no account sections at all, so there is no
//     alt code and no account type anywhere in it. Those belong to the chart
//     of accounts import (P2) — which is why the accounts written from here
//     carry code and name only, and must never blank the other two.
//   * There are no opening balances in this report. They are the trial
//     balance's (§6.2).
//   * postings.source_origin is a smallint; the listing's journal origin is
//     free text, so it is carried only when it really is a number.

import type { LedgerParse, Note, Posting } from './types.ts';
import type { ParseResult } from './journalListing.ts';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const isoMonth = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

/**
 * Which of the parser's problems this is. The kind decides whether the import
 * screen refuses the file outright, so a new problem string that falls through
 * to the default is still treated as blocking rather than quietly shown.
 */
function classify(problem: string): Note['kind'] {
  if (problem.startsWith('No postings found')) return 'empty';
  if (problem.startsWith('A posting appears before any journal header')) return 'wrong-export';
  if (problem.startsWith('Debits and credits do not agree')) return 'truncated';
  return 'account-total-mismatch';
}

/** Numbers only: the origin column is text and the column is a smallint. */
function originAsNumber(origin: string): number | null {
  const t = origin.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

export function toLedgerParse(r: ParseResult): LedgerParse {
  // First name wins: the same account is named identically on every row, and
  // taking the first avoids a scan that would only confirm it.
  const names = new Map<string, string>();
  for (const p of r.postings) {
    if (p.accountName && !names.has(p.accountCode)) names.set(p.accountCode, p.accountName);
  }
  for (const code of r.accountCodes) if (!names.has(code)) names.set(code, '');

  const notes: Note[] = r.problems.map((message) => ({ kind: classify(message), message }));

  // Not a reason to refuse the file, but a person should see it before these
  // figures are reported on: an unposted journal is already in the totals
  // below and can still be changed in BTMS.
  if (r.unpostedJournals > 0) {
    notes.push({
      kind: 'unposted-journals',
      message:
        `${r.unpostedJournals} journal${r.unpostedJournals === 1 ? ' is' : 's are'} not posted in BTMS. ` +
        'Their postings are counted in these totals and can still change.',
    });
  }

  return {
    ok: r.problems.length === 0,
    accounts: [...names].map(([code, name]) => ({
      code,
      name,
      altCode: null,
      accountType: null,
    })),
    postings: r.postings.map((p): Posting => ({
      accountCode: p.accountCode,
      accountName: p.accountName,
      postedOn: isoDate(p.postedOn),
      periodMonth: isoMonth(p.postedOn),
      reference: p.reference || null,
      details: p.narrative || null,
      debit: p.debit,
      credit: p.credit,
      vatCode: p.vatCode,
      vatRate: p.vatRate,
      vatAmount: p.vatAmount,
      journalCode: p.journalCode || null,
      journalNo: p.journalNo || null,
      batchNo: p.batchNo || null,
      sourceOrigin: originAsNumber(p.journalOrigin),
    })),
    totals: { debit: r.totalDebit, credit: r.totalCredit },
    monthsCovered: r.monthsCovered.map((m) => `${m}-01`),
    notes,
  };
}
