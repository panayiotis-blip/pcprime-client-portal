import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';

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
  appointed_date: string | null;
  resigned_date: string | null;
  notes: string | null;
};

const ROLES = ['director', 'shareholder', 'both', 'secretary', 'signatory'];

const blank = (): Partial<Director> => ({
  name: '', id_number: '', email: '', phone: '',
  shareholding_percent: null, role: 'director',
  appointed_date: '', resigned_date: '', notes: '',
  director_client_id: null,
});

// Tab 4: Directors / Shareholders.
// Editable list with add/remove. Each row can optionally link to another
// client record (when the director is also a client).
export default function DirectorsTab({ clientId, canEdit }: Props) {
  const { clients } = useApp();
  const [rows, setRows] = useState<Director[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Partial<Director>>(blank());

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.getClientDirectors(clientId) as Director[]);
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
      setAdding(false);
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

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Directors &amp; Shareholders</h3>
          {canEdit && !adding && (
            <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Add</button>
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
                  <th>Name</th>
                  <th>Role</th>
                  <th style={{ width: 80 }}>Share %</th>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Linked client</th>
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
                        {canEdit ? (
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
                          <select
                            className="form-input form-input-sm"
                            value={d.role}
                            onChange={(e) => handleUpdate(d.id, { role: e.target.value })}
                          >
                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : d.role}
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
                      <td>
                        {canEdit ? (
                          <select
                            className="form-input form-input-sm"
                            value={d.director_client_id ?? ''}
                            onChange={(e) => handleUpdate(d.id, { director_client_id: e.target.value ? Number(e.target.value) : null })}
                          >
                            <option value="">— None —</option>
                            {clients.map((c: any) => (
                              <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>
                            ))}
                          </select>
                        ) : linked ? (
                          <Link to={`/clients/${linked.id}`}>{linked.client_code ? linked.client_code + ' — ' : ''}{linked.name}</Link>
                        ) : '—'}
                      </td>
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
          <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>Add director</h4>
            <div className="form-grid">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  className="form-input"
                  value={newRow.name || ''}
                  onChange={(e) => setNewRow(p => ({ ...p, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select className="form-input" value={newRow.role} onChange={(e) => setNewRow(p => ({ ...p, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
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
              <div className="form-group"><label>Email</label><input type="email" className="form-input" value={newRow.email || ''} onChange={(e) => setNewRow(p => ({ ...p, email: e.target.value }))} /></div>
              <div className="form-group"><label>Phone</label><input type="text" className="form-input" value={newRow.phone || ''} onChange={(e) => setNewRow(p => ({ ...p, phone: e.target.value }))} /></div>
              <div className="form-group"><label>Appointed Date</label><input type="date" className="form-input" value={newRow.appointed_date || ''} onChange={(e) => setNewRow(p => ({ ...p, appointed_date: e.target.value }))} /></div>
              <div className="form-group">
                <label>Linked client (optional)</label>
                <select
                  className="form-input"
                  value={newRow.director_client_id ?? ''}
                  onChange={(e) => setNewRow(p => ({ ...p, director_client_id: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">— None —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleAdd}>Save director</button>
              <button className="btn btn-secondary" onClick={() => { setAdding(false); setNewRow(blank()); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
