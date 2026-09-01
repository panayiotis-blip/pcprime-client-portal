// What a BTMS file is called, and how its period reads.
//
// One place, because four things have to agree about it: the name a file is
// stored under when it is uploaded, the label the folder panel shows, the cards
// on the portal's Documents tab, and the backfill that renamed the files which
// came across from the old bucket (migration 218). Any two of them disagreeing
// puts a folder into two naming schemes, which is what that migration existed
// to end.
//
// No imports. This sits below everything that uses it so that nothing has to
// import a module that imports it back.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The kinds checkFile records, in the words a person reads. */
export const KIND_NAME: Record<string, string> = {
  ledger: 'Journal listing',
  detailed_ledger: 'Detail ledger',
  chart: 'Chart of accounts',
  trial_balance: 'Trial balance',
  trial_balance_wide: 'Trial balance',
  stock: 'Stock valuation',
  payroll_cost: 'Payroll cost analysis',
  payroll_sheet: 'Payroll paysheet',
  vat_summary: 'VAT figures summary',
  vat_return: 'VAT return as filed',
  sales_listing: 'Sales invoice listing',
  bank_statement: 'Bank statement',
  other: 'Supporting document',
};

/**
 * A period as a person writes it.
 *
 * The stored form is what the machine needs — '2026-01', '2026-01-01', or a
 * range. A month is January 2026; a year is 2026; and only a stock valuation
 * shows a full date, because only it is a count taken on a day rather than a
 * position at the end of one.
 */
export function periodLabel(period: string | null | undefined, kind?: string): string {
  if (!period) return '';
  const range = period.split(/\s+to\s+/);
  if (range.length > 1) {
    return range.map((p) => periodLabel(p.trim(), kind)).join(' to ');
  }
  const d = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) {
    return kind === 'stock'
      ? `${Number(d[3])} ${MONTHS[Number(d[2]) - 1].slice(0, 3)} ${d[1]}`
      : `${MONTHS[Number(d[2]) - 1]} ${d[1]}`;
  }
  const ym = period.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `${MONTHS[Number(ym[2]) - 1]} ${ym[1]}`;
  return period;                       // a bare year, or something unrecognised
}

/** "Trial balance — January 2026". The type and the period, and nothing else. */
export function derivedLabel(kind: string, period: string | null | undefined): string {
  const name = KIND_NAME[kind] ?? 'BTMS export';
  const when = periodLabel(period, kind);
  return when ? `${name} — ${when}` : name;
}

/** The same, with the extension the export arrived with. */
export function derivedFileName(
  kind: string, period: string | null | undefined, original: string,
): string {
  const dot = original.lastIndexOf('.');
  const ext = dot > 0 ? original.slice(dot) : '';
  return derivedLabel(kind, period) + ext;
}
