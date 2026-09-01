// The gate on the client's BTMS folder: is this file saved correctly?
//
// Staff save their exports here at the end of a posting session, and the
// reporting application reads them later, unattended. A file that was exported
// the wrong way does not announce itself — it imports, quietly, and the figures
// come out wrong. By then the person who exported it has moved on and the only
// evidence of what went wrong is a difference in a report nobody can explain.
//
// So the file is parsed BEFORE it is stored, and it is refused if it cannot be
// trusted. Every check here is a real failure that has already happened in this
// build, not a hypothetical:
//
//   - a chart of accounts that stopped at 1.000 of 1.206 rows, and refused its
//     own client's ledger as a stranger's
//   - a paysheet whose grand-totals row was read as an employee, doubling the
//     last person's pay
//   - a stock valuation exported without its GrandTotals footer, so nothing
//     could tell a truncated file from a complete one
//   - a journal listing exported by account instead of by journal, which parses
//     to zero postings and reports no error at all
//
// Every one of those is caught by comparing the file against a total the file
// itself states. That is the whole method: BTMS prints its own control figures,
// and a file that does not agree with itself is not a file we store.
//
// Two tiers. A FEED is something the reporting application reads, and it must
// pass. EVIDENCE — bank statements, and anything else kept for the review — is
// not parsed, because there is nothing to parse it against; it is stored with a
// period and whoever saved it, so it can be found again.

import { readSheetRows, sha256 } from './sheet.ts';
import { identify, type FeedKind } from './folder.ts';
import { parseJournalListing } from '../btms/journalListing.ts';
import { parseChartOfAccounts } from '../btms/chartOfAccounts.ts';
import { parseTrialBalance } from '../btms/trialBalance.ts';
import { parseStockValuation } from '../btms/stockValuation.ts';
import { parseCostAnalysis, parsePaysheet } from '../btms/payroll.ts';
import type { Row } from '../btms/types.ts';

/** What a file is kept as. The feeds are read; the rest is evidence. */
export type DocKind = FeedKind
  | 'bank_statement' | 'detailed_ledger' | 'vat_return' | 'sales_listing' | 'other';

export type Verdict = 'ok' | 'warning' | 'blocked';

export type FileCheck = {
  kind: DocKind;
  label: string;
  /** What the file appears to be, in the operator's words. */
  summary: string;
  verdict: Verdict;
  /** Why it must not be stored as it is. Empty unless blocked. */
  problems: string[];
  /** Worth saying; not worth refusing over. */
  warnings: string[];
  /** The file's own figures, so a person can recognise it. */
  facts: { label: string; value: string }[];
  /** A period the file states INSIDE itself. Null when it states none. */
  period: string | null;
  /** Whether a period has to be supplied by hand before this can be stored. */
  needsPeriod: boolean;
  /** Content hash, for spotting the same file saved twice. */
  digest: string;
};

export const KIND_LABEL: Record<DocKind, string> = {
  chart: 'Chart of accounts',
  ledger: 'Journal listing',
  trial_balance: 'Trial balance',
  trial_balance_wide: 'Trial balance (wide layout)',
  stock: 'Stock valuation',
  payroll_cost: 'Payroll — cost analysis',
  payroll_sheet: 'Payroll — paysheet',
  vat_summary: 'VAT figures summary',
  detailed_ledger: 'Detailed ledger',
  vat_return: 'VAT return as filed',
  sales_listing: 'Sales invoice listing',
  bank_statement: 'Bank statement',
  other: 'Other document',
  unknown: 'Not recognised',
};

/** The feeds the reporting application actually reads. */
export const FEEDS: DocKind[] = [
  'chart', 'ledger', 'trial_balance', 'stock', 'payroll_cost', 'payroll_sheet',
];

/**
 * The two feeds that state no period anywhere inside them. A trial balance is
 * a position at a date and a stock valuation is a count on a day, and neither
 * export prints which — so a person supplies it, beside the file, at the time
 * of saving rather than from memory months later.
 */
const NEEDS_PERIOD: DocKind[] = ['trial_balance', 'stock'];

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString('en-GB');
/** Money compared in whole cents; a float difference is not a difference. */
const c = (n: number) => Math.round(n * 100);
const differs = (a: number, b: number) => c(a) !== c(b);

const SPREADSHEET = /\.xlsx?$/i;

/**
 * Decide whether a file is fit to be stored in a client's BTMS folder.
 *
 * `declared` is what a person says an unrecognised file is. It is only ever
 * consulted when the file does not recognise itself: a BTMS export is what it
 * reads as, never what somebody says it is.
 */
export async function checkBtmsFile(
  file: File,
  declared?: DocKind,
  /** The client this file is being saved against, for the one export that names one. */
  expect?: { companyName?: string | null },
): Promise<FileCheck> {
  const digest = await sha256(file);
  const base = {
    problems: [] as string[],
    warnings: [] as string[],
    facts: [] as { label: string; value: string }[],
    period: null as string | null,
    needsPeriod: false,
    digest,
  };

  if (file.size === 0) {
    return {
      ...base, kind: 'other', label: 'Empty file', summary: 'The file has no content',
      verdict: 'blocked', problems: ['The file is empty — nothing was exported into it.'],
    };
  }

  // Not a spreadsheet: evidence. There is no control total to check it against,
  // so it is stored on the strength of somebody saying what it is.
  if (!SPREADSHEET.test(file.name)) {
    const kind: DocKind = declared && declared !== 'unknown' ? declared : 'other';
    return {
      ...base,
      kind,
      label: KIND_LABEL[kind],
      summary: 'Kept with the client as supporting evidence — not read by the reporting app',
      verdict: kind === 'other' && !declared ? 'warning' : 'ok',
      warnings: kind === 'other' && !declared
        ? ['Say what this is, so whoever reviews the period can tell what they are looking at.']
        : [],
      facts: [{ label: 'Size', value: `${Math.round(file.size / 1024).toLocaleString('en-GB')} KB` }],
    };
  }

  let rows: Row[];
  try {
    rows = await readSheetRows(file);
  } catch (e) {
    return {
      ...base, kind: 'unknown', label: 'Unreadable', summary: 'Could not be opened as a spreadsheet',
      verdict: 'blocked',
      problems: [
        'This file could not be opened as a spreadsheet: ' +
        (e instanceof Error ? e.message : String(e)) +
        '. Export it again from BTMS as Excel.',
      ],
    };
  }

  const { kind, summary } = identify(rows as unknown[][]);
  const shell = { ...base, kind: kind as DocKind, label: KIND_LABEL[kind], summary };

  switch (kind) {
    case 'ledger': return finish({ ...shell, ...checkLedger(rows) });
    case 'chart': return finish({ ...shell, ...checkChart(rows) });
    case 'trial_balance': return finish({ ...shell, ...checkTrialBalance(rows) });
    case 'trial_balance_wide': return finish({ ...shell, ...checkWideTrialBalance(rows, expect) });
    case 'stock': return finish({ ...shell, ...checkStock(rows) });
    case 'payroll_cost': return finish({ ...shell, ...checkCostAnalysis(rows) });
    case 'payroll_sheet': return finish({ ...shell, ...checkPaysheet(rows) });
    case 'vat_summary':
      return finish({
        ...shell,
        warnings: ['Kept with the client, but the reporting app has no feed for this yet — the VAT figures are built from the postings.'],
      });
    default:
      // A spreadsheet that recognises itself as nothing. Almost always a BTMS
      // export taken with the wrong option: the analytical journal listing
      // exported by account instead of by journal is the common one, and it
      // parses to nothing rather than failing.
      if (declared && declared !== 'unknown') {
        return finish({
          ...shell, kind: declared, label: KIND_LABEL[declared],
          summary: 'Kept with the client as supporting evidence — not read by the reporting app',
        });
      }
      return finish({
        ...shell,
        problems: [
          'This is not a BTMS export the reporting app knows. If it is a journal listing, ' +
          'check it was exported ANALYTICALLY — grouped by journal, not by account. ' +
          'If it is something else being kept for the review, say what it is and it will be stored as evidence.',
        ],
      });
  }
}

/** The verdict follows from the findings; nothing sets it by hand. */
function finish(f: Omit<FileCheck, 'verdict'> & { verdict?: Verdict }): FileCheck {
  return {
    ...f,
    needsPeriod: NEEDS_PERIOD.includes(f.kind) && !f.period,
    verdict: f.problems.length ? 'blocked' : f.warnings.length ? 'warning' : 'ok',
  };
}

type Findings = Partial<Pick<FileCheck, 'problems' | 'warnings' | 'facts' | 'period'>>;

// ---- the journal listing ---------------------------------------------
//
// The one file everything else rests on. It states a control total for every
// journal in it, so a listing that is complete can prove it.

function checkLedger(rows: Row[]): Findings {
  const p = parseJournalListing(rows as unknown[][]);
  const problems = [...p.problems];
  const warnings: string[] = [];

  if (!p.postings.length) {
    problems.push(
      'No postings were found. A journal listing must be exported ANALYTICALLY — ' +
      'grouped by journal. Exported by account it looks similar and contains nothing this can read.',
    );
  }
  if (!p.balances) {
    problems.push(
      `Debits and credits do not agree: ${eur(p.totalDebit)} against ${eur(p.totalCredit)}, ` +
      `a difference of ${eur(Math.abs(p.totalDebit - p.totalCredit))}. ` +
      'A complete listing always balances, so this one is partial.',
    );
  }
  if (!p.controlsAgree) {
    const bad = p.controls.filter((x) => !x.agrees);
    const first = bad.slice(0, 3)
      .map((x) => `${x.journalCode} ${x.journalNo} (states ${eur(x.reportedDebit)}, contains ${eur(x.actualDebit)})`)
      .join('; ');
    problems.push(
      `${int(bad.length)} of ${int(p.controls.length)} journals do not agree with their own totals row: ` +
      first + (bad.length > 3 ? '; and others.' : '.') +
      ' The export was filtered or cut short.',
    );
  }
  if (p.unpostedJournals > 0) {
    warnings.push(
      `${int(p.unpostedJournals)} journals are unposted. They are in the file and will be imported — ` +
      'if they should not be, post or remove them in BTMS and export again.',
    );
  }

  const months = p.monthsCovered.slice().sort();
  return {
    problems,
    warnings,
    period: months.length ? (months.length === 1 ? months[0] : `${months[0]} to ${months[months.length - 1]}`) : null,
    facts: [
      { label: 'Postings', value: int(p.postings.length) },
      { label: 'Journals', value: int(p.controls.length) },
      { label: 'Accounts', value: int(p.accountCodes.size) },
      { label: 'Debits', value: eur(p.totalDebit) },
      { label: 'Credits', value: eur(p.totalCredit) },
      { label: 'Months', value: months.length ? `${months.length} (${months[0]} – ${months[months.length - 1]})` : 'none' },
    ],
  };
}

// ---- the chart of accounts -------------------------------------------
//
// The truncation check is the whole point. A short chart does not look wrong;
// it looks like a smaller company. It then refuses that client's own ledger,
// because the accounts posted to are not in the chart.

function checkChart(rows: Row[]): Findings {
  const p = parseChartOfAccounts(rows);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const n of p.notes) if (n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty') {
    problems.push(n.message);
  }
  if (!p.accounts.length) problems.push('No accounts were found in this file.');

  if (p.reportedRecords !== null && p.reportedRecords !== p.accounts.length) {
    problems.push(
      `The file's own footer states ${int(p.reportedRecords)} records but only ` +
      `${int(p.accounts.length)} were read. The export is truncated — a short chart will refuse ` +
      "this client's own ledger, because the accounts posted to will not be in it. Export it again in full.",
    );
  } else if (p.reportedRecords === null) {
    warnings.push(
      'This chart has no "Number Of Records" footer, so there is nothing to prove it is complete. ' +
      'Export it with the footer if BTMS offers it.',
    );
  }
  if (!p.counts.nominal) {
    problems.push('No nominal accounts were found — this does not look like a chart of accounts.');
  }

  return {
    problems, warnings, period: null,
    facts: [
      { label: 'Accounts', value: int(p.accounts.length) },
      { label: 'Stated in file', value: p.reportedRecords === null ? 'not stated' : int(p.reportedRecords) },
      { label: 'Nominal', value: int(p.counts.nominal) },
      { label: 'Debtors & creditors', value: int(p.counts.subLedger) },
    ],
  };
}

// ---- the trial balance -----------------------------------------------

function checkTrialBalance(rows: Row[]): Findings {
  const p = parseTrialBalance(rows);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const n of p.notes) if (n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty') {
    problems.push(n.message);
  }
  if (!p.rows.length) problems.push('No accounts were found in this trial balance.');

  const closing = p.rows.reduce((s, r) => s + r.closing, 0);
  if (p.rows.length && differs(closing, 0)) {
    problems.push(
      `The closing balances do not sum to zero — they come to ${eur(closing)}. ` +
      'A trial balance that does not balance is a partial export.',
    );
  }
  if (p.reportTotal && p.reportTotal.records !== p.rows.length) {
    problems.push(
      `The report states ${int(p.reportTotal.records)} records but ${int(p.rows.length)} were read. ` +
      'The export is truncated.',
    );
  }
  if (p.reportTotal && differs(p.reportTotal.debit, p.rows.reduce((s, r) => s + r.debit, 0))) {
    problems.push(
      `The debits read do not match the report's own total line ` +
      `(${eur(p.rows.reduce((s, r) => s + r.debit, 0))} against ${eur(p.reportTotal.debit)}).`,
    );
  }
  if (!p.detailed) {
    warnings.push(
      'Debtors and creditors appear as control totals rather than individually. ' +
      'The reporting app can take it, but the debtor and creditor ageing will have nothing behind it — ' +
      'export the detailed version if you want those.',
    );
  }

  return {
    problems, warnings, period: null,
    facts: [
      { label: 'Accounts', value: int(p.rows.length) },
      { label: 'Debits', value: eur(p.rows.reduce((s, r) => s + r.debit, 0)) },
      { label: 'Credits', value: eur(p.rows.reduce((s, r) => s + r.credit, 0)) },
      { label: 'Closing (must be nil)', value: eur(closing) },
      { label: 'Debtors & creditors', value: p.detailed ? 'in detail' : 'controls only' },
    ],
  };
}

// ---- the stock valuation ---------------------------------------------

function checkStock(rows: Row[]): Findings {
  const p = parseStockValuation(rows);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const n of p.notes) if (n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty') {
    problems.push(n.message);
  }
  if (!p.items.length) problems.push('No stock lines were found in this file.');

  if (!p.footer) {
    problems.push(
      'This valuation has no "Number of Records / GrandTotals" line at the end. ' +
      'That line is what proves the export ran to completion — without it a file cut short ' +
      'is indistinguishable from a complete one.',
    );
  } else {
    if (p.footer.items !== p.totals.items) {
      problems.push(
        `The GrandTotals line states ${int(p.footer.items)} records but ${int(p.totals.items)} were read.`,
      );
    }
    if (differs(p.footer.value, p.totals.value)) {
      problems.push(
        `The value read (${eur(p.totals.value)}) does not agree with the file's own GrandTotals ` +
        `(${eur(p.footer.value)}), a difference of ${eur(Math.abs(p.footer.value - p.totals.value))}.`,
      );
    }
  }
  if (p.negative.items > 0) {
    warnings.push(
      `${int(p.negative.items)} lines carry a negative quantity, worth ${eur(p.negative.value)}. ` +
      'That is usually goods issued before they were received — worth looking at before the review.',
    );
  }

  return {
    problems, warnings, period: null,
    facts: [
      { label: 'Lines', value: int(p.totals.items) },
      { label: 'Value', value: eur(p.totals.value) },
      { label: 'Stated in file', value: p.footer ? eur(p.footer.value) : 'no totals line' },
      { label: 'Nil quantity', value: int(p.zero) },
    ],
  };
}

// ---- payroll ---------------------------------------------------------

function checkCostAnalysis(rows: Row[]): Findings {
  const p = parseCostAnalysis(rows);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const n of p.notes) if (n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty') {
    problems.push(n.message);
  }
  if (!p.departments.length) problems.push('No departments were found in this cost analysis.');

  if (!p.totals) {
    warnings.push('This export has no totals block, so there is nothing to check the departments against.');
  } else {
    const sum = p.departments.reduce((s, d) => s + d.cost[0], 0);
    if (differs(sum, p.totals.cost[0])) {
      problems.push(
        `The departments come to ${eur(sum)} but the report's own totals block says ` +
        `${eur(p.totals.cost[0])}. Either the export is partial or the totals row has been read as a department.`,
      );
    }
  }

  return {
    problems, warnings,
    period: monthFromBtms(p.period),
    facts: [
      { label: 'Period', value: p.period || 'not stated' },
      { label: 'Departments', value: int(p.departments.length) },
      { label: 'Employees', value: int(p.employees) },
      { label: 'Cost', value: eur(p.departments.reduce((s, d) => s + d.cost[0], 0)) },
    ],
  };
}

function checkPaysheet(rows: Row[]): Findings {
  const p = parsePaysheet(rows);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const n of p.notes) if (n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty') {
    problems.push(n.message);
  }
  if (!p.employees.length) problems.push('No employees were found in this paysheet.');

  // The trap this exists for: the closing Totals row belongs to nobody, and
  // read as an employee it doubles the last person on the sheet.
  if (!p.reportedTotals) {
    warnings.push('This paysheet has no closing totals row, so the employees cannot be checked against it.');
  } else if (differs(p.totals.gross, p.reportedTotals.gross)) {
    problems.push(
      `The employees come to ${eur(p.totals.gross)} gross but the sheet's own totals row says ` +
      `${eur(p.reportedTotals.gross)}. The usual cause is the grand-totals row being absorbed into ` +
      'the last employee — check the export, and the last person on it.',
    );
  }
  if (p.reportedRecords !== null && p.reportedRecords !== p.employees.length) {
    problems.push(
      `The sheet states ${int(p.reportedRecords)} employees but ${int(p.employees.length)} were read.`,
    );
  }

  return {
    problems, warnings,
    period: monthFromBtms(p.period),
    facts: [
      { label: 'Period', value: p.period || 'not stated' },
      { label: 'Employees', value: int(p.employees.length) },
      { label: 'Gross', value: eur(p.totals.gross) },
      { label: 'Net', value: eur(p.totals.net) },
      { label: 'Cost', value: eur(p.totals.cost) },
    ],
  };
}

/** BTMS prints a payroll period as MM/YYYY. */
function monthFromBtms(period: string): string | null {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((period ?? '').trim());
  return m ? `${m[2]}-${m[1].padStart(2, '0')}` : null;
}

// ---- the wide trial balance ------------------------------------------
//
// "Trial Balance(S)": opening, movement and closing each split into a debit
// and a credit column, with a blank leading column. The reporting app reads
// the other one — Code / Name / Type / Opening / Debit / Credit / Closing —
// and this layout parses to nothing under it.
//
// It is refused, but by name and with the reason, because the failure it
// prevents is somebody exporting this every month and wondering why no trial
// balance ever appears.
//
// It has one property no other BTMS export has: it prints the company name.
// Where a name is there to be read, it is read, and a file belonging to
// another client is stopped here rather than discovered in a report.

function checkWideTrialBalance(rows: Row[], expect?: { companyName?: string | null }): Findings {
  const head = rows.slice(0, 12);
  const text = (r: Row | undefined) => (r ?? []).map((c) => (c === null || c === undefined ? '' : String(c).trim()));

  // Row 3 in every example: the only line with one filled cell and no colon.
  let company: string | null = null;
  for (const r of head) {
    const filledCells = text(r).filter(Boolean);
    if (filledCells.length === 1 && !filledCells[0].includes(':') && filledCells[0].length > 3
        && !/^page\b/i.test(filledCells[0])) {
      company = filledCells[0];
      break;
    }
  }

  // "Periods:" ... "01/2024 to 01/2024"
  let period: string | null = null;
  for (const r of head) {
    const cells = text(r);
    if (!cells.some((c) => /^periods?:/i.test(c))) continue;
    const stated = cells.find((c) => /\d{2}\/\d{4}/.test(c));
    const m = stated ? [...stated.matchAll(/(\d{2})\/(\d{4})/g)] : [];
    if (m.length) {
      const from = `${m[0][2]}-${m[0][1]}`;
      const to = `${m[m.length - 1][2]}-${m[m.length - 1][1]}`;
      period = from === to ? from : `${from} to ${to}`;
    }
    break;
  }

  const problems = [
    'This is the wide "Trial Balance(S)" layout, which the reporting app does not read. ' +
    'Export the trial balance that lists Code, Name, Type, Opening, Debit, Credit and Closing ' +
    'in single columns, with debtors and creditors in detail.',
  ];

  // A file that names a different company is a different company's file. That
  // outranks the layout problem, so it is said first.
  const wanted = (expect?.companyName ?? '').trim();
  if (company && wanted && !sameCompany(company, wanted)) {
    problems.unshift(
      `This file says it belongs to "${company}", but it is being saved against "${wanted}". ` +
      'Check which client you exported.',
    );
  }

  return {
    problems,
    warnings: [],
    period,
    facts: [
      { label: 'Company in the file', value: company ?? 'not stated' },
      { label: 'Period', value: period ?? 'not stated' },
      { label: 'Rows', value: int(rows.length) },
    ],
  };
}

/** Company names are compared loosely: punctuation and LTD/LIMITED vary. */
function sameCompany(a: string, b: string): boolean {
  const norm = (t: string) => t.toUpperCase()
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  const x = norm(a), y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}
