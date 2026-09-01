// The BTMS feeds, and what each one needs asked.
//
// The template's Data import table has a first column of feed names, and its
// Upload button sends that name back. This is where a name becomes a feed: what
// kind of BTMS export it is, which subfolder it belongs in, what period it has
// to be given, and whether an importer reads it.
//
// The period matters more than it looks. A trial balance is a position at a date
// and a stock valuation is a count on a day, and NEITHER export prints which.
// The person supplies it here, beside the file, at the moment they still know —
// not from memory in November. Everything else states its own period inside it,
// and what is typed is only a cross-check.
//
// `folder` is the subfolder from migration 215. The subfolder IS the report
// type, so standing in Journal listings there is exactly one thing a file can
// be, and the upload box should say so rather than offering ten and quietly
// filing your choice somewhere else.

export type PeriodKind = 'none' | 'month' | 'year' | 'quarter' | 'date';

export type Feed = {
  /** The key used in reporting.feed_status. */
  key: string;
  /** Exactly as the template prints it — this is what the Upload button sends. */
  name: string;
  /** What checkFile.ts calls this kind of export. */
  kind: string;
  /** The subfolder it is filed in — folders.category_key, migration 215. */
  folder: string;
  period: PeriodKind;
  /** What the period control asks for, in the partner's words. */
  ask: string;
  /**
   * A period may be left blank. True only for a supporting document, which is
   * kept with the client and may not be about a period at all.
   */
  optional?: boolean;
  /** False where the file is kept for the review and not read. */
  imported: boolean;
};

export const FEEDS: Feed[] = [
  {
    key: 'journal_listing', name: 'Analytical journal listing', kind: 'ledger',
    folder: 'btms_ledger',
    period: 'year', ask: 'Which year does this listing cover?', imported: true,
  },
  {
    key: 'detail_ledger', name: 'Detail ledger', kind: 'detailed_ledger',
    folder: 'btms_detail',
    period: 'month', ask: 'Which month does this ledger cover?', imported: false,
  },
  {
    key: 'trial_balance_monthly', name: 'Trial balance, monthly', kind: 'trial_balance',
    folder: 'btms_tb',
    period: 'month', ask: 'Which month is this trial balance at?', imported: true,
  },
  {
    key: 'trial_balance_annual', name: 'Trial balance, annual', kind: 'trial_balance',
    folder: 'btms_tb',
    period: 'year', ask: 'Which year end is this trial balance at?', imported: true,
  },
  {
    key: 'chart_of_accounts', name: 'Chart of accounts', kind: 'chart',
    folder: 'btms_coa',
    period: 'none', ask: '', imported: true,
  },
  {
    key: 'vat_summary', name: 'VAT figures summary', kind: 'vat_summary',
    folder: 'btms_vat',
    period: 'quarter', ask: 'Which quarter does this cover?', imported: false,
  },
  {
    key: 'vat_return_filed', name: 'VAT return as filed', kind: 'vat_return',
    folder: 'btms_vat',
    period: 'quarter', ask: 'Which quarter was filed?', imported: false,
  },
  {
    key: 'payroll_cost_analysis', name: 'Payroll cost analysis', kind: 'payroll_cost',
    folder: 'btms_payroll',
    period: 'month', ask: 'Which month is this payroll for?', imported: true,
  },
  {
    key: 'payroll_paysheet', name: 'Payroll paysheet listing', kind: 'payroll_sheet',
    folder: 'btms_payroll',
    period: 'month', ask: 'Which month is this payroll for?', imported: true,
  },
  {
    key: 'stock_valuation', name: 'Stock valuation', kind: 'stock',
    folder: 'btms_stock',
    // The one exact date in the whole list. No BTMS export contains it and
    // nobody can recover it afterwards: it is the day the count was taken.
    period: 'date', ask: 'On what date was the stock counted?', imported: true,
  },
  {
    key: 'sales_invoice_listing', name: 'Sales invoice listing', kind: 'sales_listing',
    folder: 'btms_sales',
    period: 'month', ask: 'Which month does this cover?', imported: false,
  },
  {
    key: 'bank_statement', name: 'Bank statement (XML)', kind: 'bank_statement',
    folder: 'btms_bank',
    period: 'month', ask: 'Which month does this statement cover?', imported: false,
  },
  {
    key: 'other_document', name: 'Other / supporting document', kind: 'other',
    folder: 'btms_other',
    period: 'month', ask: 'Which month does it relate to?', optional: true,
    imported: false,
  },
];

/** The parent folder, which holds every kind rather than one. */
export const BTMS_PARENT = 'btms';

export const feedByName = (name: string): Feed | null =>
  FEEDS.find((f) => f.name === name) ?? null;

/**
 * What may be uploaded into a given folder.
 *
 * In a subfolder that is the folder's own feeds and nothing else. Offering the
 * full list there was worse than untidy: a person standing in Journal listings,
 * under a heading saying so, could pick "Payroll cost analysis", and
 * btms_folder_for would quietly file it under Payroll. The heading and the list
 * disagreed, and the folder won.
 *
 * In the BTMS data parent every feed is offered, because the parent is not a
 * report type — but the form then says where the file will be filed.
 */
export function feedsForFolder(categoryKey: string | null | undefined): Feed[] {
  if (!categoryKey || categoryKey === BTMS_PARENT) return FEEDS;
  const mine = FEEDS.filter((f) => f.folder === categoryKey);
  return mine.length ? mine : FEEDS;
}

/**
 * The feed a file in the folder belongs to.
 *
 * The gate records a kind, not a feed, and one kind can be two feeds: a trial
 * balance is monthly or annual and the importer is told which. The period says
 * which -- a bare year is a year end, a month is a month -- because that is the
 * distinction the person drew when they filed it.
 */
export function feedForKind(kind: string, period: string | null): Feed | null {
  if (kind === 'trial_balance') {
    const annual = !!period && /^\d{4}$/.test(period);
    return FEEDS.find((f) => f.key === (annual ? 'trial_balance_annual' : 'trial_balance_monthly')) ?? null;
  }
  return FEEDS.find((f) => f.kind === kind) ?? null;
}

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

/** Whether this feed cannot be stored until a period is given. */
export const periodRequired = (f: Feed) => f.period !== 'none' && !f.optional;

/** What documents.year / documents.month are filled with. */
export const filedUnderPeriod = (period: string | null) => ({
  year: period ? period.slice(0, 4) : '',
  month: period && period.length >= 7 ? period.slice(5, 7) : '',
});
