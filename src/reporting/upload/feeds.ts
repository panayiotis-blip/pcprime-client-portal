// The eleven feeds the Data import table lists, and what each one needs asked.
//
// The table is the template's, and its first column is the feed's name. That
// name is what the Upload button sends back, so this is where a name becomes a
// feed: what kind of BTMS export it is, what period it has to be given, and
// which importer reads it.
//
// The period matters more than it looks. A trial balance is a position at a
// date and a stock valuation is a count on a day, and NEITHER export prints
// which. The person supplies it here, beside the file, at the moment they still
// know — not from memory in November. Everything else states its own period
// inside it, and what is typed is only a cross-check.

export type PeriodKind = 'none' | 'month' | 'year' | 'quarter' | 'date';

export type Feed = {
  /** The key used in reporting.feed_status. */
  key: string;
  /** Exactly as the template prints it — this is what the button sends. */
  name: string;
  /** What checkFile.ts calls this kind of export. */
  kind: string;
  period: PeriodKind;
  /** What the period control asks for, in the partner's words. */
  ask: string;
  /** False where the file is kept for the review and not read. */
  imported: boolean;
};

export const FEEDS: Feed[] = [
  {
    key: 'journal_listing', name: 'Analytical journal listing', kind: 'ledger',
    period: 'year', ask: 'Which year does this listing cover?', imported: true,
  },
  {
    key: 'trial_balance_monthly', name: 'Trial balance, monthly', kind: 'trial_balance',
    period: 'month', ask: 'Which month is this trial balance at?', imported: true,
  },
  {
    key: 'trial_balance_annual', name: 'Trial balance, annual', kind: 'trial_balance',
    period: 'year', ask: 'Which year end is this trial balance at?', imported: true,
  },
  {
    key: 'chart_of_accounts', name: 'Chart of accounts', kind: 'chart',
    period: 'none', ask: '', imported: true,
  },
  {
    key: 'vat_summary', name: 'VAT figures summary', kind: 'vat_summary',
    period: 'quarter', ask: 'Which quarter does this cover?', imported: false,
  },
  {
    key: 'vat_return_filed', name: 'VAT return as filed', kind: 'other',
    period: 'quarter', ask: 'Which quarter was filed?', imported: false,
  },
  {
    key: 'payroll_cost_analysis', name: 'Payroll cost analysis', kind: 'payroll_cost',
    period: 'month', ask: 'Which month is this payroll for?', imported: true,
  },
  {
    key: 'payroll_paysheet', name: 'Payroll paysheet listing', kind: 'payroll_sheet',
    period: 'month', ask: 'Which month is this payroll for?', imported: true,
  },
  {
    key: 'stock_valuation', name: 'Stock valuation', kind: 'stock',
    // The one exact date in the whole list. No BTMS export contains it and
    // nobody can recover it afterwards: it is the day the count was taken.
    period: 'date', ask: 'On what date was the stock counted?', imported: true,
  },
  {
    key: 'sales_invoice_listing', name: 'Sales invoice listing', kind: 'other',
    period: 'month', ask: 'Which month does this cover?', imported: false,
  },
  {
    key: 'bank_statement', name: 'Bank statement (XML)', kind: 'bank_statement',
    period: 'month', ask: 'Which month does this statement cover?', imported: false,
  },
];

export const feedByName = (name: string): Feed | null =>
  FEEDS.find((f) => f.name === name) ?? null;

/** The period as it is recorded against the file: 'YYYY', 'YYYY-MM' or a date. */
export function periodValue(kind: PeriodKind, value: string): string | null {
  const v = value.trim();
  if (kind === 'none') return null;
  if (!v) return null;
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (kind === 'year') return /^\d{4}$/.test(v) ? v : null;
  // A month and a quarter are both recorded as the month they end in; the
  // quarter control just labels it differently.
  return /^\d{4}-\d{2}$/.test(v) ? v : null;
}

/** What documents.year / documents.month are filled with. */
export const filedUnderPeriod = (period: string | null) => ({
  year: period ? period.slice(0, 4) : '',
  month: period && period.length >= 7 ? period.slice(5, 7) : '',
});
