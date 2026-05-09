export interface JournalType {
  code: string;
  label: string;
}

export const DEFAULT_JOURNAL_TYPES: JournalType[] = [
  { code: 'INP', label: 'Purchase Invoice' },
  { code: 'INS', label: 'Sales Invoice' },
  { code: 'PM', label: 'Bank Payment' },
  { code: 'DEP', label: 'Deposit' },
  { code: 'JV', label: 'Journal' },
];
