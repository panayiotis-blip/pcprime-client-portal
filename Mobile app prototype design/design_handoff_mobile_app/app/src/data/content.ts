/**
 * Static content — the parts of the app that are the firm's words rather than
 * a client's data. None of this comes from the portal because none of it
 * changes per client.
 */

import { Service, SiteLink } from './types';

export const firm = {
  name: 'Prime & Calculate',
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

/** What a consultation can be about — the booking screen's first group. */
export const bookingTopics = [
  'Tax & VAT question',
  'New company setup',
  'Payroll & HR',
  'Something else',
] as const;

/** Where a new document can come from. */
export const uploadOptions = ['Take a photo of a receipt', 'Choose from Files'] as const;

export const uploadToast = 'Uploaded — your accountant has been notified.';

/**
 * Documents are filed under a category. The portal's categories are
 * configurable, so the filter row is built from what the client actually has;
 * this is only the category a new upload is filed under until the firm moves
 * it.
 */
export const DEFAULT_UPLOAD_CATEGORY = 'other';
