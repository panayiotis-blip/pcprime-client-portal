import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Firm review of self-service app-access requests (/app → "Register"). Approve
// to create the app login (choose which client + role) or reject.

type Req = { id: number; app_key: string; client_name: string; full_name: string | null; username: string; email: string | null; phone: string | null; message: string | null; created_at: string };

export default function AppAccessRequests() {
  const { user } = useAuth();
  const { clients } = useApp();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Record<number, { clientId: string; role: string }>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => { setLoading(true); api.listAppRequests().then(r => setReqs(r as Req[])).catch(() => setReqs([])).finally(() => setLoading(false)); };
  useEffect(load, []);

  if (!isSupervisorOrHigher(user)) return <div className="empty-state"><p>This screen is available to owners and supervisors only.</p></div>;

  const clientOpts = (clients as any[]).filter(c => c.client_category !== 'vendor_only').sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const approve = async (r: Req) => {
    const s = sel[r.id];
    if (!s?.clientId) { alert('Choose which client to link this request to first.'); return; }
    setBusy(r.id);
    try { await api.approveAppRequest(r.id, Number(s.clientId), r.app_key, s.role || 'editor'); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); } finally { setBusy(null); }
  };
  const reject = async (r: Req) => {
    if (!confirm(`Reject the request from ${r.username} (${r.client_name})?`)) return;
    setBusy(r.id);
    try { await api.rejectAppRequest(r.id); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); } finally { setBusy(null); }
  };

  const setField = (id: number, field: 'clientId' | 'role', value: string) =>
    setSel(p => {
      const cur = p[id] || { clientId: '', role: 'editor' };
      return { ...p, [id]: { ...cur, [field]: value } };
    });

  return (
    <div className="dashboard" style={{ padding: '1rem 1.5rem' }}>
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>App access requests</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        People who requested access at <code>/app</code>. Approving creates their login (they chose the username + password) — pick which client it belongs to and a role.
      </p>

      {loading ? <PanelSkeleton rows={6} /> : reqs.length === 0 ? (
        <div className="empty-state"><p>No pending requests.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reqs.map(r => (
            <div key={r.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Company (typed)</div><strong style={{ color: '#1a365d' }}>{r.client_name}</strong></div>
                <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Name</div>{r.full_name || '—'}</div>
                <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Username</div><strong>{r.username}</strong></div>
                <div><div style={{ fontSize: 11, color: '#94a3b8' }}>App</div>{r.app_key}</div>
                <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Contact</div>{r.email || r.phone || '—'}</div>
              </div>
              {r.message && <p style={{ fontSize: 13, color: '#475569', margin: '8px 0 0' }}>{r.message}</p>}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, color: '#64748b' }}>Link to client<br />
                  <select className="form-input" value={sel[r.id]?.clientId || ''} onChange={e => setField(r.id, 'clientId', e.target.value)} style={{ minWidth: 240 }}>
                    <option value="">— choose client —</option>
                    {clientOpts.map(c => <option key={c.id} value={c.id}>{c.client_code ? `[${c.client_code}] ` : ''}{c.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: '#64748b' }}>Role<br />
                  <select className="form-input" value={sel[r.id]?.role || 'editor'} onChange={e => setField(r.id, 'role', e.target.value)}>
                    <option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option>
                  </select>
                </label>
                <button className="btn btn-primary" disabled={busy === r.id} onClick={() => approve(r)}>Approve → create login</button>
                <button className="btn btn-secondary" style={{ color: '#b91c1c' }} disabled={busy === r.id} onClick={() => reject(r)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
