// Shared defaults for the public landing page, used both by the page itself
// (as fallbacks) and by the Company Settings editor (as the starting point
// when nothing has been saved yet). Keeping them here avoids drift.

export type LandingService = { title: string; text: string };

export const DEFAULT_SERVICES: LandingService[] = [
  { title: 'Accounting & Bookkeeping', text: 'Monthly bookkeeping, management accounts and year-end financial statements.' },
  { title: 'Tax Compliance & Planning', text: 'VAT and tax filings via TAXISnet, planning, and ongoing compliance support.' },
  { title: 'Payroll & Social Insurance', text: 'Monthly payroll, Ergani submissions and Social Insurance reporting.' },
  { title: 'Financial Reporting', text: 'Clear management reports and year-end financial statements you can act on.' },
  { title: 'Cashflow & Forecasting', text: 'Cashflow tracking and forward-looking forecasts for confident decisions.' },
  { title: 'Business Consultancy', text: 'Structuring, growth planning and operational efficiency for Cyprus businesses.' },
];

export const DEFAULT_SOCIAL = {
  facebook_url: 'https://www.facebook.com/profile.php?id=61574558002847',
  instagram_url: 'https://www.instagram.com/pcprime.official/',
  linkedin_url: '',
};

// Coerce whatever comes back from the RPC into a clean LandingService[].
export function normaliseServices(raw: unknown): LandingService[] {
  if (!Array.isArray(raw)) return DEFAULT_SERVICES;
  const cleaned = raw
    .map((s: any) => ({ title: String(s?.title ?? '').trim(), text: String(s?.text ?? '').trim() }))
    .filter((s) => s.title || s.text);
  return cleaned.length ? cleaned : DEFAULT_SERVICES;
}
