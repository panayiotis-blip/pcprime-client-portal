import { Link } from 'react-router-dom';

type Variant = 'default' | 'warning' | 'danger' | 'success';

interface Props {
  label: string;
  value: number | string;
  hint?: string;
  variant?: Variant;
  to?: string;
  loading?: boolean;
}

// Small clickable KPI tile used in the dashboard's top strip.
// Renders as a Link if `to` is supplied, otherwise a plain div.
export default function KpiTile({ label, value, hint, variant = 'default', to, loading }: Props) {
  // Label on top, then the big number, then the context/trend line.
  const content = (
    <>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{loading ? '…' : value}</div>
      {hint && <div className="kpi-tile-hint">{hint}</div>}
    </>
  );
  const className = `kpi-tile kpi-tile-${variant}`;
  return to
    ? <Link to={to} className={className}>{content}</Link>
    : <div className={className}>{content}</div>;
}
