import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

// Staff review/approve queue for client onboarding submissions. Each submission
// is diffed against the live client record; staff pick which changes to apply
// (clients never silently overwrite firm data). Extra info the client gave
// (employment, KYC, lists) is shown and captured to a client note on approve.

type Sub = {
  id: number; token: string; client_id: number | null; mode: string; status: string;
  payload: any; prefill: any; notes: string | null;
  created_at: string; submitted_at: string | null;
};

// Core payload-key -> client column mappings that approve can apply directly.
const CORE: { k: string; col: string; label: string }[] = [
  { k: 'name', col: 'name', label: 'Legal / full name' },
  { k: 'name_tax_office', col: 'name_tax_office', label: 'Name (Greek/tax office)' },
  { k: 'trading_name', col: 'trading_name', label: 'Trading name' },
  { k: 'client_category', col: 'client_category', label: 'Category' },
  { k: 'id_number', col: 'id_number', label: 'ID number' },
  { k: 'passport_number', col: 'passport_number', label: 'Passport number' },
  { k: 'date_of_birth', col: 'date_of_birth', label: 'Date of birth' },
  { k: 'nationality', col: 'nationality', label: 'Nationality' },
  { k: 'registration_number', col: 'registration_number', label: 'Registration (HE) no.' },
  { k: 'incorporation_date', col: 'incorporation_date', label: 'Incorporation date' },
  { k: 'phone', col: 'phone', label: 'Phone' },
  { k: 'mobile', col: 'mobile', label: 'Mobile' },
  { k: 'email', col: 'email', label: 'Email' },
  { k: 'website', col: 'website', label: 'Website' },
  { k: 'contact_person', col: 'contact_person', label: 'Contact person' },
  { k: 'addr_line1', col: 'address', label: 'Address' },
  { k: 'addr_city', col: 'city', label: 'City' },
  { k: 'addr_postal', col: 'postal_code', label: 'Postal code' },
  { k: 'addr_country', col: 'country', label: 'Country' },
  { k: 'tax_number', col: 'tax_number', label: 'Tax number (TIC)' },
  { k: 'vat_number', col: 'vat_number', label: 'VAT number' },
  { k: 'social_insurance_number', col: 'social_insurance_number', label: 'Social Insurance no.' },
  { k: 'employer_number', col: 'employer_number', label: 'SI employer no.' },
];
const CORE_KEYS = new Set(CORE.map((c) => c.k));
const CATEGORY_MAP: Record<string, string> = {
  Individual: 'individual', 'Self-employed': 'self_employed', Company: 'company',
  Partnership: 'partnership', Other: 'other',
};
const norm = (v: any) => (Array.isArray(v) ? v.join('; ') : String(v ?? '')).trim();

export default function ClientIntakeReview() {
  const { clients } = useApp();
  const [rows, setRows] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'submitted' | 'all'>('submitted');
  // Link generator
  const [linkClient, setLinkClient] = useState<string>('');
  const [newLink, setNewLink] = useState<string>('');
  const [linkBusy, setLinkBusy] = useState(false);

  const createLink = async () => {
    setLinkBusy(true); setNewLink('');
    try {
      const clientId = linkClient ? Number(linkClient) : null;
      const { token } = await api.createClientIntake({ clientId, mode: clientId ? 'refresh' : 'new', expiresInDays: 30 });
      setNewLink(`${window.location.origin}/client-intake/${token}`);
    } catch (e: any) {
      alert('Could not create link: ' + e.message);
    } finally {
      setLinkBusy(false);
    }
  };
  const [sel, setSel] = useState<Sub | null>(null);
  const [live, setLive] = useState<any | null>(null);
  const [apply, setApply] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.listClientIntakes().then((d) => setRows(d as Sub[])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const shown = useMemo(
    () => rows.filter((r) => (tab === 'submitted' ? r.status === 'submitted' : true)),
    [rows, tab],
  );

  const openReview = async (s: Sub) => {
    setSel(s); setLive(null);
    let current: any = s.prefill || {};
    if (s.client_id) {
      try { current = await api.getClient(s.client_id); } catch { /* fall back to prefill */ }
    }
    setLive(current);
    // Pre-tick every changed core field.
    const next: Record<string, boolean> = {};
    for (const c of CORE) {
      const sub = norm(s.payload?.[c.k]);
      const cur = norm(c.k === 'addr_line1' ? current.address : current[c.col] ?? current[c.k]);
      if (sub && sub !== cur) next[c.k] = true;
    }
    setApply(next);
  };

  const diffs = useMemo(() => {
    if (!sel) return [];
    return CORE.map((c) => {
      const submitted = norm(sel.payload?.[c.k]);
      const onFile = norm(c.k === 'addr_line1' ? live?.address : live?.[c.col] ?? live?.[c.k]);
      return { ...c, submitted, onFile, changed: !!submitted && submitted !== onFile };
    });
  }, [sel, live]);

  // Extra (non-core) payload entries to show + capture as a note.
  const extras = useMemo(() => {
    if (!sel?.payload) return [];
    return Object.entries(sel.payload).filter(
      ([k, v]) => !CORE_KEYS.has(k) && !k.startsWith('_') && v != null && v !== '' &&
        !(Array.isArray(v) && v.length === 0),
    );
  }, [sel]);

  const extrasNote = () =>
    extras.map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`).join('\n');

  const approve = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const patch: any = {};
      for (const d of diffs) {
        if (!d.changed || !apply[d.k]) continue;
        let val: any = sel.payload[d.k];
        if (d.col === 'client_category') val = CATEGORY_MAP[val] || String(val).toLowerCase();
        patch[d.col] = val;
      }
      let clientId = sel.client_id;
      if (clientId) {
        if (Object.keys(patch).length) await api.updateClient(clientId, patch);
      } else {
        if (!patch.name) { alert('A name is required to create a new client.'); setBusy(false); return; }
        clientId = (await api.createClient(patch)).id;
      }
      // Capture the extra info (employment / KYC / lists) so it isn't lost.
      if (clientId && extras.length) {
        try {
          await api.createClientNote(clientId, {
            body: `Onboarding submission (${new Date().toLocaleDateString('en-GB')}):\n${extrasNote()}`,
            needs_attention: true,
          });
        } catch { /* note is best-effort */ }
      }
      await api.reviewClientIntake(sel.id, { status: 'approved' });
      setSel(null); load();
    } catch (e: any) {
      alert('Approve failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!sel) return;
    const notes = prompt('Reason for rejecting (optional):') || undefined;
    setBusy(true);
    try {
      await api.reviewClientIntake(sel.id, { status: 'rejected', notes });
      setSel(null); load();
    } catch (e: any) {
      alert('Reject failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const pill = (s: string) => {
    const m: Record<string, string> = { submitted: '#9b861f', approved: '#047857', rejected: '#b91c1c', pending: '#64748b' };
    return <span style={{ fontSize: 12, fontWeight: 600, color: m[s] || '#64748b' }}>{s}</span>;
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>📝 Onboarding submissions</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Review what clients submitted and apply the changes you accept. Nothing updates a client record until you approve it.
      </p>

      {/* Create an onboarding / refresh link to send a client */}
      <div className="card" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Create link:</span>
        <select className="form-input" style={{ maxWidth: 320 }} value={linkClient} onChange={(e) => setLinkClient(e.target.value)}>
          <option value="">New client (blank intake)</option>
          {(clients as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}{c.client_code ? ` · ${c.client_code}` : ''}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={createLink} disabled={linkBusy}>
          {linkBusy ? 'Creating…' : 'Generate link'}
        </button>
        {newLink && (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flex: '1 1 100%', marginTop: 6 }}>
            <input className="form-input" readOnly value={newLink} style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
            <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(newLink)}>Copy</button>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['submitted', 'all'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: '1px solid ' + (tab === t ? '#1a365d' : '#cbd5e1'),
              background: tab === t ? '#1a365d' : '#fff', color: tab === t ? '#fff' : '#475569' }}>
            {t === 'submitted' ? 'Awaiting review' : 'All'}
          </button>
        ))}
      </div>

      {loading ? <p>Loading…</p> : shown.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>Nothing here.</p>
      ) : (
        <table className="export-table">
          <thead><tr><th>Submitted</th><th>Mode</th><th>Client</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-GB') : '—'}</td>
                <td>{r.mode === 'new' ? 'New client' : 'Refresh'}</td>
                <td>{r.payload?.name || r.prefill?.name || (r.client_id ? `#${r.client_id}` : 'New')}</td>
                <td>{pill(r.status)}</td>
                <td>{r.status === 'submitted' && <button className="btn btn-primary btn-sm" onClick={() => openReview(r)}>Review</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <div onClick={() => !busy && setSel(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 10, padding: 22, maxWidth: 820, width: '100%' }}>
            <h3 style={{ marginTop: 0, color: '#1a365d' }}>
              Review submission — {sel.mode === 'new' ? 'new client' : (live?.name || sel.payload?.name || `client #${sel.client_id}`)}
            </h3>

            <h4 style={{ margin: '14px 0 6px', color: '#475569' }}>Core details</h4>
            <table className="export-table" style={{ margin: 0 }}>
              <thead><tr><th style={{ width: 40 }}>Apply</th><th>Field</th><th>On file</th><th>Submitted</th></tr></thead>
              <tbody>
                {diffs.filter((d) => d.submitted || d.onFile).map((d) => (
                  <tr key={d.k} style={{ background: d.changed ? 'rgba(234,179,8,0.08)' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      {d.changed ? (
                        <input type="checkbox" checked={!!apply[d.k]} onChange={(e) => setApply((p) => ({ ...p, [d.k]: e.target.checked }))} />
                      ) : '—'}
                    </td>
                    <td>{d.label}</td>
                    <td style={{ color: '#64748b' }}>{d.onFile || '—'}</td>
                    <td style={{ fontWeight: d.changed ? 600 : 400 }}>{d.submitted || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {extras.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 6px', color: '#475569' }}>Additional info (saved to client notes on approve)</h4>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, fontSize: 13, maxHeight: 240, overflowY: 'auto' }}>
                  {extras.map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 4 }}>
                      <strong>{k}:</strong> {Array.isArray(v) ? JSON.stringify(v) : String(v)}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={() => setSel(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-secondary" style={{ color: '#b91c1c' }} onClick={reject} disabled={busy}>Reject</button>
              <button className="btn btn-primary" onClick={approve} disabled={busy}>
                {busy ? 'Working…' : sel.client_id ? 'Approve & apply' : 'Approve & create client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
