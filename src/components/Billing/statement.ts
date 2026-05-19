// Shared client-statement ledger builder — used by the on-screen
// statement (ClientStatement) and the printable version (StatementPrint).
//
// A statement is a running account: invoices are debits (the client owes
// us), receipts are credits (they've paid). The balance is what they still
// owe at each point in time.

export type LedgerRow = {
  date: string;
  type: 'invoice' | 'receipt';
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;   // running balance after this row
};

export type StatementResult = {
  rows: LedgerRow[];
  opening: number;   // balance brought forward at the start of the period
  closing: number;   // balance at the end of the period
};

export function buildStatement(
  invoices: any[],
  receipts: any[],
  from?: string,
  to?: string,
): StatementResult {
  type Entry = Omit<LedgerRow, 'balance'>;
  const all: Entry[] = [];

  for (const i of invoices) {
    if (!i.issue_date) continue;   // drafts with no issue date never appear
    all.push({
      date: i.issue_date,
      type: 'invoice',
      ref: i.invoice_number || '(draft)',
      description: `Invoice ${i.invoice_number || ''}`.trim(),
      debit: Number(i.total_amount || 0),
      credit: 0,
    });
  }
  for (const r of receipts) {
    if (!r.receipt_date) continue;
    all.push({
      date: r.receipt_date,
      type: 'receipt',
      ref: r.receipt_number,
      description: `Receipt ${r.receipt_number}${r.payment_method ? ' — ' + r.payment_method : ''}`,
      debit: 0,
      credit: Number(r.amount || 0),
    });
  }

  // Date ascending; on the same day an invoice (debit) sorts before a receipt.
  all.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type !== b.type) return a.type === 'invoice' ? -1 : 1;
    return 0;
  });

  // Opening balance = everything that happened strictly before `from`.
  let opening = 0;
  if (from) {
    for (const e of all) if (e.date < from) opening += e.debit - e.credit;
  }

  let running = opening;
  const rows: LedgerRow[] = [];
  for (const e of all) {
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    running += e.debit - e.credit;
    rows.push({ ...e, balance: running });
  }

  return { rows, opening, closing: running };
}
