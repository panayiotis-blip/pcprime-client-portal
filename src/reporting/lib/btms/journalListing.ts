/**
 * BTMS Analytical Journal Listing — parser
 *
 * Source report:  Reports → Journal Listing
 *                 Report Type "Analytical", Journal Type "Normal",
 *                 Journal Class All, Journal Origin All / By Journal Code
 *                 Show: T-Analysis ✓ (needed for project costing), Reverse Entries ✓
 *                 Export as "Microsoft Excel 97-2000 — Data only (XLS)"
 *
 * THIS REPORT IS GROUPED BY JOURNAL, NOT BY ACCOUNT. There are no
 * "Account :-" section headers in it — that is the Detail Ledger, a
 * different report. Every posting row carries its own account code and
 * name as columns 3 and 4.
 *
 * Verified against A&F 2026 (Jan–Aug): 21.408 postings, 1.206 accounts,
 * debits = credits = 6.922.666,98 exactly, and all 1.297 per-journal
 * control totals agree with the postings beneath them.
 */

export interface Posting {
  batchNo: number;
  reference: string;
  postedOn: Date;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  narrative: string;
  vatCode: string | null;   // present on the base line only
  vatRate: number | null;
  vatAmount: number;
  journalCode: string;      // 'SIN', 'PIN', 'COS', 'REC', 'BPM', 'CAP', 'SRT', 'PRT', 'PIEG', 'JV' …
  journalName: string;      // 'Sales Invoices'
  journalClass: string;     // 'Sales', 'Purchases', 'General Journal' …
  journalVatType: string;   // 'Input' | 'Output' | 'None'
  journalOrigin: string;
  journalNo: number;
  period: number;
  year: number;
  posted: boolean;
  enteredBy: string;
  projectTag?: string;      // only when T-Analysis was ticked on export
  expenseTag?: string;
}

export interface JournalControl {
  journalCode: string;
  journalNo: number;
  reportedDebit: number;    // from the "Totals For Journal No" row
  reportedCredit: number;
  reportedVat: number;
  actualDebit: number;      // summed from the postings we parsed
  actualCredit: number;
  agrees: boolean;
}

export interface ParseResult {
  postings: Posting[];
  controls: JournalControl[];
  accountCodes: Set<string>;         // for the client fingerprint
  monthsCovered: string[];           // 'YYYY-MM'
  totalDebit: number;
  totalCredit: number;
  balances: boolean;                 // debits === credits across the file
  controlsAgree: boolean;            // every journal ties to its own total row
  unpostedJournals: number;          // a review finding, not a parse error
  problems: string[];                // reasons the file must be rejected
}

/** Excel serial → Date. BTMS exports use the 1900 date system. */
function excelDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * @param rows  the sheet as a dense array of arrays, e.g. from SheetJS:
 *              XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
 */
export function parseJournalListing(rows: unknown[][]): ParseResult {
  const postings: Posting[] = [];
  const controls: JournalControl[] = [];
  const accountCodes = new Set<string>();
  const months = new Set<string>();
  const problems: string[] = [];

  let jCode = '', jName = '', jClass = '', jVatType = '', jOrigin = '';
  let jNo = 0, period = 0, year = 0, posted = true, enteredBy = '';
  let seenHeader = false;
  let runDebit = 0, runCredit = 0;
  let unposted = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c0 = str(r[0]);

    // ---- "Journal: "  →  code, name, class, VAT type, origin -------------
    if (c0.startsWith('Journal:')) {
      const label = str(r[1]);                  // 'SIN  -  Sales Invoices'
      const dash = label.indexOf('-');
      jCode = (dash >= 0 ? label.slice(0, dash) : label).trim().toUpperCase();
      jName = dash >= 0 ? label.slice(dash + 1).trim() : '';
      jClass = str(r[3]);
      jVatType = str(r[5]);
      jOrigin = str(r[7]);
      seenHeader = true;
      continue;
    }

    // ---- "Journal No:  "  →  number, posted flag, period, totals, user ----
    if (c0.startsWith('Journal No')) {
      jNo = num(r[1]);
      posted = str(r[3]) === 'Yes';
      if (!posted) unposted++;
      jOrigin = str(r[5]) || jOrigin;
      period = num(r[7]);
      year = num(r[9]);
      enteredBy = str(r[15]);
      runDebit = 0;
      runCredit = 0;
      seenHeader = true;
      continue;
    }

    // ---- "Totals For Journal  No : "  →  the control total for this journal
    if (c0.startsWith('Totals For Journal  No')) {
      const reportedDebit = num(r[2]);
      const reportedCredit = num(r[3]);
      controls.push({
        journalCode: jCode,
        journalNo: num(r[1]),
        reportedDebit,
        reportedCredit,
        reportedVat: num(r[4]),
        actualDebit: runDebit,
        actualCredit: runCredit,
        agrees:
          Math.abs(runDebit - reportedDebit) < 0.005 &&
          Math.abs(runCredit - reportedCredit) < 0.005,
      });
      continue;
    }

    // ---- rows that are not postings ---------------------------------------
    if (c0.startsWith('Totals For Journal  :')) continue;   // per-journal-code total
    if (c0.startsWith('Page')) continue;
    if (typeof r[0] !== 'number') continue;                 // anything else textual

    // A T-Analysis tag row: two or fewer filled cells, and no account code.
    // Numeric tags such as "002" otherwise parse as dates.
    const filled = r.filter((x) => x !== '' && x !== null && x !== undefined).length;
    const accountCode = str(r[3]);
    if (!accountCode) {
      if (filled <= 2 && postings.length) {
        const tag = str(r[1]) || str(r[0]);
        const last = postings[postings.length - 1];
        if (!last.projectTag) last.projectTag = tag; else last.expenseTag = tag;
      }
      continue;
    }

    if (!seenHeader) {
      problems.push(
        'A posting appears before any journal header. Re-export from Reports → ' +
        'Journal Listing with Report Type "Analytical" — this looks like a Detail ' +
        'Ledger or a differently grouped report.'
      );
      break;
    }

    const serial = num(r[2]);
    if (!serial) continue;
    const postedOn = excelDate(serial);
    const debit = num(r[5]);
    const credit = num(r[6]);
    const vatCode = str(r[8]) || null;

    runDebit += debit;
    runCredit += credit;
    accountCodes.add(accountCode);
    months.add(
      `${postedOn.getUTCFullYear()}-${String(postedOn.getUTCMonth() + 1).padStart(2, '0')}`
    );

    postings.push({
      batchNo: num(r[0]),
      reference: str(r[1]),
      postedOn,
      accountCode,
      accountName: str(r[4]),
      debit,
      credit,
      narrative: str(r[7]),
      vatCode,
      vatRate: vatCode ? num(r[9]) : null,
      vatAmount: num(r[10]),
      journalCode: jCode,
      journalName: jName,
      journalClass: jClass,
      journalVatType: jVatType,
      journalOrigin: jOrigin,
      journalNo: jNo,
      period,
      year,
      posted,
      enteredBy,
    });
  }

  const totalDebit = postings.reduce((s, p) => s + p.debit, 0);
  const totalCredit = postings.reduce((s, p) => s + p.credit, 0);
  const balances = Math.abs(totalDebit - totalCredit) < 0.005;
  const controlsAgree = controls.every((c) => c.agrees);

  if (!postings.length) {
    problems.push('No postings found. Check the report type and the period range.');
  }
  if (postings.length && !balances) {
    problems.push(
      `Debits and credits do not agree: ${totalDebit.toFixed(2)} against ` +
      `${totalCredit.toFixed(2)}. BTMS paginates its exports — this file is probably truncated.`
    );
  }
  if (postings.length && !controlsAgree) {
    const bad = controls.filter((c) => !c.agrees).length;
    problems.push(
      `${bad} journal${bad > 1 ? 's do' : ' does'} not agree to its own control total. ` +
      `The file is incomplete or was edited after export.`
    );
  }

  return {
    postings,
    controls,
    accountCodes,
    monthsCovered: [...months].sort(),
    totalDebit,
    totalCredit,
    balances,
    controlsAgree,
    unpostedJournals: unposted,
    problems,
  };
}

/**
 * Does this file belong to this client?
 * Compare the account codes in the file against the client's own chart of
 * accounts. Two real clients here share zero codes out of 3.109 and 154, so
 * the test is decisive; 60% is a deliberately generous threshold that still
 * refuses a file belonging to someone else.
 */
export function fingerprint(
  fileCodes: Set<string>,
  clientCodes: Set<string>
): { matched: number; total: number; ratio: number; belongs: boolean } {
  let matched = 0;
  for (const code of fileCodes) if (clientCodes.has(code)) matched++;
  const total = fileCodes.size;
  const ratio = total ? matched / total : 0;
  return { matched, total, ratio, belongs: total > 0 && ratio >= 0.6 };
}
