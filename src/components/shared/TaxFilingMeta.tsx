// Shared lookup tables for Tax Filings UI — filing type labels, status pills,
// year/type/status filter options.

export const FILING_TYPES: { value: string; label: string }[] = [
  { value: 'individual_tax_return',                 label: 'Individual Tax Return' },
  { value: 'individual_tax_return_self_employed',   label: 'Individual Tax Return (Self-Employed)' },
  { value: 'individual_tax_return_pensioner',       label: 'Individual Tax Return (Pensioner)' },
  { value: 'company_tax_return',                    label: 'Company Tax Return' },
  { value: 'vat_return',                            label: 'VAT Return' },
  { value: 'social_insurance_return',               label: 'Social Insurance Return' },
  { value: 'ergani_filing',                         label: 'Ergani Filing' },
  { value: 'other',                                 label: 'Other' },
];

export const FILING_STATUSES: { value: string; label: string }[] = [
  { value: 'not_required', label: 'Not Required' },
  { value: 'pending',      label: 'Pending' },
  { value: 'in_progress',  label: 'In Progress' },
  { value: 'filed',        label: 'Filed' },
  { value: 'submitted',    label: 'Submitted' },
  { value: 'paid',         label: 'Paid' },
  { value: 'overdue',      label: 'Overdue' },
];

export const FILING_STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  not_required: { bg: '#f1f5f9', fg: '#64748b' },
  pending:      { bg: '#fef3c7', fg: '#92400e' },
  in_progress:  { bg: '#dbeafe', fg: '#1e40af' },
  filed:        { bg: '#d1fae5', fg: '#065f46' },
  submitted:    { bg: '#d1fae5', fg: '#065f46' },
  paid:         { bg: '#dcfce7', fg: '#14532d' },
  overdue:      { bg: '#fee2e2', fg: '#991b1b' },
};

export function filingTypeLabel(v: string): string {
  return FILING_TYPES.find(t => t.value === v)?.label || v;
}

export function filingStatusLabel(v: string): string {
  return FILING_STATUSES.find(s => s.value === v)?.label || v;
}

export function StatusPill({ status }: { status: string }) {
  const c = FILING_STATUS_COLOR[status] || { bg: '#f1f5f9', fg: '#64748b' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      background: c.bg,
      color: c.fg,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'capitalize',
      whiteSpace: 'nowrap',
    }}>
      {filingStatusLabel(status)}
    </span>
  );
}

// Years from 2014 to current+1 (useful for filter dropdowns + add modal)
export function taxYears(): number[] {
  const now = new Date().getFullYear();
  const out: number[] = [];
  for (let y = now + 1; y >= 2014; y--) out.push(y);
  return out;
}
