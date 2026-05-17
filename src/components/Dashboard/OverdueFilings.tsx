import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

// KPI widget: count of tax filings past their due date that aren't filed/paid.
// Click to drill into the global page filtered to overdue only.
export default function OverdueFilings() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const n = await api.countTaxFilings({ overdue_only: true });
        if (mounted) setCount(n);
      } catch {
        if (mounted) setCount(0);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const isWarning = count != null && count > 0;
  return (
    <Link
      to="/tax-filings?overdue=1"
      className={`kpi-tile ${isWarning ? 'kpi-tile-danger' : ''}`}
    >
      <div className="kpi-tile-label">Overdue Filings</div>
      <div className="kpi-tile-value">{count == null ? '…' : count}</div>
      <div className="kpi-tile-hint">past due, not yet filed</div>
    </Link>
  );
}
