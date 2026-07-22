import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api, hasPermission } from '../../services/api';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';

type Credential = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  owner_label: string | null;
  platform: string;
  sub_type: string | null;
  username: string | null;
  notes: string | null;
  // Per-credential URL, falling back to the platform site's default.
  effective_url: string | null;
};

// Suggested values — accepted as free text via datalist
const PLATFORM_SUGGESTIONS = [
  'Taxisnet', 'Tax For All', 'CY Login', 'Social Insurance',
  'Ergani', 'JCC', 'VAT (VIES)', 'GESY', 'Bank Portal', 'Other',
];
const SUBTYPE_SUGGESTIONS = [
  'Tax', 'VAT', 'VAT-Old', 'VAT-H&H',
  'Cleaning', 'Construction', 'Liquidation', 'Partnership', 'Accountant',
];

const blank = () => ({
  client_id:   '' as string,
  owner_label: '',
  platform:    '',
  sub_type:    '',
  username:    '',
  password:    '',
  notes:       '',
});

// Standalone Passwords / Credentials page. Lists every credential the user
// can see (linked + firm-owned), with filter by platform/sub-type.
export default function CredentialsVault() {
  const { user } = useAuth();
  const { clients } = useApp();
  const { runWith } = useMFAStepUp();

  const canReveal = hasPermission(user, 'credentials.reveal');
  const canWrite  = hasPermission(user, 'credentials.write');

  const [rows, setRows] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [fPlatform, setFPlatform] = useState('');
  const [fSubtype, setFSubtype]   = useState('');
  const [fOwner, setFOwner]       = useState<'all' | 'client' | 'firm'>('all');
  const [search, setSearch]       = useState('');

  // Reveal state — id → plaintext (or null while loading)
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [revealing, setRevealing] = useState<Record<number, boolean>>({});

  // Modal
  const [editing, setEditing] = useState<{ id: number | null; form: any } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getAllCredentials();
      setRows(data as Credential[]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Distinct platforms / subtypes from current data (for filter dropdowns)
  const platforms = useMemo(() =>
    Array.from(new Set(rows.map(r => r.platform).filter(Boolean))).sort(),
    [rows]);
  const subtypes = useMemo(() =>
    Array.from(new Set(rows.map(r => r.sub_type).filter(Boolean) as string[])).sort(),
    [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (fPlatform && r.platform !== fPlatform) return false;
      if (fSubtype  && r.sub_type !== fSubtype)  return false;
      if (fOwner === 'client' && !r.client_id)   return false;
      if (fOwner === 'firm'   && r.client_id)    return false;
      if (q) {
        const hay = `${r.platform} ${r.sub_type || ''} ${r.username || ''} ${r.notes || ''} ${r.client_name || ''} ${r.client_code || ''} ${r.owner_label || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, fPlatform, fSubtype, fOwner, search]);

  const handleReveal = async (id: number) => {
    if (revealed[id] !== undefined) {
      // Hide
      setRevealed(r => { const n = { ...r }; delete n[id]; return n; });
      return;
    }
    setRevealing(r => ({ ...r, [id]: true }));
    try {
      const pwd = await runWith(() => api.getCredentialPassword(id));
      setRevealed(r => ({ ...r, [id]: pwd }));
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Reveal failed: ' + err.message);
    } finally {
      setRevealing(r => ({ ...r, [id]: false }));
    }
  };

  const handleCopy = async (id: number) => {
    let pwd = revealed[id];
    if (pwd === undefined) {
      try {
        pwd = await runWith(() => api.getCredentialPassword(id));
      } catch (err: any) {
        if (err.message !== MFA_CANCELLED) alert('Reveal failed: ' + err.message);
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(pwd);
      alert('Password copied to clipboard.');
    } catch {
      alert('Clipboard write blocked. Reveal the password to read it.');
    }
  };

  const openAdd = () => setEditing({ id: null, form: blank() });
  const openEdit = (r: Credential) => setEditing({
    id: r.id,
    form: {
      client_id:   r.client_id ? String(r.client_id) : '',
      owner_label: r.owner_label || '',
      platform:    r.platform,
      sub_type:    r.sub_type || '',
      username:    r.username || '',
      password:    '',  // never pre-fill — user must reveal to see existing
      notes:       r.notes || '',
    },
  });
  const closeEdit = () => setEditing(null);

  const handleSave = async () => {
    if (!editing) return;
    const f = editing.form;
    if (!f.platform.trim()) { alert('Platform is required'); return; }
    if (!f.client_id && !f.owner_label.trim()) {
      alert('Pick a client OR enter an owner label (e.g. "Firm" / "H&H")');
      return;
    }
    setSaving(true);
    try {
      if (editing.id == null) {
        await api.createCredentialV2({
          client_id: f.client_id ? Number(f.client_id) : null,
          owner_label: f.owner_label.trim() || undefined,
          platform: f.platform.trim(),
          sub_type: f.sub_type.trim() || undefined,
          username: f.username.trim() || undefined,
          password: f.password || undefined,
          notes: f.notes.trim() || undefined,
        });
      } else {
        const patch: any = {
          client_id:   f.client_id ? Number(f.client_id) : null,
          owner_label: f.owner_label.trim() || null,
          platform:    f.platform.trim(),
          sub_type:    f.sub_type.trim() || null,
          username:    f.username.trim() || null,
          notes:       f.notes.trim() || null,
        };
        if (f.password) patch.password = f.password;
        await api.updateCredentialV2(editing.id, patch);
      }
      closeEdit();
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Inline link: change just the client_id on an existing credential
  const handleQuickLink = async (id: number, clientId: number | null) => {
    try {
      await api.updateCredentialV2(id, { client_id: clientId });
      await load();
    } catch (err: any) {
      alert('Link failed: ' + err.message);
    }
  };

  const handleDelete = async (r: Credential) => {
    const label = r.client_code ? `${r.platform} for ${r.client_code}` : `${r.platform} (${r.owner_label || 'unlinked'})`;
    if (!confirm(`Delete credential: ${label}?`)) return;
    try {
      await api.deleteCredentialV2(r.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Credentials Vault ({rows.length})</h2>
        {canWrite && (
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Credential</button>
        )}
      </div>

      <p style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
        All platform passwords — client-linked and firm-owned. Reveal requires MFA verification and is audit-logged.
      </p>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }}>
        <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
          <label>Search</label>
          <input
            type="text"
            className="form-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="username, notes, client, label..."
          />
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Platform</label>
          <select className="form-input" value={fPlatform} onChange={e => setFPlatform(e.target.value)}>
            <option value="">All</option>
            {platforms.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 150 }}>
          <label>Sub-type</label>
          <select className="form-input" value={fSubtype} onChange={e => setFSubtype(e.target.value)}>
            <option value="">All</option>
            {subtypes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 130 }}>
          <label>Owner</label>
          <select className="form-input" value={fOwner} onChange={e => setFOwner(e.target.value as any)}>
            <option value="all">All</option>
            <option value="client">Client-linked</option>
            <option value="firm">Firm-owned (unlinked)</option>
          </select>
        </div>
        {(fPlatform || fSubtype || fOwner !== 'all' || search) && (
          <button className="btn btn-link btn-sm" onClick={() => { setFPlatform(''); setFSubtype(''); setFOwner('all'); setSearch(''); }}>Clear</button>
        )}
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : error ? (
        <div className="empty-state"><p style={{ color: '#b91c1c' }}>{error}</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{rows.length === 0 ? 'No credentials yet.' : 'No credentials match the current filters.'}</p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Sub-type</th>
                <th>Linked to</th>
                <th>Username</th>
                <th>Password</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.platform}</strong>
                    {/* Click straight through to the platform's own site. No
                        password ceremony — that's what Quick login is for on
                        the client's Credentials tab. */}
                    {r.effective_url && (
                      <a
                        href={r.effective_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${r.effective_url}`}
                        style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </td>
                  <td>{r.sub_type || '—'}</td>
                  <td>
                    {r.client_id && r.client_code ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Link to={`/clients/${r.client_id}`}>
                          <span className="client-code-inline">{r.client_code}</span>
                          {r.client_name}
                        </Link>
                        {canWrite && (
                          <button
                            className="btn btn-link btn-sm"
                            onClick={() => handleQuickLink(r.id, null)}
                            title="Unlink (mark as firm-owned)"
                            style={{ color: '#94a3b8', fontSize: 11 }}
                          >
                            unlink
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {r.owner_label ? (
                          <span style={{ fontStyle: 'italic', color: '#475569' }}>🏢 {r.owner_label}</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>(unlinked)</span>
                        )}
                        {canWrite && (
                          // Value is never stored — picking a client fires the link
                          // action and the picker resets to its placeholder.
                          <div style={{ maxWidth: 220 }}>
                            <SearchableSelect
                              value=""
                              options={toClientOptions(clients)}
                              onChange={v => { if (v) handleQuickLink(r.id, Number(v)); }}
                              placeholder="→ Link to client…"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td>{r.username || '—'}</td>
                  <td>
                    {revealed[r.id] !== undefined ? (
                      <code style={{ background: '#fef3c7', padding: '2px 6px', borderRadius: 3 }}>{revealed[r.id]}</code>
                    ) : (
                      <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>••••••••</span>
                    )}
                    {canReveal && (
                      <>
                        <button
                          className="btn btn-link btn-sm"
                          onClick={() => handleReveal(r.id)}
                          disabled={revealing[r.id]}
                          style={{ marginLeft: 6 }}
                        >
                          {revealing[r.id] ? '…' : revealed[r.id] !== undefined ? 'Hide' : 'Reveal'}
                        </button>
                        <button
                          className="btn btn-link btn-sm"
                          onClick={() => handleCopy(r.id)}
                          title="Copy password to clipboard"
                          disabled={revealing[r.id]}
                        >
                          ⧉
                        </button>
                      </>
                    )}
                  </td>
                  <td style={{ maxWidth: 220, fontSize: 12 }}>{r.notes || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canWrite && <button className="btn btn-link btn-sm" onClick={() => openEdit(r)}>Edit</button>}
                    {canWrite && <button className="btn btn-link btn-sm" onClick={() => handleDelete(r)} style={{ color: '#b91c1c' }}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      {editing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>{editing.id == null ? 'Add credential' : 'Edit credential'}</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>Platform *</label>
                <input
                  type="text"
                  className="form-input"
                  list="platform-suggestions"
                  value={editing.form.platform}
                  onChange={e => setEditing(s => s ? { ...s, form: { ...s.form, platform: e.target.value } } : s)}
                  autoFocus
                />
                <datalist id="platform-suggestions">
                  {PLATFORM_SUGGESTIONS.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label>Sub-type</label>
                <input
                  type="text"
                  className="form-input"
                  list="subtype-suggestions"
                  value={editing.form.sub_type}
                  onChange={e => setEditing(s => s ? { ...s, form: { ...s.form, sub_type: e.target.value } } : s)}
                  placeholder="e.g. VAT / Cleaning / (blank)"
                />
                <datalist id="subtype-suggestions">
                  {SUBTYPE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="form-group full-width">
                <label>Linked client</label>
                <SearchableSelect
                  value={editing.form.client_id}
                  options={toClientOptions(clients)}
                  onChange={v => setEditing(s => s ? { ...s, form: { ...s.form, client_id: v ? String(v) : '', owner_label: v ? '' : s.form.owner_label } } : s)}
                  placeholder="— Not linked (firm-owned) —"
                  allowClear
                />
              </div>
              {!editing.form.client_id && (
                <div className="form-group full-width">
                  <label>Owner label *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editing.form.owner_label}
                    onChange={e => setEditing(s => s ? { ...s, form: { ...s.form, owner_label: e.target.value } } : s)}
                    placeholder='e.g. "Firm" / "H&H Accountant" / "Banking - General"'
                  />
                  <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Required when not linked to a client.</p>
                </div>
              )}
              <div className="form-group"><label>Username</label><input type="text" className="form-input" value={editing.form.username} onChange={e => setEditing(s => s ? { ...s, form: { ...s.form, username: e.target.value } } : s)} /></div>
              <div className="form-group">
                <label>{editing.id == null ? 'Password' : 'Password (leave blank to keep)'}</label>
                <input type="text" className="form-input" value={editing.form.password} onChange={e => setEditing(s => s ? { ...s, form: { ...s.form, password: e.target.value } } : s)} />
              </div>
              <div className="form-group full-width"><label>Notes</label><textarea className="form-input" rows={3} value={editing.form.notes} onChange={e => setEditing(s => s ? { ...s, form: { ...s.form, notes: e.target.value } } : s)} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={closeEdit} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
