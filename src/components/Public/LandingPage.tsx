import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="landing">
      <div className="landing-topbar">
        <header className="landing-nav">
          <div className="landing-brand">
            <img
              src="/logo.png"
              alt="PC Prime & Calculate Consultants Ltd"
              style={{ height: 128, width: 'auto', display: 'block' }}
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

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <h2>Professional Accounting, Tax &amp; Business Consultancy Services</h2>
          <p className="landing-tagline">
            At Prime &amp; Calculate Consultants, we empower individuals and businesses in Cyprus
            to achieve financial clarity. Whether you need hands-on accounting, proactive tax
            planning, or strategic consultancy, we deliver results — not just reports.
          </p>

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
      </section>

      <section id="about" className="landing-about">
        <div className="landing-section-inner about-inner">
          <h3>About our company</h3>
          <p>
            With over 30 years of combined experience, our team delivers accounting, tax and
            consultancy services that help Cyprus-based individuals and businesses stay
            compliant and grow with confidence.
          </p>
          <p>
            We pair technical accuracy with hands-on partnership — so you always know where
            you stand, and what to do next.
          </p>
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
            <p><a href="mailto:info@primeandcalculate.com">info@primeandcalculate.com</a></p>
            <p><a href="mailto:christina@primeandcalculate.com">christina@primeandcalculate.com</a></p>
            <p><a href="tel:+35724258346">+357 24 258346</a></p>
          </div>
          <div>
            <h5>Office</h5>
            <p>Dikomou 12, Office 201</p>
            <p>Kiti, Larnaca, Cyprus</p>
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
          <span>© {new Date().getFullYear()} PC Prime &amp; Calculate Consultants Ltd</span>
          <span style={{ marginLeft: 16 }}>
            <Link to="/privacy" style={{ color: 'inherit' }}>Privacy Notice</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
