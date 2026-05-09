import { Link } from 'react-router-dom';
// @ts-expect-error — JSX file with no exported types, fine to import as default
import CyprusTaxCalculator from '../CyprusTaxCalculator.jsx';

export default function TaxCalculator() {
  return (
    <div className="public-page">
      <header className="public-header">
        <Link to="/" className="public-brand" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <img
            src="/logo.png"
            alt="PC Prime & Calculate Consultants Ltd"
            style={{ height: 128, width: 'auto', display: 'block' }}
          />
        </Link>
        <Link to="/login" className="btn btn-secondary btn-sm">Client Portal →</Link>
      </header>

      <main className="public-main public-main-wide">
        <CyprusTaxCalculator />
      </main>

      <footer className="public-footer">
        <span>© {new Date().getFullYear()} PC Prime &amp; Calculate Consultants Ltd</span>
        <Link to="/">← Back to home</Link>
      </footer>
    </div>
  );
}
