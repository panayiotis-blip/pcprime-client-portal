import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import SearchableSelect from '../../common/SearchableSelect';

interface Props { clientId: number; canEdit: boolean; }

type Director = {
  id: number;
  client_id: number;
  director_client_id: number | null;
  name: string;
  id_number: string | null;
  email: string | null;
  phone: string | null;
  shareholding_percent: number | null;
  role: string;
  is_director: boolean;
  is_shareholder: boolean;
  is_secretary: boolean;
  is_signatory: boolean;
  is_ubo: boolean;
  appointed_date: string | null;
  resigned_date: string | null;
  notes: string | null;
};

type Directorship = Director & {
  company_name: string | null;
  company_code: string | null;
};

// Independent roles a person can hold on a company (any combination).
type FlagKey = 'is_director' | 'is_shareholder' | 'is_secretary' | 'is_signatory' | 'is_ubo';
const ROLE_FLAGS: { key: FlagKey; label: string }[] = [
  { key: 'is_director',    label: 'Director' },
  { key: 'is_shareholder', label: 'Shareholder' },
  { key: 'is_secretary',   label: 'Secretary' },
  { key: 'is_signatory',   label: 'Signatory' },
  { key: 'is_ubo',         label: 'UBO' },
];

// Render the active roles as badges (falls back to any legacy free-text role).
const roleBadges = (d: any) => {
  const active = ROLE_FLAGS.filter(f => d[f.key]);
  if (!active.length) return <span style={{ color: '#94a3b8' }}>{d.role || '—'}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {active.map(f => (
        <span key={f.key} style={{ background: '#eef1f5', color: '#1a365d', borderRadius: 999, fontSize: 11, padding: '1px 8px', fontWeight: 600 }}>{f.label}</span>
      ))}
    </span>
  );
};

const blank = (): Partial<Director> => ({
  name: '', id_number: '', email: '', phone: '',
  shareholding_percent: null,
  is_director: true, is_shareholder: false, is_secretary: false, is_signatory: false, is_ubo: false,
  appointed_date: '', resigned_date: '', notes: '',
  director_client_id: null,
});

// Tab 4: Directors / Shareholders.
// Two sections:
//   A) Directors of this client (this client is a company)
//   B) Director/officer of (this client is an individual linked from other companies)
export default function DirectorsTab({ clientId, canEdit }: Props) {
  const { clients } = useApp();
  const [rows, setRows] = useState<Director[]>([]);
  const [reverse, setReverse] = useState<Directorship[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<'link' | 'manual' | null>(null);
  const [newRow, setNewRow] = useState<Partial<Director>>(blank());

  const load = async () => {
    setLoading(true);
    try {
      const [fwd, rev] = await Promise.all([
        api.getClientDirectors(clientId),
        api.getDirectorshipsForClient(clientId),
      ]);
      setRows(fwd as Director[]);
      setReverse(rev as Directorship[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId]);

  const handleAdd = async () => {
    if (!newRow.name?.trim()) { alert('Director name is required'); return; }
    try {
      await api.createClientDirector({
        ...newRow,
        client_id: clientId,
        name: newRow.name.trim(),
        shareholding_percent: newRow.shareholding_percent || null,
        appointed_date: newRow.appointed_date || null,
        resigned_date: newRow.resigned_date || null,
        director_client_id: newRow.director_client_id || null,
      });
      setNewRow(blank());
      setAdding(null);
      await load();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleUpdate = async (id: number, patch: Partial<Director>) => {
    try {
      await api.updateClientDirector(id, patch);
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    } catch (err: any) {
      alert('Failed: ' + err.message);
      await load();
    }
  };

  const handleDelete = async (d: Director) => {
    if (!confirm(`Remove director "${d.name}"?`)) return;
    try {
      await api.deleteClientDirector(d.id);
      await load();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  // When linking an existing client, pre-fill the director name from that client
  const onPickLinkedClient = (id: number | null) => {
    setNewRow(p => {
      const next: any = { ...p, director_client_id: id };
      if (id) {
        const linked = clients.find((c: any) => c.id === id);
        if (linked) {
          next.name = linked.name;
          if (linked.email && !p.email) next.email = Array.isArray(linked.email) ? linked.email[0] : linked.email;
          if (linked.phone && !p.phone) next.phone = linked.phone;
        }
      }
      return next;
    });
  };

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="client-tab-content">
      {/* ===== Section A: Directors OF this client ===== */}
      <div className="form-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Directors &amp; Shareholders</h3>
          {canEdit && !adding && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { setAdding('link'); setNewRow(blank()); }}>+ Link existing client</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setAdding('manual'); setNewRow(blank()); }}>+ Enter manually</button>
            </div>
          )}
        </div>

        {rows.length === 0 && !adding && (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>No directors recorded.</p>
        )}

        {rows.length > 0 && (
          <div className="compliance-table-wrapper">
            <table className="compliance-table">
              <thead>
                <tr>
                  <th>Name / Linked Client</th>
                  <th>Role</th>
                  <th style={{ width: 80 }}>Share %</th>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Appointed</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(d => {
                  const linked = clients.find((c: any) => c.id === d.director_client_id);
                  return (
                    <tr key={d.id}>
                      <td>
                        {linked ? (
                          <>
                            <Link to={`/clients/${linked.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>
                              {linked.client_code ? `${linked.client_code} — ` : ''}{linked.name}
                            </Link>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>(linked client)</div>
                          </>
                        ) : canEdit ? (
                          <input
                            type="text"
                            className="form-input form-input-sm"
                            defaultValue={d.name}
                            onBlur={(e) => e.target.value !== d.name && handleUpdate(d.id, { name: e.target.value })}
                          />
                        ) : d.name}
                      </td>
                      <td>
                        {canEdit ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {ROLE_FLAGS.map(f => {
                              const on = !!(d as any)[f.key];
                              return (
                                <button key={f.key} type="button"
                                  onClick={() => handleUpdate(d.id, { [f.key]: !on } as any)}
                                  title={on ? `Remove ${f.label}` : `Mark as ${f.label}`}
                                  style={{ border: '1px solid', borderColor: on ? '#1a365d' : '#cbd5e1', background: on ? '#1a365d' : '#fff', color: on ? '#fff' : '#64748b', borderRadius: 999, fontSize: 11, padding: '1px 8px', cursor: 'pointer', fontWeight: on ? 600 : 400 }}>
                                  {f.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : roleBadges(d)}
                      </td>
                      <td>
                        {canEdit ? (
                          <input
                            type="number"
                            min={0} max={100} step={0.01}
                            className="form-input form-input-sm"
                            defaultValue={d.shareholding_percent ?? ''}
                            onBlur={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              if (v !== d.shareholding_percent) handleUpdate(d.id, { shareholding_percent: v });
                            }}
                            style={{ width: 70 }}
                          />
                        ) : (d.shareholding_percent != null ? `${d.shareholding_percent}%` : '—')}
                      </td>
                      <td style={{ fontSize: 12 }}>{d.id_number || '—'}</td>
                      <td style={{ fontSize: 12 }}>{d.email || '—'}</td>
                      <td style={{ fontSize: 12 }}>{d.phone || '—'}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{d.appointed_date || '—'}</td>
                      {canEdit && (
                        <td>
                          <button className="btn btn-link btn-sm" onClick={() => handleDelete(d)}>Remove</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {adding && (
          <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 8px 0' }}>
              {adding === 'link' ? 'Link an existing client as director' : 'Enter director details manually'}
            </h4>

            {adding === 'link' && (
              <div className="form-group">
                <label>Linked client *</label>
                <SearchableSelect
                  value={newRow.director_client_id ?? ''}
                  options={clients.filter((c: any) => c.id !== clientId).map((c: any) => ({ value: c.id, label: c.name, sublabel: c.client_code || '' }))}
                  onChange={(v) => onPickLinkedClient(v ? Number(v) : null)}
                  placeholder="Search and pick a client…"
                  allowClear
                />
                <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0 0' }}>
                  Name + contact will pre-fill from the linked record; you can still set roles / shareholding / dates below.
                </p>
              </div>
            )}

            <div className="form-grid">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  className="form-input"
                  value={newRow.name || ''}
                  onChange={(e) => setNewRow(p => ({ ...p, name: e.target.value }))}
                  disabled={adding === 'link' && !!newRow.director_client_id}
                  autoFocus={adding === 'manual'}
                />
              </div>
              <div className="form-group full-width">
                <label>Roles</label>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 4 }}>
                  {ROLE_FLAGS.map(f => (
                    <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!(newRow as any)[f.key]} onChange={(e) => setNewRow(p => ({ ...p, [f.key]: e.target.checked }))} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Shareholding %</label>
                <input
                  type="number"
                  min={0} max={100} step={0.01}
                  className="form-input"
                  value={newRow.shareholding_percent ?? ''}
                  onChange={(e) => setNewRow(p => ({ ...p, shareholding_percent: e.target.value === '' ? null : Number(e.target.value) as any }))}
                />
              </div>
              <div className="form-group"><label>ID Number</label><input type="text" className="form-input" value={newRow.id_number || ''} onChange={(e) => setNewRow(p => ({ ...p, id_number: e.target.value }))} /></div>
              <div className="form-group"><label>Email</label><input type="text" className="form-input" value={newRow.email || ''} onChange={(e) => setNewRow(p => ({ ...p, email: e.target.value }))} /></div>
              <div className="form-group"><label>Phone</label><input type="text" className="form-input" value={newRow.phone || ''} onChange={(e) => setNewRow(p => ({ ...p, phone: e.target.value }))} /></div>
              <div className="form-group"><label>Appointed Date</label><input type="date" className="form-input" value={newRow.appointed_date || ''} onChange={(e) => setNewRow(p => ({ ...p, appointed_date: e.target.value }))} /></div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleAdd}>Save director</button>
              <button className="btn btn-secondary" onClick={() => { setAdding(null); setNewRow(blank()); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ===== Section B: Director / Officer of (reverse lookup) ===== */}
      {reverse.length > 0 && (
        <div className="form-section">
          <h3>Director / Officer of</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px 0' }}>
            This client is listed as a director, UBO, or officer of the following companies:
          </p>
          <div className="compliance-table-wrapper">
            <table className="compliance-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Role</th>
                  <th style={{ width: 80 }}>Share %</th>
                  <th>Appointed</th>
                  <th>Resigned</th>
                </tr>
              </thead>
              <tbody>
                {reverse.map(d => (
                  <tr key={d.id}>
                    <td>
                      {d.company_code || d.company_name ? (
                        <Link to={`/clients/${d.client_id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>
                          {d.company_code ? `${d.company_code} — ` : ''}{d.company_name || 'Unknown'}
                        </Link>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Original record deleted</span>
                      )}
                    </td>
                    <td>{roleBadges(d)}</td>
                    <td>{d.shareholding_percent != null ? `${d.shareholding_percent}%` : '—'}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{d.appointed_date || '—'}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{d.resigned_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
