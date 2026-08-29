// Shapes the BTMS parsers produce. Deliberately plain data: the parsers are
// pure functions over a sheet already read into rows, so the same code runs in
// the browser, in an Edge Function and in a node test with no adapter.
//
// The specification for every rule applied here is docs/reporting/BUILD.md §6.

/** One cell as SheetJS hands it over with `{header:1, raw:true, defval:null}`. */
export type Cell = string | number | boolean | null;
export type Row = Cell[];

export type Account = {
  code: string;
  name: string;
  altCode: string | null;
  /** BTMS: Asset, Liability, Equity, Income, Expenditure, Debtor, Creditor. */
  accountType: string | null;
};

export type Posting = {
  accountCode: string;
  accountName: string;
  /** ISO date, from the Excel serial in column 0. */
  postedOn: string;
  /** First day of the posting's month — what period_month holds. */
  periodMonth: string;
  reference: string | null;
  details: string | null;
  debit: number;
  credit: number;
  vatCode: string | null;
  vatRate: number | null;
  /** BTMS signs this itself; it is never re-signed here. */
  vatAmount: number;
  journalCode: string | null;
  journalNo: number | null;
  batchNo: number | null;
  sourceOrigin: number | null;
};

/** Anything the importer should show a person, keyed so the UI can group them. */
export type Note = {
  kind:
    | 'truncated'
    | 'wrong-export'
    | 'no-account'
    | 'unparsable-row'
    | 'account-total-mismatch'
    | 'unposted-journals'
    | 'empty';
  message: string;
  /** 1-based sheet row, so it can be found in Excel. */
  row?: number;
};

export type LedgerParse = {
  ok: boolean;
  postings: Posting[];
  accounts: Account[];
  totals: { debit: number; credit: number };
  /** First day of every month the file covers, ascending. */
  monthsCovered: string[];
  notes: Note[];
};

export type TrialBalanceRow = {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export type TrialBalanceParse = {
  ok: boolean;
  rows: TrialBalanceRow[];
  /** The figures off the report's own "Report Total :" line. */
  reportTotal: { opening: number; debit: number; credit: number; closing: number; records: number } | null;
  /** True when debtors and creditors are listed individually, not as controls. */
  detailed: boolean;
  notes: Note[];
};
