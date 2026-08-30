/**
 * BTMS payroll — two reports, each a check on the other. BUILD.md §6.4.
 *
 * COST ANALYSIS is by department. A `DEPARTMENT` row opens one, a header row
 * follows, then rows of four column-pairs — earnings, deductions,
 * contributions, transactions — each carrying a period figure and a
 * year-to-date figure. A summary row beginning `Earnings` closes the
 * department with its totals and its employee count.
 *
 * THE TRAP, and it is the one §6.4 names: the file ends with a block headed
 *
 *     * * * * *  Totals * * * **
 *
 * which looks exactly like another department. Absorbed into the last one, it
 * doubles that department's contributions — an early parse did precisely that.
 * It is recognised here and kept apart as the grand total, which is then a
 * check on the sum of the departments rather than one of them.
 *
 * The header row and the summary row both begin with the word `Earnings`. They
 * are told apart by what follows it: the header carries the text "Period ", the
 * summary carries a number.
 *
 * PAYSHEET LISTING is by employee: an `Employee :` row with code, name, hourly
 * rate, hours and basic salary, the same four column-pairs, and a `Totals` row
 * carrying gross, deductions, contributions, cost and net.
 *
 * The two reports are independent statements of the same month, so the gross,
 * the deductions, the contributions and the net should agree between them.
 * Where they do not, one of the two files is wrong, and that is worth knowing
 * before either is reported from.
 *
 * Verified against A&F August 2026: 6 employees, 4 departments, gross
 * 10.994,28, deductions 1.505,20, contributions 1.785,27, net 9.489,08, cost
 * to the company 12.779,55.
 */

import type { Note, Row } from './types.ts';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Period and year-to-date, which is how the cost analysis carries everything. */
export type PairSet = Record<string, [number, number]>;

export type Department = {
  dep: string;
  earn: PairSet;
  ded: PairSet;
  con: PairSet;
  tr: PairSet;
  gross: [number, number];
  deductions: [number, number];
  contributions: [number, number];
  net: [number, number];
  cost: [number, number];
  employees: number;
};

export type CostAnalysisParse = {
  ok: boolean;
  /** 'MM/YYYY' as the report states it. */
  period: string;
  departments: Department[];
  /** The report's own totals block — a check on the departments, not one of them. */
  totals: Department | null;
  employees: number;
  notes: Note[];
};

/** The four column-pairs: label, period, year-to-date. */
const PAIRS: [number, number, number][] = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];
const SLOT: (keyof Pick<Department, 'earn' | 'ded' | 'con' | 'tr'>)[] = ['earn', 'ded', 'con', 'tr'];

const blankDepartment = (dep: string): Department => ({
  dep, earn: {}, ded: {}, con: {}, tr: {},
  gross: [0, 0], deductions: [0, 0], contributions: [0, 0], net: [0, 0], cost: [0, 0],
  employees: 0,
});

export function parseCostAnalysis(rows: Row[]): CostAnalysisParse {
  const notes: Note[] = [];
  const departments: Department[] = [];
  let totals: Department | null = null;
  let current: Department | null = null;
  let inTotals = false;
  let period = '';
  let employees = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const first = str(r[0]);

    if (!period) {
      const p = str(r[1]);
      if (/^\d{2}\/\d{4}$/.test(p)) period = p;
    }

    if (first === 'DEPARTMENT') {
      if (current) (inTotals ? (totals = current) : departments.push(current));
      current = blankDepartment(str(r[1]));
      inTotals = false;
      continue;
    }

    // The totals block. Recognised, so it cannot be taken for a department.
    if (/^\*+\s*\**\s*Totals/i.test(first) || /Totals\s*\*/i.test(first)) {
      if (current) (inTotals ? (totals = current) : departments.push(current));
      current = blankDepartment('TOTALS');
      inTotals = true;
      continue;
    }

    if (/^number of\s+employees/i.test(first)) {
      const n = num(r[1]);
      if (n) employees = n;
      continue;
    }
    if (/^page/i.test(first)) continue;
    if (!current) continue;

    // The header and the summary both start with "Earnings"; only the summary
    // carries a number beside it.
    const isSummary = first === 'Earnings' && typeof r[1] === 'number';
    if (first === 'Earnings' && !isSummary) continue;      // the header row

    if (isSummary) {
      current.gross = [num(r[1]), num(r[2])];
      current.deductions = [num(r[4]), num(r[5])];
      current.contributions = [num(r[7]), num(r[8])];
      current.net = [num(r[10]), num(r[11])];
      current.cost = [num(r[13]), num(r[14])];
      if (/employees/i.test(str(r[15]))) current.employees = num(r[16]);
      continue;
    }

    for (let s = 0; s < PAIRS.length; s++) {
      const [lc, pc, yc] = PAIRS[s];
      const label = str(r[lc]);
      if (!label) continue;
      current[SLOT[s]][label] = [num(r[pc]), num(r[yc])];
    }
  }
  if (current) (inTotals ? (totals = current) : departments.push(current));

  if (!departments.length) {
    notes.push({ kind: 'empty', message: 'No departments found. Check this is the cost analysis.' });
  }

  // The totals block exists to be checked against, so check it.
  if (totals && departments.length) {
    const summed = departments.reduce((a, d) => a + d.gross[0], 0);
    if (Math.abs(summed - totals.gross[0]) >= 0.005) {
      notes.push({
        kind: 'account-total-mismatch',
        message:
          `The departments add to ${summed.toFixed(2)} but the file's own totals block says ` +
          `${totals.gross[0].toFixed(2)}. One of the departments has been read wrongly.`,
      });
    }
  }

  const blocking = notes.some((n) => n.kind === 'empty' || n.kind === 'account-total-mismatch');
  return {
    ok: departments.length > 0 && !blocking,
    period, departments, totals,
    employees: employees || departments.reduce((a, d) => a + d.employees, 0),
    notes,
  };
}

export type Employee = {
  code: string;
  name: string;
  rate: number;
  hours: number;
  basic: number;
  earn: Record<string, number>;
  ded: Record<string, number>;
  con: Record<string, number>;
  tr: Record<string, number>;
  gross: number;
  deductions: number;
  contributions: number;
  cost: number;
  net: number;
};

export type PayTotals = {
  gross: number; deductions: number; contributions: number; cost: number; net: number;
};

export type PaysheetParse = {
  ok: boolean;
  period: string;
  employees: Employee[];
  /** Summed from the employees. */
  totals: PayTotals;
  /** The file's own closing Totals row, which belongs to nobody. */
  reportedTotals: PayTotals | null;
  reportedRecords: number | null;
  notes: Note[];
};

export function parsePaysheet(rows: Row[]): PaysheetParse {
  const notes: Note[] = [];
  const employees: Employee[] = [];
  let current: Employee | null = null;
  let period = '';
  let reportedRecords: number | null = null;
  let reportedTotals: PayTotals | null = null;
  // The paysheet ends with a Totals row belonging to nobody — the same shape
  // as the cost analysis's totals block, which §6.4 warns about but does not
  // mention here. Taken as the last employee's it made that one person's gross
  // the whole payroll: A&F's August became 20.746,35 instead of 10.994,28. One
  // Totals row per employee; a second without an intervening Employee row is
  // the file's own grand total.
  let employeeHasTotals = false;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const first = str(r[0]);

    if (/^month\s*\/\s*year/i.test(first)) {
      const m = str(r[1]).match(/^(\d{2}\/\d{4})/);
      if (m) period = m[1];
      continue;
    }

    if (/^employee\s*:/i.test(first)) {
      if (current) employees.push(current);
      const label = str(r[1]);
      const dash = label.indexOf('-');
      current = {
        code: (dash >= 0 ? label.slice(0, dash) : label).trim(),
        name: dash >= 0 ? label.slice(dash + 1).trim() : '',
        rate: num(r[8]), hours: num(r[10]), basic: num(r[14]),
        earn: {}, ded: {}, con: {}, tr: {},
        gross: 0, deductions: 0, contributions: 0, cost: 0, net: 0,
      };
      employeeHasTotals = false;
      continue;
    }

    if (/^number of\s+records/i.test(first)) { reportedRecords = num(r[1]); continue; }
    if (/^page/i.test(first)) continue;
    if (!current) continue;

    if (first === 'Totals') {
      const row = {
        gross: num(r[1]), deductions: num(r[3]), contributions: num(r[5]),
        cost: num(r[6]), net: num(r[8]),
      };
      if (employeeHasTotals) {
        // Belongs to the report, not to this employee.
        reportedTotals = row;
        employees.push(current);
        current = null;
      } else {
        Object.assign(current, row);
        employeeHasTotals = true;
      }
      continue;
    }
    if (first === 'Earnings') continue;                    // the header row

    // Three labelled pairs and the transactions column.
    const put = (slot: keyof Pick<Employee, 'earn' | 'ded' | 'con' | 'tr'>, lc: number, vc: number) => {
      const label = str(r[lc]);
      if (label) current![slot][label] = num(r[vc]);
    };
    put('earn', 0, 1);
    put('ded', 3, 4);
    put('con', 6, 7);
    put('tr', 9, 10);
  }
  if (current) employees.push(current);

  const totals = employees.reduce(
    (a, e) => ({
      gross: a.gross + e.gross,
      deductions: a.deductions + e.deductions,
      contributions: a.contributions + e.contributions,
      cost: a.cost + e.cost,
      net: a.net + e.net,
    }),
    { gross: 0, deductions: 0, contributions: 0, cost: 0, net: 0 },
  );
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
    totals[k] = Math.round(totals[k] * 100) / 100;
  }

  if (!employees.length) {
    notes.push({ kind: 'empty', message: 'No employees found. Check this is the paysheet listing.' });
  }
  if (reportedTotals && employees.length
      && Math.abs(reportedTotals.gross - totals.gross) >= 0.005) {
    notes.push({
      kind: 'account-total-mismatch',
      message:
        `The employees add to ${totals.gross.toFixed(2)} but the file's own Totals row says ` +
        `${reportedTotals.gross.toFixed(2)}.`,
    });
  }
  if (employees.length && reportedRecords !== null && reportedRecords !== employees.length) {
    notes.push({
      kind: 'truncated',
      message:
        `The file says ${reportedRecords} employees but ${employees.length} were read.`,
    });
  }

  const blocking = notes.some((n) => n.kind === 'empty' || n.kind === 'truncated');
  return {
    ok: employees.length > 0 && !blocking,
    period, employees, totals, reportedTotals, reportedRecords, notes,
  };
}

/**
 * The two reports against each other. They are independent statements of the
 * same month; where they disagree, one of the files is wrong, and reporting
 * from either without knowing that is how a payroll cost reaches a client's
 * accounts twice.
 */
export function reconcilePayroll(cost: CostAnalysisParse, sheet: PaysheetParse) {
  const c = cost.totals ?? {
    gross: [0, 0], deductions: [0, 0], contributions: [0, 0], net: [0, 0], cost: [0, 0],
  } as Pick<Department, 'gross' | 'deductions' | 'contributions' | 'net' | 'cost'>;
  const rows = [
    { what: 'Gross', analysis: c.gross[0], paysheet: sheet.totals.gross },
    { what: 'Deductions', analysis: c.deductions[0], paysheet: sheet.totals.deductions },
    { what: 'Contributions', analysis: c.contributions[0], paysheet: sheet.totals.contributions },
    { what: 'Net', analysis: c.net[0], paysheet: sheet.totals.net },
    { what: 'Cost', analysis: c.cost[0], paysheet: sheet.totals.cost },
  ].map((r) => ({ ...r, diff: Math.round((r.analysis - r.paysheet) * 100) / 100 }));
  return { rows, agrees: rows.every((r) => Math.abs(r.diff) < 0.005) };
}
