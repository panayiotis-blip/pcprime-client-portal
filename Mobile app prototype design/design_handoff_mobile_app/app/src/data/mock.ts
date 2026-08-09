/**
 * Mock content, transcribed from the design handoff.
 *
 * Every value here is placeholder standing in for the portal API. When the
 * real API lands, replace the bodies in `src/api/portal.ts` — the screens
 * consume the types in `./types`, not this file.
 */

import {
  ClientDocument,
  Deadline,
  DocumentCategory,
  Filing,
  Message,
  Service,
  SiteLink,
} from './types';

export const profile = {
  name: 'Andreas Kyriakou',
  initials: 'AK',
  company: 'Kyriakou Trading Ltd',
  vat: 'VAT 10234567X',
} as const;

export const accountant = {
  name: 'Christina Prodromou',
  status: 'Senior accountant · usually replies within an hour',
} as const;

export const firm = {
  phone: '+357 24 258346',
  phoneHref: 'tel:+35724258346',
  email: 'info@primeandcalculate.com',
  emailHref: 'mailto:info@primeandcalculate.com',
  hours: 'Mon–Fri, 9:00–17:00',
  address: 'Dikomou 12, Agora Courts 2, Kiti, Larnaca 7550',
  /** Shorter form used on the booking confirmation. */
  shortAddress: 'Dikomou 12, Agora Courts 2, Kiti, Larnaca.',
  portalUrl: 'https://portal.primeandcalculate.com',
  portalHost: 'portal.primeandcalculate.com',
  aboutUrl: 'https://primeandcalculate.com/about',
} as const;

export const alert = {
  title: 'VAT return due in 6 days',
  sub: 'Q2 2026 · we need 3 more invoices',
} as const;

export const documentCategories: readonly ('All' | DocumentCategory)[] = [
  'All',
  'Invoices',
  'Bank',
  'Payroll',
  'Filings',
];

export const documents: ClientDocument[] = [
  {
    id: 'inv-2026-114',
    name: 'Invoice 2026-114.pdf',
    kind: 'PDF',
    meta: 'Sales · 4 Aug · 1.2 MB',
    status: { label: 'Received', tone: 'positive' },
    category: 'Invoices',
  },
  {
    id: 'bank-jul',
    name: 'Bank statement July.csv',
    kind: 'CSV',
    meta: 'Bank of Cyprus · 2 Aug',
    status: { label: 'Received', tone: 'positive' },
    category: 'Bank',
  },
  {
    id: 'receipts-12',
    name: 'Supplier receipts (12).zip',
    kind: 'ZIP',
    meta: 'Purchases · 28 Jul',
    status: { label: 'In review', tone: 'action' },
    category: 'Invoices',
  },
  {
    id: 'vat-q1',
    name: 'VAT return Q1 2026.pdf',
    kind: 'PDF',
    meta: 'Filed 10 May · signed',
    status: { label: 'Filed', tone: 'inert' },
    category: 'Filings',
  },
  {
    id: 'payroll-jul',
    name: 'Payroll July.xlsx',
    kind: 'XLS',
    meta: '8 employees · 31 Jul',
    status: { label: 'Filed', tone: 'inert' },
    category: 'Payroll',
  },
];

/** The document a mock upload prepends to the list. */
export const uploadedDocument: Omit<ClientDocument, 'id'> = {
  name: 'Purchase invoice 4 Aug.pdf',
  kind: 'PDF',
  meta: 'Just now · 480 KB',
  status: { label: 'Sent', tone: 'positive' },
  category: 'Invoices',
};

export const uploadOptions = [
  'Take a photo of a receipt',
  'Choose from Files',
  'Import from email',
] as const;

export const uploadToast = 'Uploaded — Christina has been notified.';

/** The three rows in Home's calendar card. */
export const deadlines: Deadline[] = [
  {
    id: 'vat-q2',
    day: '10',
    month: 'Aug',
    title: 'VAT return Q2',
    sub: '3 invoices outstanding',
    status: { label: 'Action', tone: 'action' },
  },
  {
    id: 'payroll-aug',
    day: '31',
    month: 'Aug',
    title: 'Payroll & social insurance',
    sub: 'August, 8 employees',
    status: { label: 'On track', tone: 'positive' },
  },
  {
    id: 'provisional-1',
    day: '30',
    month: 'Sep',
    title: 'Provisional tax — 1st instalment',
    sub: 'Estimate under review',
    status: { label: 'Draft', tone: 'inert' },
  },
];

export const filings: Filing[] = [
  {
    id: 'vat-q1-2026',
    title: 'VAT return Q1 2026',
    due: 'Filed 10 May 2026',
    status: { label: 'Filed', tone: 'positive' },
    percent: 100,
    progress: 'filed',
  },
  {
    id: 'vat-q2-2026',
    title: 'VAT return Q2 2026',
    due: 'Due 10 August 2026',
    status: { label: 'Action', tone: 'action' },
    percent: 62,
    progress: 'in-progress',
  },
  {
    id: 'payroll-july',
    title: 'Payroll — July',
    due: 'Filed 31 July 2026',
    status: { label: 'Filed', tone: 'positive' },
    percent: 100,
    progress: 'filed',
  },
  {
    id: 'payroll-august',
    title: 'Payroll — August',
    due: 'Due 31 August 2026',
    status: { label: 'Scheduled', tone: 'inert' },
    percent: 20,
    progress: 'idle',
  },
  {
    id: 'provisional-2026-1',
    title: 'Provisional tax 2026 — 1st',
    due: 'Due 30 September 2026',
    status: { label: 'Draft', tone: 'inert' },
    percent: 35,
    progress: 'idle',
  },
  {
    id: 'cit-2025',
    title: 'Corporate income tax 2025',
    due: 'Due 31 March 2027',
    status: { label: 'Not started', tone: 'inert' },
    percent: 5,
    progress: 'idle',
  },
];

/** Copy taken verbatim from the firm's website services list. */
export const services: Service[] = [
  {
    name: 'Accounting & Bookkeeping',
    description: 'Accurate, up-to-date records and reconciliations.',
  },
  {
    name: 'Tax Compliance & VAT',
    description: 'Timely filings and smart structuring under Cyprus and EU rules.',
  },
  {
    name: 'Payroll & HR',
    description: 'Payroll processing, social insurance filings, HR compliance.',
  },
  {
    name: 'Financial Reporting',
    description: 'Monthly reports, management accounts, KPI dashboards.',
  },
  {
    name: 'Cashflow & Budget Planning',
    description: 'Forecasts and budget models so there are no surprises.',
  },
  {
    name: 'Business Consultancy',
    description: 'Strategic advice for growth, restructuring or new ventures.',
  },
];

export const closingPanel = {
  headline: 'Over 30 years helping businesses in Cyprus decide with confidence.',
  link: 'About the firm →',
} as const;

export const siteLinks: SiteLink[] = [
  { label: 'Home', href: 'https://primeandcalculate.com/', host: 'primeandcalculate.com' },
  { label: 'About us', href: 'https://primeandcalculate.com/about', host: 'primeandcalculate.com' },
  {
    label: 'Services',
    href: 'https://primeandcalculate.com/services',
    host: 'primeandcalculate.com',
  },
  { label: 'Blog', href: 'https://primeandcalculate.com/blog', host: 'primeandcalculate.com' },
  {
    label: 'Contact',
    href: 'https://primeandcalculate.com/contact',
    host: 'primeandcalculate.com',
  },
  { label: 'Client portal', href: 'https://portal.primeandcalculate.com', host: 'portal' },
];

export const bookingTopics = [
  'Tax & VAT question',
  'New company setup',
  'Payroll & HR',
  'Something else',
] as const;

export const bookingSlots = ['09:00', '09:30', '10:00', '11:30', '14:00', '15:30'] as const;

export const thread: Message[] = [
  {
    id: 'm1',
    from: 'them',
    text: 'Morning Andreas — we have your July bank statement. Still missing three purchase invoices for the Q2 VAT return.',
  },
  { id: 'm2', from: 'me', text: 'Thanks Christina, I will get them up today.' },
  {
    id: 'm3',
    from: 'them',
    text: 'Perfect. Deadline is 10 August, so anything by Friday is comfortable.',
  },
];

/** Prototype-only stand-in for a real inbound message. */
export const cannedReply =
  'Got it — I will take a look this afternoon and come back to you before the deadline.';
