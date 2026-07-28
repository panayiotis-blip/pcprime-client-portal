import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { PanelSkeleton } from '../ui';

// Property Rentals module — foundation scaffold. Loads the rental document for
// a client from Supabase (migration 160) and shows a summary. The full
// interactive app (ported from the standalone HTML) is wired in next; this
// proves the data + access-control path end to end.

type RentalClient = { id: number; name: string; client_code: string | null };

export default function RentalModule() {
  const { clientId: clientIdParam } = useParams();
  const [clients, setClients] = useState<RentalClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<any | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getRentalClients()
      .then(setClients)
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Chosen client: the route param, or the only one the user can access.
  const selectedId = clientIdParam ? Number(clientIdParam) : (clients.length === 1 ? clients[0].id : null);
  const selected = clients.find(c => c.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId) { setDoc(null); setUpdatedAt(null); return; }
    setDocLoading(true);
    api.getRentalData(selectedId)
      .then(r => { setDoc(r?.data ?? null); setUpdatedAt(r?.updated_at ?? null); })
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setDocLoading(false));
  }, [selectedId]);

  const stats = useMemo(() => {
    if (!doc) return null;
    const properties = Array.isArray(doc.properties) ? doc.properties.length : 0;
    const tenants = Array.isArray(doc.tenants) ? doc.tenants.length : 0;
    let receipts = 0;
    for (const t of (doc.tenants || [])) {
      for (const yr of Object.values(t.pay || {}) as any[]) {
        for (const mo of (yr || [])) receipts += (mo.receipts ? mo.receipts.length : 0);
      }
    }
    return { properties, tenants, receipts };
  }, [doc]);

  return (
    <div className="dashboard" style={{ padding: '1rem 1.5rem' }}>
      <div className="dashboard-header">
        <h2 style={{ margin: 0 }}>🏠 Property Rentals</h2>
      </div>

      {loading ? (
        <PanelSkeleton rows={6} />
      ) : err ? (
        <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <p>The rental module isn't enabled for any client you can access.</p>
          <p style={{ fontSize: 13, color: '#64748b' }}>Enable it per client with <code>clients.rental_enabled = true</code>.</p>
        </div>
      ) : !selectedId ? (
        // Firm staff with more than one rental client → pick one.
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 13, color: '#64748b' }}>Choose a client:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clients.map(c => (
              <Link key={c.id} to={`/rentals/${c.id}`} className="btn btn-secondary" style={{ textAlign: 'left' }}>
                {c.client_code ? <span className="client-code-inline">{c.client_code}</span> : null}{c.name}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 12px' }}>
            <strong style={{ fontSize: 16, color: '#1a365d' }}>{selected?.name || `Client #${selectedId}`}</strong>
            {clients.length > 1 && <Link to="/rentals" style={{ fontSize: 13, color: '#1e40af' }}>← change client</Link>}
          </div>

          {docLoading ? (
            <PanelSkeleton rows={4} />
          ) : !doc ? (
            <div className="empty-state">
              <p>No rental data loaded for this client yet.</p>
              <p style={{ fontSize: 13, color: '#64748b' }}>Run the seed step to import the existing rentals, or start entering data once the app is wired in.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                {[
                  { label: 'Properties', value: stats?.properties ?? 0 },
                  { label: 'Tenants', value: stats?.tenants ?? 0 },
                  { label: 'Receipts on file', value: stats?.receipts ?? 0 },
                ].map(c => (
                  <div key={c.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 18px', minWidth: 150 }}>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{c.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#1a365d', marginTop: 4 }}>{c.value}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8' }}>
                Data last updated {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}.
                The full rental workspace (properties, rent schedule, receipts, arrears, deposits, statements) is being wired in next.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
