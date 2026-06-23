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

export default function DuplicateFinder() {
  const { clients } = useApp();
  const [presetKey, setPresetKey] = useState('likely');
  const [scanning, setScanning] = useState(false);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [truncated, setTruncated] = useState(0);

  const preset = PRESETS.find((p) => p.key === presetKey)!;
  const fmtEmail = (v: any) => (Array.isArray(v) ? v[0] : v) || '';

  // Pre-normalize every client once; the pairwise loop then only does cheap
  // comparisons. O(n) prep + O(n²) compares — fine for an on-demand report.
  const prepared = useMemo<Prepared[]>(() => (clients as any[]).map((c) => ({
    c,
    names: [normalizeName(c.name ?? ''), normalizeName(c.name_tax_office ?? '')].filter(Boolean),
    emails: emailList(c.email),
    vat: cleanId(c.vat_number ?? c.tax_number),
    code: cleanId(c.client_code),
    phone: cleanId(c.phone),
  })), [clients]);

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
        Scans all {clients.length} clients for likely duplicates — the same client entered twice
        (often once in Greek, once in Latin), or sharing an email / tax number / code / phone.
        Nothing changes until you open a pair and merge it.
      </p>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Sensitivity:</span>
        <select className="form-input" style={{ maxWidth: 360 }} value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan for duplicates'}
        </button>
      </div>

      {pairs !== null && (
        <>
          <p style={{ fontSize: 13, color: pairs.length ? '#1a365d' : '#94a3b8', fontWeight: 600 }}>
            {pairs.length === 0
              ? 'No likely duplicates found at this sensitivity.'
              : `${pairs.length}${truncated ? `+ (showing top ${MAX_ROWS} of ${pairs.length + truncated})` : ''} possible duplicate pair${pairs.length === 1 ? '' : 's'}.`}
          </p>
          {pairs.length > 0 && (
            <table className="export-table">
              <thead><tr><th>Client A</th><th>Client B</th><th>Match</th><th></th></tr></thead>
              <tbody>
                {pairs.map((p, i) => (
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
