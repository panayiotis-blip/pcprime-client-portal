import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

interface UnlinkedDirector {
  id: number;
  client_id: number;
  name: string;
  role: string;
  shareholding_percent: number | null;
  appointed_date: string | null;
  company_id: number | null;
  company_name: string | null;
  company_code: string | null;
}

// Admin tool: surface directors whose director_client_id is null and let the
// user either link them to an existing client or auto-create a new individual
// client from the director's name. Useful after a bulk import where the
// Relationships sheet referenced codes that weren't in the Clients sheet.
export default function UnlinkedDirectors() {
  const { user } = useAuth();
  const { clients, refreshClients } = useApp();
  const [rows, setRows] = useState<UnlinkedDirector[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');

  const canEdit = user?.role === 'owner' || user?.role === 'supervisor' || user?.role === 'admin' || user?.role === 'staff';

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getUnlinkedDirectors();
      setRows(data as UnlinkedDirector[]);
    } catch (err: any) {
      alert('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (companyFilter && r.company_id !== Number(companyFilter)) return false;
      if (q && !((r.name || '').toLowerCase().includes(q)
              || (r.company_name || '').toLowerCase().includes(q)
              || (r.role || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, companyFilter]);

  const individualClients = useMemo(() =>
    clients
      .filter((c: any) => (c.client_category === 'individual' || (c.client_code || '').startsWith('PC-IN'))
                       && !c.deleted_at)
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')),
    [clients]
  );

  const handleLink = async (d: UnlinkedDirector, clientId: number) => {
    setBusyId(d.id);
    try {
      await api.updateClientDirector(d.id, { director_client_id: clientId });
      setRows(prev => prev.filter(r => r.id !== d.id));
    } catch (err: any) {
      alert('Link failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAndLink = async (d: UnlinkedDirector) => {
    if (!confirm(`Create a new individual client named "${d.name}" and link to this director row?`)) return;
    setBusyId(d.id);
    try {
      const c = await api.createClientFromDirector(d.id, d.name);
      await refreshClients();
      setRows(prev => prev.filter(r => r.id !== d.id));
      alert(`Created ${(c as any).client_code} — ${(c as any).name}.`);
    } catch (err: any) {
      alert('Failed: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Companies that appear in the unlinked list (for the filter dropdown)
  const companiesInList = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) {
      if (r.company_id && !m.has(r.company_id)) {
        m.set(r.company_id, `${r.company_code ? r.company_code + ' — ' : ''}${r.company_name || ''}`);
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Unlinked Directors ({rows.length})</h2>
        <Link to="/clients" className="btn btn-secondary">← Back to Clients</Link>
      </div>

      <p style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
        Director rows imported with a name but no link to a client record.
        Either pick an existing individual client from the dropdown, or click
        <em> Create as new client</em> to auto-create a <code>PC-IN-NNN</code> record and link it.
      </p>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>✓ All director rows are linked.</p>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="form-group" style={{ flex: 1, minWidth: 240 }}>
              <label>Search (name / company / role)</label>
              <input
                type="text"
                className="form-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="…"
              />
            </div>
            <div className="form-group" style={{ minWidth: 220 }}>
              <label>Filter by company</label>
              <select className="form-input" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
                <option value="">All companies</option>
                {companiesInList.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            {(search || companyFilter) && (
              <button className="btn btn-link btn-sm" onClick={() => { setSearch(''); setCompanyFilter(''); }}>Clear</button>
            )}
          </div>

          <div className="compliance-table-wrapper">
            <table className="compliance-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Director name</th>
                  <th>Role</th>
                  <th>Link to existing client</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id}>
                    <td>
                      {d.company_id ? (
                        <Link to={`/clients/${d.company_id}`}>
                          {d.company_code ? <span className="client-code-inline">{d.company_code}</span> : null}
                          {d.company_name || 'Unknown'}
                        </Link>
                      ) : '—'}
                    </td>
                    <td>{d.name}</td>
                    <td>{d.role}</td>
                    <td>
                      <select
                        className="form-input form-input-sm"
                        disabled={!canEdit || busyId === d.id}
                        defaultValue=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) handleLink(d, Number(v));
                          // Reset the dropdown so it doesn't keep showing the chosen value after the row disappears
                          e.target.value = '';
                        }}
                        style={{ minWidth: 220 }}
                      >
                        <option value="">— Pick client —</option>
                        {individualClients.map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.client_code ? c.client_code + ' — ' : ''}{c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    {canEdit && (
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleCreateAndLink(d)}
                          disabled={busyId === d.id}
                          title="Auto-create a new PC-IN-XXX individual record using the director name"
                        >
                          {busyId === d.id ? '…' : '+ Create new'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
