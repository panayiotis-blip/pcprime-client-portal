import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { normalizeName, jaroWinkler } from '../../services/clientMatch';

// Standalone duplicate-finder. Scans ALL existing clients for likely duplicate
// PAIRS (the same client entered twice, often once in Greek and once in Latin)
// and lists them so staff can merge. Read-only: it only surfaces candidates;
// the actual merge happens on the /merge page (pre-filled via query params).
// Reuses the same matching primitives as Smart Import (services/clientMatch.ts).

// Local copies of clientMatch's private helpers (kept tiny + in sync on purpose).
const cleanId = (v: unknown) => String(v ?? '').replace(/[\s\-_.]/g, '').toLowerCase();
const emailList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[;,]+/)).map(cleanId).filter(Boolean);

type Prepared = {
  c: any;
  names: string[];       // normalized name + name_tax_office (non-empty only)
  emails: string[];
  vat: string;
  code: string;
  phone: string;
};

type Pair = { a: any; b: any; score: number; reason: string };

// Sensitivity presets. 'strong' restricts to exact strong-identifier matches;
// the others add fuzzy name matching at the given Jaro-Winkler threshold.
const PRESETS: { key: string; label: string; strongOnly?: boolean; threshold?: number }[] = [
  { key: 'strong', label: 'Strong IDs only (email / tax no. / code / phone)', strongOnly: true },
  { key: 'high', label: 'Very likely — names ≥ 90%', threshold: 0.90 },
  { key: 'likely', label: 'Likely — names ≥ 85%', threshold: 0.85 },
  { key: 'possible', label: 'Possible — names ≥ 80% (more noise)', threshold: 0.80 },
];
const MAX_ROWS = 300;

// Category scope filter — company-vs-individual mix rarely produces real dups.
const CAT_GROUPS: Record<string, Set<string>> = {
  individual: new Set(['individual', 'self_employed', 'sole_trader']),
  company: new Set(['company', 'partnership']),
};

// Map a match reason back to a filterable key.
const reasonKey = (r: string): string =>
  r.startsWith('Email') ? 'email'
  : r.startsWith('Tax') ? 'tax'
  : r.startsWith('Client code') ? 'code'
  : r.startsWith('Phone') ? 'phone'
  : 'name';

export default function DuplicateFinder() {
  const { clients } = useApp();
  const [presetKey, setPresetKey] = useState('likely');
  const [catFilter, setCatFilter] = useState<'all' | 'individual' | 'company'>('all');
  const [excludeInactive, setExcludeInactive] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [truncated, setTruncated] = useState(0);
  // Results filters (post-scan, no re-scan needed).
  const [resultQuery, setResultQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');

  const preset = PRESETS.find((p) => p.key === presetKey)!;
  const fmtEmail = (v: any) => (Array.isArray(v) ? v[0] : v) || '';

  // Pre-normalize the in-scope clients once; the pairwise loop then only does
  // cheap comparisons. Scope = category + active filters. O(n) prep + O(n²)
  // compares — fine for an on-demand report.
  const prepared = useMemo<Prepared[]>(() => (clients as any[])
    .filter((c) => catFilter === 'all' || CAT_GROUPS[catFilter]?.has(c.client_category))
    .filter((c) => !excludeInactive || c.is_active !== false)
    .map((c) => ({
      c,
      names: [normalizeName(c.name ?? ''), normalizeName(c.name_tax_office ?? '')].filter(Boolean),
      emails: emailList(c.email),
      vat: cleanId(c.vat_number ?? c.tax_number),
      code: cleanId(c.client_code),
      phone: cleanId(c.phone),
    })), [clients, catFilter, excludeInactive]);

  const scorePair = (A: Prepared, B: Prepared, threshold: number, strongOnly: boolean): Pair | null => {
    if (A.emails.length && B.emails.length && A.emails.some((e) => B.emails.includes(e)))
      return { a: A.c, b: B.c, score: 1, reason: 'Email match' };
    if (A.vat && A.vat === B.vat) return { a: A.c, b: B.c, score: 0.99, reason: 'Tax number match' };
    if (A.code && A.code === B.code) return { a: A.c, b: B.c, score: 0.97, reason: 'Client code match' };
    if (A.phone && A.phone === B.phone) return { a: A.c, b: B.c, score: 0.9, reason: 'Phone match' };
    if (strongOnly || !A.names.length || !B.names.length) return null;
    let best = 0;
    for (const x of A.names) for (const y of B.names) { const s = jaroWinkler(x, y); if (s > best) best = s; }
    if (best >= threshold) return { a: A.c, b: B.c, score: best, reason: `Name ${Math.round(best * 100)}%` };
    return null;
  };

  const scan = () => {
    setScanning(true);
    // Defer so the "Scanning…" state paints before the synchronous compute.
    setTimeout(() => {
      const threshold = preset.threshold ?? 1;
      const strongOnly = !!preset.strongOnly;
      const found: Pair[] = [];
      for (let i = 0; i < prepared.length; i++) {
        for (let j = i + 1; j < prepared.length; j++) {
          const p = scorePair(prepared[i], prepared[j], threshold, strongOnly);
          if (p) found.push(p);
        }
      }
      found.sort((x, y) => y.score - x.score);
      setTruncated(Math.max(0, found.length - MAX_ROWS));
      setPairs(found.slice(0, MAX_ROWS));
      setScanning(false);
    }, 20);
  };

  // Apply the results filters (text + match type) to the scanned pairs.
  const displayed = useMemo(() => {
    if (!pairs) return [];
    const q = resultQuery.trim().toLowerCase();
    return pairs.filter((p) => {
      if (reasonFilter !== 'all' && reasonKey(p.reason) !== reasonFilter) return false;
      if (!q) return true;
      const hay = [
        p.a.name, p.a.name_tax_office, p.a.client_code, fmtEmail(p.a.email), p.a.tax_number, p.a.vat_number,
        p.b.name, p.b.name_tax_office, p.b.client_code, fmtEmail(p.b.email), p.b.tax_number, p.b.vat_number,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [pairs, resultQuery, reasonFilter]);

  const badge = (score: number) => {
    const pct = Math.round(score * 100);
    const color = score >= 0.97 ? '#047857' : score >= 0.9 ? '#9b861f' : '#b45309';
    return <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>;
  };

  const meta = (c: any) => [c.client_code, c.tax_number || c.vat_number, fmtEmail(c.email)].filter(Boolean).join(' · ');

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>⧉ Find duplicate clients</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Scans clients for likely duplicates — the same client entered twice
        (often once in Greek, once in Latin), or sharing an email / tax number / code / phone.
        Nothing changes until you open a pair and merge it.
      </p>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 600, color: '#475569' }}>
          Sensitivity
          <select className="form-input" style={{ maxWidth: 340 }} value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 600, color: '#475569' }}>
          Category
          <select className="form-input" style={{ maxWidth: 170 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value as any)}>
            <option value="all">All clients</option>
            <option value="individual">Individuals only</option>
            <option value="company">Companies only</option>
          </select>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#475569' }}>
          <input type="checkbox" checked={excludeInactive} onChange={(e) => setExcludeInactive(e.target.checked)} />
          Exclude inactive / erased
        </label>
        <button className="btn btn-primary btn-sm" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning…' : `Scan ${prepared.length} clients`}
        </button>
      </div>

      {pairs !== null && (
        <>
          {/* Results filters */}
          {pairs.length > 0 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <input
                className="form-input" style={{ maxWidth: 300 }}
                placeholder="Filter results by name, code, email…"
                value={resultQuery} onChange={(e) => setResultQuery(e.target.value)}
              />
              <select className="form-input" style={{ maxWidth: 190 }} value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="all">All match types</option>
                <option value="email">Email match</option>
                <option value="tax">Tax number match</option>
                <option value="code">Client code match</option>
                <option value="phone">Phone match</option>
                <option value="name">Name similarity</option>
              </select>
            </div>
          )}

          <p style={{ fontSize: 13, color: displayed.length ? '#1a365d' : '#94a3b8', fontWeight: 600 }}>
            {pairs.length === 0
              ? 'No likely duplicates found at this sensitivity.'
              : displayed.length === 0
                ? 'No pairs match your filters.'
                : `Showing ${displayed.length} of ${pairs.length}${truncated ? `+ (top ${MAX_ROWS} of ${pairs.length + truncated})` : ''} possible duplicate pair${pairs.length === 1 ? '' : 's'}.`}
          </p>
          {displayed.length > 0 && (
            <table className="export-table">
              <thead><tr><th>Client A</th><th>Client B</th><th>Match</th><th></th></tr></thead>
              <tbody>
                {displayed.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <Link to={`/clients/${p.a.id}`}>{p.a.name || `#${p.a.id}`}</Link>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{meta(p.a)}</div>
                    </td>
                    <td>
                      <Link to={`/clients/${p.b.id}`}>{p.b.name || `#${p.b.id}`}</Link>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{meta(p.b)}</div>
                    </td>
                    <td>{p.reason} {badge(p.score)}</td>
                    <td>
                      <Link className="btn btn-secondary btn-sm" to={`/merge?keep=${p.a.id}&merge=${p.b.id}`}>Review &amp; merge</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
