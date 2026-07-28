import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { normaliseServices, DEFAULT_SOCIAL, copyText } from './landingDefaults';

// Built-in defaults. The owner can override the editable fields under
// Company Settings → Landing page; anything left blank falls back to these.
const DEFAULTS = {
  logo_url: '/logo.png',
  landing_headline: 'Professional Accounting, Tax &\nBusiness Consultancy Services',
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
  // Hold the page invisible until saved content is loaded, so the initial
  // render (built-in defaults) doesn't visibly swap to the saved values —
  // that swap was the "flicker" on load. We fade in once, with real content.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getLandingContent()
      .then((data) => { if (alive) setC(data || {}); })
      .catch(() => { /* fall back to built-in defaults */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Helper: prefer the saved value, else the built-in default.
  const val = (k: keyof typeof DEFAULTS) => (c[k] && String(c[k]).trim()) || DEFAULTS[k];
  const companyName = (c.name && String(c.name).trim()) || COMPANY_NAME;

  const landingLogo = (c.landing_logo_url && String(c.landing_logo_url).trim()) || '/logo.png';
  const heroImage = (c.landing_hero_image_url && String(c.landing_hero_image_url).trim()) || '';
  const aboutImage = (c.landing_about_image_url && String(c.landing_about_image_url).trim()) || '';
  const aboutParas = val('landing_about').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const services = normaliseServices((c as any).landing_services);
  const facebook = (c.facebook_url && String(c.facebook_url).trim()) || DEFAULT_SOCIAL.facebook_url;
  const instagram = (c.instagram_url && String(c.instagram_url).trim()) || DEFAULT_SOCIAL.instagram_url;
  const linkedin = (c.linkedin_url && String(c.linkedin_url).trim()) || '';

  // Editable copy blob (nav labels, headings, promo, footer, etc.) + alignment.
  const t = (k: string) => copyText((c as any).landing_copy, k);
  const rawAlign = t('heading_align');
  const align = ['left', 'center', 'right'].includes(rawAlign) ? rawAlign : 'center';
  const alignClass = `ta-${align}`;

  return (
    <div className="landing" style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.18s ease-in' }}>
      <div className="landing-topbar">
        <header className="landing-nav">
          <div className="landing-brand">
            {t('home_url') ? (
              <a href={t('home_url')} aria-label={companyName}>
                <img src={landingLogo} alt={companyName} style={{ height: 128, width: 'auto', display: 'block' }} />
              </a>
            ) : (
              <img src={landingLogo} alt={companyName} style={{ height: 128, width: 'auto', display: 'block' }} />
            )}
          </div>
          <nav className="landing-nav-links">
            <a href="#about">{t('nav_about')}</a>
            <a href="#services">{t('nav_services')}</a>
            <a href="#contact">{t('nav_contact')}</a>
            {t('blog_url') && (
              <a href={t('blog_url')} target="_blank" rel="noopener noreferrer">{t('nav_blog')}</a>
            )}
            {t('news_url') && (
              <a href={t('news_url')} target="_blank" rel="noopener noreferrer">{t('nav_news')}</a>
            )}
            <Link to="/app">Client Apps</Link>
            <Link to="/login" className="landing-nav-cta">{t('nav_portal')}</Link>
          </nav>
        </header>
      </div>

      <section className={`landing-hero${heroImage ? ' landing-hero--split' : ''}`}>
        <div className="landing-hero-inner">
          <h2>{val('landing_headline').split('\n').flatMap((line, i) => (i === 0 ? [line] : [<br key={i} />, line]))}</h2>
          <div className="landing-hero-row">
            <div className="landing-hero-copy">
              <p className="landing-tagline">{val('landing_subtext')}</p>

              <div className="landing-ctas">
                <Link to="/login" className="landing-cta landing-cta-primary">
                  <div className="cta-title">{t('cta_login_title')}</div>
                  <div className="cta-sub">{t('cta_login_sub')}</div>
                  <div className="cta-arrow">→</div>
                </Link>

                <Link to="/tax" className="landing-cta landing-cta-secondary">
                  <div className="cta-title">{t('cta_tax_title')}</div>
                  <div className="cta-sub">{t('cta_tax_sub')}</div>
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
        </div>
      </section>

      <section id="about" className={`landing-about${aboutImage ? ' landing-about--split' : ''}`}>
        {aboutImage ? (
          <div className="landing-section-inner about-split">
            <div className="about-copy">
              <h3>{t('about_heading')}</h3>
              {aboutParas.map((p, i) => <p key={i}>{p}</p>)}
            </div>
            <div className="about-media">
              <img src={aboutImage} alt="" />
            </div>
          </div>
        ) : (
          <div className={`landing-section-inner about-inner ${alignClass}`}>
            <h3>{t('about_heading')}</h3>
            {aboutParas.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        )}
      </section>

      <section id="services" className="landing-services">
        <div className={`landing-section-inner ${alignClass}`}>
          <h3>{t('services_heading')}</h3>
          <div className="services-grid">
            {services.map((s, i) => (
              <div className="service-card" key={i}>
                {s.title && <h4>{s.title}</h4>}
                {s.text && <p>{s.text}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-join">
        <div className="landing-section-inner join-inner">
          <div>
            <h3>{t('become_heading')}</h3>
            <p>{t('become_text')}</p>
          </div>
          {/^https?:\/\//i.test(t('become_url')) ? (
            <a href={t('become_url')} className="btn-large" target="_blank" rel="noopener noreferrer">{t('become_button')}</a>
          ) : (
            <Link to={t('become_url') || '/signup'} className="btn-large">{t('become_button')}</Link>
          )}
        </div>
      </section>

      <section className="landing-portal-promo">
        <div className="landing-section-inner promo-inner">
          <div>
            <h3>{t('promo_heading')}</h3>
            <p>{t('promo_text')}</p>
          </div>
          <Link to="/login" className="btn-large">{t('promo_button')}</Link>
        </div>
      </section>

      <footer id="contact" className="landing-footer">
        <div className="landing-section-inner footer-grid">
          <div>
            <h5>{t('footer_contact_heading')}</h5>
            <p><a href={`mailto:${val('email')}`}>{val('email')}</a></p>
            <p><a href={`tel:${String(val('phone')).replace(/\s+/g, '')}`}>{val('phone')}</a></p>
          </div>
          <div>
            <h5>{t('footer_office_heading')}</h5>
            <p>{val('address_line1')}</p>
            {c.address_line2 && <p>{c.address_line2}</p>}
            <p>{val('city')}</p>
            {t('hours_line1') && <p>{t('hours_line1')}</p>}
            {t('hours_line2') && <p>{t('hours_line2')}</p>}
          </div>
          <div>
            <h5>{t('footer_connect_heading')}</h5>
            {facebook && <p><a href={facebook} target="_blank" rel="noopener noreferrer">Facebook</a></p>}
            {instagram && <p><a href={instagram} target="_blank" rel="noopener noreferrer">Instagram</a></p>}
            {linkedin && <p><a href={linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a></p>}
            <div className="landing-quicklinks">
              <Link to="/login" className="ql-btn">Client Portal <span className="ql-arrow">→</span></Link>
              <Link to="/tax" className="ql-btn">Tax Calculator <span className="ql-arrow">→</span></Link>
              <Link to="/app" className="ql-btn">Client Apps <span className="ql-arrow">→</span></Link>
              <span className="ql-btn ql-disabled" aria-disabled="true" title="Coming soon">PC Prime Academy <span className="ql-soon">coming soon</span></span>
            </div>
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
