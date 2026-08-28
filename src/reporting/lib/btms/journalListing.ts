// The analytical journal listing — the audit trail, and the primary feed.
// Specification: docs/reporting/BUILD.md §6.1, verified against A&F's own
// 2024, 2025 and 01-07 2026 exports.
//
// Export settings this parser expects (BTMS → "Microsoft Excel 97-2000 —
// Data only (XLS)"): Account Types All · Based On Trans.Date · all four
// transaction classes · Opening Balance and T-Analysis ticked · Show Contra
// Account ticked · Sort by Account · Group by None · New Page boxes unticked.
//
// The file carries the client's name NOWHERE, which is why nothing here tries
// to identify the client from it. That is fingerprint.ts's job, against the
// account codes, and it happens before a single row is written.

import type { Account, LedgerParse, Note, OpeningBalance, Posting, Row } from './types.ts';
import { cents, filled, intOrNull, monthStart, num, serialToISO, str } from './cells.ts';

/**
 * The XLS row cap. A BIFF worksheet holds 65.536 rows and not one more, so an
 * export bigger than that is silently cut off — no warning in BTMS, no marker
 * in the file. A&F's 2021-2026 journal listing hits it exactly, and would
 * import as a plausible-looking ledger missing everything after the cap.
 */
export const XLS_ROW_CAP = 65536;

// "Account :-  1630   Name :-   Computers - Cost   Alternative Code :-   Account Type :- Asset"
const ACCOUNT_RE =
  /^Account\s*:-\s*(\S+)\s+Name\s*:-\s*(.*?)\s*Alternative\s*Code\s*:-\s*(.*?)\s*Account\s*Type\s*:-\s*(.*)$/i;

const COL = {
  date: 0, reference: 1, details: 2, debit: 4, credit: 5, running: 6,
  vatCode: 7, vatRate: 8, vatAmount: 9, journalCode: 10, journalNo: 11,
  batch: 12, origin: 13,
} as const;

export function parseJournalListing(rows: Row[]): LedgerParse {
  const notes: Note[] = [];
  const postings: Posting[] = [];
  const accounts: Account[] = [];
  const openingBalances: OpeningBalance[] = [];
  const seenAccounts = new Set<string>();
  const months = new Set<string>();
  const skipped = { accountTotals: 0, journalTotals: 0, openings: 0, tagRows: 0 };

  let account: Account | null = null;
  let totalDebit = 0;
  let totalCredit = 0;

  if (rows.length >= XLS_ROW_CAP) {
    notes.push({
      kind: 'truncated',
      message:
        `This file has ${rows.length.toLocaleString('en-GB')} rows — the maximum an .xls worksheet ` +
        `can hold. BTMS has cut the export off at that point, so postings are missing from the end ` +
        `of it. Export a shorter period (a year at a time) and import them one after another.`,
    });
    return {
      ok: false, postings, accounts, openingBalances,
      totals: { debit: 0, credit: 0 }, monthsCovered: [], skipped, notes,
    };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const first = str(row[0]);
    const n = filled(row);

    if (n === 0) continue;

    // ---- account section header -------------------------------------
    if (first && /^Account\s*:-/i.test(first)) {
      const m = ACCOUNT_RE.exec(first);
      if (!m) {
        notes.push({ kind: 'unparsable-row', row: i + 1, message: `Account header not understood: ${first}` });
        account = null;
        continue;
      }
      account = { code: m[1], name: m[2].trim(), altCode: m[3].trim() || null, accountType: m[4].trim() || null };
      if (!seenAccounts.has(account.code)) { seenAccounts.add(account.code); accounts.push(account); }
      continue;
    }

    // ---- rows that must never become postings ------------------------
    // Including the account totals produced 134 phantom accounts and €1,4m of
    // fake debits in an early build; the journal totals do the same thing.
    if (first && /^Totals?\s+For\s+Account/i.test(first)) { skipped.accountTotals++; continue; }
    if (first && /^Totals?\s+For\s+Journal/i.test(first)) { skipped.journalTotals++; continue; }

    // The BTMS footer and page furniture.
    if (first && (/^B\.T\.M\.S/i.test(first) || /^Page\s*-/i.test(first) || /^Report\s+Total/i.test(first))) continue;

    // Opening balances are balances, not postings.
    if (row.some((c) => typeof c === 'string' && /^Opening\s+Balance$/i.test(c.trim()))) {
      skipped.openings++;
      if (account) {
        const d = num(row[COL.debit]);
        const c = num(row[COL.credit]);
        openingBalances.push({ accountCode: account.code, debit: d, credit: c, balance: num(row[COL.running]) });
      }
      continue;
    }

    // A T-Analysis tag row carries two cells or fewer. Numeric tags such as
    // "002" otherwise parse as dates and post phantom 1900-01-01 entries.
    if (n <= 2) { skipped.tagRows++; continue; }

    // ---- a posting ---------------------------------------------------
    const postedOn = serialToISO(row[COL.date]);
    if (!postedOn) {
      notes.push({
        kind: 'unparsable-row', row: i + 1,
        message: `Row has no usable transaction date in the first column: ${JSON.stringify(row.slice(0, 4))}`,
      });
      continue;
    }
    if (!account) {
      // A posting before any "Account :-" header means the file was exported
      // with Sort by Account off. Nothing can be attributed, so stop rather
      // than guess.
      notes.push({
        kind: 'wrong-export', row: i + 1,
        message:
          'A posting appears before any account section. Re-export with Sort by ' +
          'Account and Group by None — this file is grouped some other way.',
      });
      return {
        ok: false, postings, accounts, openingBalances,
        totals: { debit: 0, credit: 0 }, monthsCovered: [], skipped, notes,
      };
    }

    // BTMS writes a reversal as a NEGATIVE figure in the same column rather
    // than as an entry on the other side. Taken literally the two legs net
    // inside one column, and the month's movement understates by the size of
    // the reversal on BOTH sides. It hides, too: the trial balance nets the
    // pair as well, so ledger and trial balance agree while both are short.
    //
    // Gross them, the same principle as the reverse-charge VAT rule in §12: a
    // negative debit IS a credit. A&F's July 2026 is exactly this — three
    // negative debits of 1,64 / 1,32 / 0,36 on 7281 Electricity and Heat, and
    // grossing them is what turns a movement of 1.090.456,09 into the
    // 1.090.459,41 in §10, leaving 7281 as the single account differing from
    // the trial balance by 3,32 on each side.
    let debit = num(row[COL.debit]);
    let credit = num(row[COL.credit]);
    if (debit < 0) { credit -= debit; debit = 0; }
    if (credit < 0) { debit -= credit; credit = 0; }
    totalDebit += debit;
    totalCredit += credit;
    const periodMonth = monthStart(postedOn);
    months.add(periodMonth);

    postings.push({
      accountCode: account.code,
      accountName: account.name,
      postedOn,
      periodMonth,
      reference: str(row[COL.reference]),
      details: str(row[COL.details]),
      debit,
      credit,
      vatCode: str(row[COL.vatCode]),
      vatRate: row[COL.vatRate] === null || row[COL.vatRate] === '' ? null : num(row[COL.vatRate]),
      vatAmount: num(row[COL.vatAmount]),   // already signed by BTMS
      journalCode: str(row[COL.journalCode]),
      journalNo: intOrNull(row[COL.journalNo]),
      batchNo: intOrNull(row[COL.batch]),
      sourceOrigin: intOrNull(row[COL.origin]),
    });
  }

  if (postings.length === 0) {
    notes.push({
      kind: 'empty',
      message:
        'No postings were found. Either the period holds none, or this is the ' +
        'standard Excel export rather than "Data only (XLS)".',
    });
  }

  return {
    ok: postings.length > 0,
    postings,
    accounts,
    openingBalances,
    totals: { debit: cents(totalDebit), credit: cents(totalCredit) },
    monthsCovered: [...months].sort(),
    skipped,
    notes,
  };
}
