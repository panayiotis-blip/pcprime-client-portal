import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

// Built-in defaults. The owner can override the editable fields under
// Company Settings → Landing page; anything left blank falls back to these.
const DEFAULTS = {
  logo_url: '/logo.png',
  landing_headline: 'Professional Accounting, Tax & Business Consultancy Services',
  landing_subtext:
    'At Prime & Calculate Consultants, we empower individuals and businesses in Cyprus ' +
    'to achieve financial clarity. Whether you need hands-on accounting, proactive tax ' +
    'planning, or strategic consultancy, we deliver results — not just reports.',
  landing_about:
    'With over 30 years of combined experience, our team delivers accounting, tax and ' +
    'consultancy services that help Cyprus-based individuals and businesses stay ' +
    'compliant and grow with confidence.\n\n' +
    'We pair technical accuracy with hands-on partnership — so you always know where ' +
    'you stand, and what to do next.',
  email: 'info@primeandcalculate.com',
  phone: '+357 24 258346',
  address_line1: 'Dikomou 12, Office 201',
  city: 'Kiti, Larnaca, Cyprus',
};

const COMPANY_NAME = 'PC Prime & Calculate Consultants Ltd';

type Content = Record<string, string | null>;

export default function LandingPage() {
  const [c, setC] = useState<Content>({});

  useEffect(() => {
    let alive = true;
    api.getLandingContent()
      .then((data) => { if (alive) setC(data || {}); })
      .catch(() => { /* fall back to built-in defaults */ });
    return () => { alive = false; };
  }, []);

  // Helper: prefer the saved value, else the built-in default.
  const val = (k: keyof typeof DEFAULTS) => (c[k] && String(c[k]).trim()) || DEFAULTS[k];
  const companyName = (c.name && String(c.name).trim()) || COMPANY_NAME;

  const logoUrl = val('logo_url');
  const heroImage = (c.landing_hero_image_url && String(c.landing_hero_image_url).trim()) || '';
  const aboutParas = val('landing_about').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="landing">
      <div className="landing-topbar">
        <header className="landing-nav">
          <div className="landing-brand">
            <img
              src={logoUrl}
              alt={companyName}
              style={{ height: 96, width: 'auto', display: 'block' }}
            />
          </div>
          <nav className="landing-nav-links">
            <a href="#about">About</a>
            <a href="#services">Services</a>
            <a href="#contact">Contact</a>
            <Link to="/login" className="landing-nav-cta">Client Portal</Link>
          </nav>
        </header>
      </div>

      <section className={`landing-hero${heroImage ? ' landing-hero--split' : ''}`}>
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <h2>{val('landing_headline')}</h2>
            <p className="landing-tagline">{val('landing_subtext')}</p>

            <div className="landing-ctas">
              <Link to="/login" className="landing-cta landing-cta-primary">
                <div className="cta-title">Client Portal Login</div>
                <div className="cta-sub">Access your documents, invoices and reports</div>
                <div className="cta-arrow">→</div>
              </Link>

              <Link to="/tax" className="landing-cta landing-cta-secondary">
                <div className="cta-title">Tax Calculator</div>
                <div className="cta-sub">Estimate your Cyprus income tax in minutes</div>
                <div className="cta-arrow">→</div>
              </Link>
            </div>
          </div>

          {heroImage && (
            <div className="landing-hero-media">
              <img src={heroImage} alt="" />
            </div>
          )}
        </div>
      </section>

      <section id="about" className="landing-about">
        <div className="landing-section-inner about-inner">
          <h3>About our company</h3>
          {aboutParas.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </section>

      <section id="services" className="landing-services">
        <div className="landing-section-inner">
          <h3>Our Services</h3>
          <div className="services-grid">
            <div className="service-card">
              <h4>Accounting &amp; Bookkeeping</h4>
              <p>Monthly bookkeeping, management accounts and year-end financial statements.</p>
            </div>
            <div className="service-card">
              <h4>Tax Compliance &amp; Planning</h4>
              <p>VAT and tax filings via TAXISnet, planning, and ongoing compliance support.</p>
            </div>
            <div className="service-card">
              <h4>Payroll &amp; Social Insurance</h4>
              <p>Monthly payroll, Ergani submissions and Social Insurance reporting.</p>
            </div>
            <div className="service-card">
              <h4>Financial Reporting</h4>
              <p>Clear management reports and year-end financial statements you can act on.</p>
            </div>
            <div className="service-card">
              <h4>Cashflow &amp; Forecasting</h4>
              <p>Cashflow tracking and forward-looking forecasts for confident decisions.</p>
            </div>
            <div className="service-card">
              <h4>Business Consultancy</h4>
              <p>Structuring, growth planning and operational efficiency for Cyprus businesses.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-portal-promo">
        <div className="landing-section-inner promo-inner">
          <div>
            <h3>Already a client?</h3>
            <p>Sign in to your secure portal to upload documents, review invoices and follow up on filings.</p>
          </div>
          <Link to="/login" className="btn-large">Sign in →</Link>
        </div>
      </section>

      <footer id="contact" className="landing-footer">
        <div className="landing-section-inner footer-grid">
          <div>
            <h5>Contact</h5>
            <p><a href={`mailto:${val('email')}`}>{val('email')}</a></p>
            <p><a href={`tel:${String(val('phone')).replace(/\s+/g, '')}`}>{val('phone')}</a></p>
          </div>
          <div>
            <h5>Office</h5>
            <p>{val('address_line1')}</p>
            {c.address_line2 && <p>{c.address_line2}</p>}
            <p>{val('city')}</p>
            <p>Mon–Fri · 08:00–18:00</p>
            <p>Sat · By appointment</p>
          </div>
          <div>
            <h5>Connect</h5>
            <p><a href="https://www.facebook.com/profile.php?id=61574558002847" target="_blank" rel="noopener noreferrer">Facebook</a></p>
            <p><a href="https://www.instagram.com/pcprime.official/" target="_blank" rel="noopener noreferrer">Instagram</a></p>
            <p><Link to="/login">Client Portal</Link></p>
            <p><Link to="/tax">Tax Calculator</Link></p>
          </div>
        </div>
        <div className="landing-section-inner footer-bottom">
          <span>© {new Date().getFullYear()} {companyName}</span>
          <span style={{ marginLeft: 16 }}>
            <Link to="/privacy" style={{ color: 'inherit' }}>Privacy Notice</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
