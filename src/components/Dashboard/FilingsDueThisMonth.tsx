import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

// Small KPI-style widget. Counts tax filings due within the current calendar
// month (status pending/in_progress/overdue). Click to drill into the global
// page with the filter pre-applied.
export default function FilingsDueThisMonth() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const n = await api.countTaxFilings({ due_this_month: true });
        if (mounted) setCount(n);
      } catch {
        if (mounted) setCount(0);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <Link to="/tax-filings?due_this_month=1" className="kpi-tile" style={{ background: '#dbeafe' }}>
      <div className="kpi-tile-value" style={{ color: '#1e40af' }}>
        {count == null ? '…' : count}
      </div>
      <div className="kpi-tile-label">Filings due this month</div>
      <div className="kpi-tile-hint">pending / in progress / overdue</div>
    </Link>
  );
}
