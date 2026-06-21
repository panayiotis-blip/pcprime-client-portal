// Single source of truth for the tax-return information checklist.
// Used both by the pre-start gate (TaxReturnChecklistGate) and by the
// Request Tax Info email flow, so what we ask clients for matches what we
// tick off internally.

export type ChecklistFormType = 'individuals' | 'self_employed';

export interface ChecklistItem { key: string; label: string; hint?: string }

// Items common to both forms.
export const COMMON_ITEMS: ChecklistItem[] = [
  { key: 'identity', label: 'Client identity verified', hint: 'T.I.C., ID/passport, date of birth, address up to date' },
  { key: 'taxisnet_access', label: 'TaxisNet access confirmed', hint: 'We can submit on the client’s behalf' },
  { key: 'prior_year', label: 'Prior-year return / losses carried forward', hint: 'Last year’s TD1 on file; any losses or balances brought forward' },
  { key: 'si_ghs', label: 'Social Insurance & GHS (GeSY) contributions', hint: 'Annual totals for the year' },
];

export const INDIVIDUAL_ITEMS: ChecklistItem[] = [
  { key: 'emp_certs', label: 'Employer emoluments / PAYE certificates', hint: 'One per employer — gross pay, tax withheld, GHS' },
  { key: 'benefits_in_kind', label: 'Benefits in kind', hint: 'Car, accommodation, other BIK — if any' },
  { key: 'pensions', label: 'Pension statements', hint: 'Cyprus and/or foreign pensions — if any' },
  { key: 'rents', label: 'Rental income & allowable expenses', hint: 'Per property — gross rents, interest, repairs, capital allowances' },
  { key: 'interest_dividends', label: 'Interest & dividend statements', hint: 'Bank/SDC; local and foreign — if any' },
  { key: 'allowances', label: 'Allowances & deductions evidence', hint: 'Life insurance, provident/pension fund, donations, professional subs, loan interest' },
];

export const SELF_EMPLOYED_ITEMS: ChecklistItem[] = [
  { key: 'accounts', label: 'Financial statements / management accounts', hint: 'Profit & loss and balance sheet for the year' },
  { key: 'turnover_audit', label: 'Turnover & audit status', hint: 'Over/under €70,000; audited or inspected accounts' },
  { key: 'capital_allowances', label: 'Capital allowances schedule', hint: 'Additions, disposals, WDV' },
  { key: 'partnerships', label: 'Partnership income details', hint: 'Share %, salary, interest on capital — if a partner' },
  { key: 'disposals', label: 'Disposals of property / shares', hint: 'Gains or losses in the year — if any' },
  { key: 'vat_reconciled', label: 'VAT returns reconciled', hint: 'If VAT-registered, turnover agrees to VAT returns' },
];

export function checklistItems(formType: ChecklistFormType): ChecklistItem[] {
  return [...COMMON_ITEMS, ...(formType === 'self_employed' ? SELF_EMPLOYED_ITEMS : INDIVIDUAL_ITEMS)];
}

// A plain-text bulleted list of what we need, for the request email body.
export function neededDocsText(formType: ChecklistFormType): string {
  return checklistItems(formType)
    .map(i => `• ${i.label}${i.hint ? ` (${i.hint})` : ''}`)
    .join('\n');
}

// A default request-email subject + body for the given form type. {name} is
// merged per recipient by the sender.
export function requestEmailTemplate(formType: ChecklistFormType, taxYear: number): { subject: string; body: string } {
  const kind = formType === 'self_employed' ? 'self-employed ' : '';
  const subject = `Information needed for your ${taxYear} ${kind}tax return`;
  const body =
    `Dear {name},\n\n` +
    `We are preparing your personal income tax return (TD1) for ${taxYear} and need the following ` +
    `information to proceed. Please send whatever applies to you at your earliest convenience:\n\n` +
    `${neededDocsText(formType)}\n\n` +
    `If an item does not apply to you, please let us know so we can mark it as confirmed. ` +
    `You can reply to this email or upload documents through your client portal.\n\n` +
    `Thank you for your cooperation.\n\n` +
    `Kind regards,\nPC Prime & Calculate Consultants Ltd`;
  return { subject, body };
}
