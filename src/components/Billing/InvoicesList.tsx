import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useViewPreferences } from '../../context/ViewPreferencesContext';
import ViewToggle from '../shared/ViewToggle';

type Status = 'draft' | 'issued' | 'paid' | 'cancelled';

type Invoice = {
  id: number;
  client_id: number;
  client_name: string | null;
  client_code: string | null;
  invoice_number: string | null;
  status: Status;
  issue_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  total_amount: number;
  vat_amount: number;
  subtotal_vatable: number;
  subtotal_nonvatable: number;
};

const statusBadge = (s: Status) => {
  switch (s) {
    case 'draft':     return { bg: '#f1f5f9', fg: '#475569', label: 'Draft' };
    case 'issued':    return { bg: '#dbeafe', fg: '#1e40af', label: 'Issued' };
    case 'paid':      return { bg: '#dcfce7', fg: '#166534', label: 'Paid' };
    case 'cancelled': return { bg: '#fee2e2', fg: '#991b1b', label: 'Cancelled' };
  }
};

export default function InvoicesList() {
  const navigate = useNavigate();
  const { clients } = useApp();
  const { getMode, setMode } = useViewPreferences();
  const viewMode = getMode('client_invoices', 'list');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [fStatus, setFStatus]   = useState<string>('');
  const [fClient, setFClient]   = useState<string>('');
  const [search, setSearch]     = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (fStatus) params.status    = fStatus;
      if (fClient) params.client_id = Number(fClient);
      const data = await api.getClientInvoices(params);
      setInvoices(data as Invoice[]);
    } catch (err: any) {
      alert('Failed to load invoices: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus, fClient]);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const t = search.toLowerCase();
    return invoices.filter(i =>
      (i.invoice_number || '').toLowerCase().includes(t) ||
      (i.client_name || '').toLowerCase().includes(t) ||
      (i.client_code || '').toLowerCase().includes(t),
    );
  }, [invoices, search]);

  const totals = useMemo(() => {
    return {
      count:  filtered.length,
      issued: filtered.filter(i => i.status === 'issued').reduce((s, i) => s + Number(i.total_amount || 0), 0),
      paid:   filtered.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total_amount || 0), 0),
      draft:  filtered.filter(i => i.status === 'draft').reduce((s, i) => s + Number(i.total_amount || 0), 0),
    };
  }, [filtered]);

  const handleCreateBlank = async () => {
    // Prompt for a client, then create a draft invoice
    const choices = clients.map((c: any) => `${c.client_code ? c.client_code + ' — ' : ''}${c.name}`).join('\n');
    const pick = prompt(`Pick a client to invoice (paste the exact code or name):\n\n${choices.slice(0, 1500)}${choices.length > 1500 ? '\n…' : ''}`);
    if (!pick) return;
    const c = clients.find((x: any) =>
      pick.includes(x.client_code) || pick.toLowerCase().includes(x.name.toLowerCase()),
    );
    if (!c) { alert('No matching client.'); return; }
    try {
      const { id } = await api.createClientInvoice({ client_id: c.id });
      navigate(`/billing/${id}`);
    } catch (err: any) {
      alert('Create failed: ' + err.message);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Client Invoices</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ViewToggle value={viewMode} onChange={(m) => setMode('client_invoices', m)} />
          <Link to="/billing/recurring" className="btn btn-secondary">Recurring</Link>
          <button className="btn btn-primary" onClick={handleCreateBlank}>+ New Invoice</button>
        </div>
      </div>

      {/* Compact stats */}
      <div className="stats-grid stats-grid-compact" style={{ marginBottom: 12 }}>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{totals.count}</div>
          <div className="stat-label">Invoices</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">€{totals.draft.toFixed(2)}</div>
          <div className="stat-label">In draft</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">€{totals.issued.toFixed(2)}</div>
          <div className="stat-label">Outstanding</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">€{totals.paid.toFixed(2)}</div>
          <div className="stat-label">Paid</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label>Status</label>
            <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group">
            <label>Client</label>
            <select className="form-input" value={fClient} onChange={e => setFClient(e.target.value)}>
              <option value="">All clients</option>
              {clients.map((c: any) => (
                <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Search</label>
            <input type="text" className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Invoice #, client name…" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No invoices match the current filters.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="invoice-cards">
          {filtered.map(i => {
            const b = statusBadge(i.status);
            const subtotal = Number(i.subtotal_vatable || 0) + Number(i.subtotal_nonvatable || 0);
            return (
              <div key={i.id} className="invoice-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/billing/${i.id}`)}>
                <div className="card-header">
                  <span style={{ fontFamily: 'monospace' }}>{i.invoice_number || '(draft)'}</span>
                  <span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{b.label}</span>
                </div>
                <div className="card-body">
                  <div style={{ fontWeight: 500 }}>
                    {i.client_code && <span style={{ color: '#64748b' }}>{i.client_code} — </span>}{i.client_name}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    Issued: {i.issue_date || '—'}  ·  Due: {i.due_date || '—'}
                  </div>
                  <div style={{ fontSize: 13 }}>Subtotal €{subtotal.toFixed(2)}  ·  VAT €{Number(i.vat_amount || 0).toFixed(2)}</div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>€{Number(i.total_amount || 0).toFixed(2)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'compact' ? (
        <div className="invoice-cards invoice-cards-compact">
          {filtered.map(i => {
            const b = statusBadge(i.status);
            return (
              <div key={i.id} className="invoice-card invoice-card-compact" style={{ cursor: 'pointer' }} onClick={() => navigate(`/billing/${i.id}`)}>
                <div className="card-header">
                  <span style={{ fontFamily: 'monospace' }}>{i.invoice_number || '(draft)'}</span>
                  <span style={{ background: b.bg, color: b.fg, padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>{b.label}</span>
                </div>
                <div className="card-body">
                  <div>{i.client_name}</div>
                  <div style={{ fontWeight: 600 }}>€{Number(i.total_amount || 0).toFixed(2)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Status</th>
                <th>Client</th>
                <th>Issue date</th>
                <th>Due date</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
                <th style={{ textAlign: 'right' }}>VAT</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => {
                const b = statusBadge(i.status);
                const subtotal = Number(i.subtotal_vatable || 0) + Number(i.subtotal_nonvatable || 0);
                return (
                  <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/billing/${i.id}`)}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {i.invoice_number || <span style={{ color: '#94a3b8' }}>(draft)</span>}
                    </td>
                    <td>
                      <span style={{
                        background: b.bg, color: b.fg, padding: '2px 8px',
                        borderRadius: 4, fontSize: 12, fontWeight: 500,
                      }}>{b.label}</span>
                    </td>
                    <td>
                      {i.client_code && <span style={{ color: '#64748b' }}>{i.client_code} — </span>}
                      {i.client_name}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{i.issue_date || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{i.due_date || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{subtotal.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{Number(i.vat_amount || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>€{Number(i.total_amount || 0).toFixed(2)}</td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/billing/${i.id}`); }}
                      >Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
