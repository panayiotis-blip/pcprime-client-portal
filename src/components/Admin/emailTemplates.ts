// Pre-built email templates for the company Bulk Email composer. {name} is
// merged to each recipient's name at send time. Kept here as plain data so it's
// easy to extend or tweak wording.

export interface EmailTemplate {
  id: string;
  label: string;
  category: string;
  subject: string;
  body: string;
}

const SIGN_OFF = '\n\nKind regards,\nPC Prime & Calculate Consultants Ltd';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'blank', label: 'Blank (write your own)', category: 'General',
    subject: '', body: '',
  },
  {
    id: 'announcement', label: 'General announcement', category: 'General',
    subject: 'An update from PC Prime & Calculate',
    body: `Dear {name},\n\nWe would like to inform you that …${SIGN_OFF}`,
  },
  {
    id: 'meeting', label: 'Meeting request', category: 'General',
    subject: 'Request for a meeting',
    body: `Dear {name},\n\nWe would like to arrange a meeting to discuss your affairs. Please let us know a few dates and times that suit you.${SIGN_OFF}`,
  },
  {
    id: 'doc_request', label: 'Document request', category: 'Requests',
    subject: 'Documents required',
    body: `Dear {name},\n\nTo proceed with your work, please send us the following documents at your earliest convenience:\n\n• …\n• …\n\nYou can reply to this email or upload them through your client portal.${SIGN_OFF}`,
  },
  {
    id: 'payment_reminder', label: 'Payment reminder', category: 'Billing',
    subject: 'Reminder: outstanding balance',
    body: `Dear {name},\n\nThis is a friendly reminder that there is an outstanding balance on your account. Please arrange payment at your earliest convenience. If you have already paid, kindly disregard this message.${SIGN_OFF}`,
  },
  {
    id: 'tax_notice', label: 'Tax notice / deadline reminder', category: 'Tax',
    subject: 'Important tax deadline approaching',
    body: `Dear {name},\n\nThis is to remind you that an important tax deadline is approaching. Please ensure any outstanding information or payments are submitted in good time so we can meet the deadline on your behalf.${SIGN_OFF}`,
  },
  {
    id: 'td1_reminder', label: 'Income tax return (TD1) reminder', category: 'Tax',
    subject: 'Your {year} personal income tax return',
    body: `Dear {name},\n\nIt is time to prepare your personal income tax return (TD1). Please send us the information we need so we can complete and submit it before the deadline.${SIGN_OFF}`,
  },
  {
    id: 'payroll_info', label: 'Payroll information request', category: 'Payroll',
    subject: 'Payroll information needed for {month}',
    body: `Dear {name},\n\nTo process this period's payroll, please send us by return:\n\n• Any new starters (name, ID, salary, start date)\n• Any leavers (name, last working day)\n• Changes to salaries, hours or benefits\n• Overtime, bonuses or commissions\n• Any unpaid leave / absences\n\nIf there are no changes this period, simply reply "no changes".${SIGN_OFF}`,
  },
  {
    id: 'vat_reminder', label: 'VAT return reminder', category: 'Tax',
    subject: 'VAT return — information needed',
    body: `Dear {name},\n\nYour VAT return is due shortly. Please send us your sales and purchases records for the period so we can prepare and submit it on time.${SIGN_OFF}`,
  },
  {
    id: 'engagement_renewal', label: 'Engagement renewal', category: 'Compliance',
    subject: 'Annual engagement renewal',
    body: `Dear {name},\n\nAs part of our annual process we are renewing our engagement with you. We will send your updated engagement letter shortly for your review and acceptance.${SIGN_OFF}`,
  },
  {
    id: 'kyc_refresh', label: 'KYC / details refresh', category: 'Compliance',
    subject: 'Please confirm your details are up to date',
    body: `Dear {name},\n\nAs regulated accountants we are required to keep your information current. Please review and confirm your details. We will send you a secure link to do this.${SIGN_OFF}`,
  },
];

export const TEMPLATE_CATEGORIES = Array.from(new Set(EMAIL_TEMPLATES.map((t) => t.category)));

// Fill simple placeholders that aren't per-recipient (e.g. {year}); {name} is
// left for the per-recipient merge at send time.
export function fillStaticPlaceholders(text: string): string {
  const now = new Date();
  const year = String(now.getFullYear() - 1); // tax work usually concerns last year
  const month = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return text.replace(/\{year\}/g, year).replace(/\{month\}/g, month);
}

// A custom (DB) template row mapped into the EmailTemplate shape used by the picker.
export interface CustomTemplateRow { id: number; name: string; category: string; subject: string; body: string }
export const customToTemplate = (r: CustomTemplateRow): EmailTemplate => ({
  id: `custom-${r.id}`, label: r.name, category: r.category || 'My templates', subject: r.subject, body: r.body,
});
