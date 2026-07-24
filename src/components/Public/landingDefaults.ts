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

// The long tail of landing-page copy — everything that isn't a big primary
// field or an image — lives in one jsonb blob (landing_copy) so new text bits
// don't each need their own column/migration. Keys map to defaults here.
export const DEFAULT_COPY: Record<string, string> = {
  // 'left' | 'center' | 'right' — alignment of section headings + underlines
  heading_align: 'center',
  // Top navigation
  nav_about: 'About',
  nav_services: 'Services',
  nav_contact: 'Contact',
  nav_portal: 'Client Portal',
  // Main website home — clicking the landing logo goes here.
  home_url: 'https://primeandcalculate.com',
  // External links (shown in the nav) — the firm's marketing website.
  nav_blog: 'Blog',
  blog_url: 'https://primeandcalculate.com/blog',
  nav_news: 'News',
  news_url: 'https://primeandcalculate.com/news',
  // Hero call-to-action cards
  cta_login_title: 'Client Portal Login',
  cta_login_sub: 'Access your documents, invoices and reports',
  cta_tax_title: 'Tax Calculator',
  cta_tax_sub: 'Estimate your Cyprus income tax in minutes',
  // Section headings
  about_heading: 'About our company',
  services_heading: 'Our Services',
  // "Become a client" strip (for new visitors)
  become_heading: 'New here? Become a client',
  become_text: "Tell us about your business and we'll set you up with secure portal access to work alongside our team.",
  become_button: 'Become a client →',
  become_url: '', // blank → the in-app request-an-account flow (/signup)
  // Portal-promo strip
  promo_heading: 'Already a client?',
  promo_text: 'Sign in to your secure portal to upload documents, review invoices and follow up on filings.',
  promo_button: 'Sign in →',
  // Footer
  footer_contact_heading: 'Contact',
  footer_office_heading: 'Office',
  footer_connect_heading: 'Connect',
  hours_line1: 'Mon–Fri · 08:00–18:00',
  hours_line2: 'Sat · By appointment',
};

// Read a copy key from a stored blob, falling back to the default.
export function copyText(blob: unknown, key: keyof typeof DEFAULT_COPY | string): string {
  const b = (blob && typeof blob === 'object') ? (blob as Record<string, unknown>) : {};
  const v = b[key];
  const s = (v == null ? '' : String(v)).trim();
  return s || DEFAULT_COPY[key] || '';
}

// Coerce whatever comes back from the RPC into a clean LandingService[].
export function normaliseServices(raw: unknown): LandingService[] {
  if (!Array.isArray(raw)) return DEFAULT_SERVICES;
  const cleaned = raw
    .map((s: any) => ({ title: String(s?.title ?? '').trim(), text: String(s?.text ?? '').trim() }))
    .filter((s) => s.title || s.text);
  return cleaned.length ? cleaned : DEFAULT_SERVICES;
}
