export interface Account {
  id?: number;
  clientId: number; // each client has their own chart of accounts
  code: string;
  description: string;
  category: string; // e.g. 'Asset', 'Liability', 'Expense', 'Income', 'Equity'
}
