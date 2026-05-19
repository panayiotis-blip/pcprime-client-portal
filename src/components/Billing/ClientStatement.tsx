import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { buildStatement } from './statement';
import { generateDocumentPdf } from '../../services/documentPdf';

// Client statements: tick one or more clients, optionally set a date range,
// then print them all together or email each client their own.
export default function ClientStatement() {
  const { clients } = useApp();
  const [selected, setSelected]     = useState<Set<number>>(new Set());
  const [search, setSearch]         = useState('');
  const [from, setFrom]             = useState('');
  const [to, setTo]                 = useState('');
  const [preview, setPreview]       = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [emailing, setEmailing]     = useState('');

  const selectedIds = [...selected];

  const filteredClients = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return clients;
    return clients.filter((c: any) =>
      (c.name || '').toLowerCase().includes(t) ||
      (c.client_code || '').toLowerCase().includes(t));
  }, [clients, search]);

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Preview the ledger when exactly one client is ticked.
  useEffect(() => {
    if (selectedIds.length !== 1) { setPreview(null); return; }
    let cancelled = false;
    setLoadingPreview(true);
    (async () => {
      try {
        const d = await api.getClientStatement(selectedIds[0]);
        if (!cancelled) setPreview(d);
      } catch (err: any) {
        if (!cancelled) alert('Failed to load: ' + err.message);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);   // eslint-disable-line react-hooks/exhaustive-deps

  const statement = useMemo(() => {
    if (!preview) return null;
    return buildStatement(preview.invoices, preview.receipts, from || undefined, to || undefined);
  }, [preview, from, to]);

  const eur = (n: number) => '€' + n.toFixed(2);

  const rangeQuery = () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    const q = qs.toString();
    return q ? '?' + q : '';
  };

  const printSelected = () => {
    if (selectedIds.length === 0) { alert('Tick at least one client.'); return; }
    const qs = new URLSearchParams();
    qs.set('clients', selectedIds.join(','));
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    window.open(`/billing/statements/print?${qs.toString()}`, '_blank');
  };

  const emailSelected = async () => {
    if (selectedIds.length === 0) { alert('Tick at least one client.'); return; }
    const targets = selectedIds.map(id => {
      const cl: any = clients.find((c: any) => c.id === id);
      return { id, name: cl?.name as string | undefined, email: cl?.email as string | undefined };
    });
    const sendable = targets.filter(t => t.email);
    const skipped  = targets.length - sendable.length;
    if (sendable.length === 0) {
      alert('None of the selected clients have an email address on file.');
      return;
    }
    if (!confirm(
      `Email a statement to ${sendable.length} client(s)?` +
      (skipped ? `\n${skipped} without an email address will be skipped.` : ''),
    )) return;

    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < sendable.length; i++) {
      const t = sendable[i];
      setEmailing(`Sending ${i + 1} of ${sendable.length}…`);
      try {
        const content = await generateDocumentPdf(`/billing/statement/${t.id}/print${rangeQuery()}`);
        await api.sendEmail({
          to: [t.email!],
          subject: 'Statement of account',
          text: `Dear ${t.name || 'Sir/Madam'},\n\nPlease find attached your statement of account.\n\nKind regards`,
          attachments: [{
            file_name: `Statement-${String(t.name || t.id).replace(/[^\w-]+/g, '_')}.pdf`,
            content,
            content_type: 'application/pdf',
          }],
        });
        ok++;
      } catch (err: any) {
        fails.push(`${t.name || t.id}: ${err.message}`);
      }
    }
    setEmailing('');
    alert(`Sent ${ok} of ${sendable.length}.` + (fails.length ? `\n\nFailed:\n${fails.join('\n')}` : ''));
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Client Statements</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8 }}>
          <Link to="/billing" className="btn btn-secondary">← Invoices</Link>
          <button className="btn btn-secondary" onClick={printSelected} disabled={!!emailing}>
            🖨 Print selected ({selectedIds.length})
          </button>
          <button className="btn btn-primary" onClick={emailSelected} disabled={!!emailing}>
            {emailing || `✉ Email selected (${selectedIds.length})`}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label>From (optional)</label>
            <input type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To (optional)</label>
            <input type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Search clients</label>
            <input type="text" className="form-input" value={search}
              onChange={e => setSearch(e.target.value)} placeholder="Name or code…" />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Client checklist */}
        <div className="card" style={{ maxHeight: 520, overflowY: 'auto' }}>
          {filteredClients.length === 0 ? (
            <p style={{ color: '#64748b' }}>No clients match.</p>
          ) : filteredClients.map((c: any) => (
            <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <span style={{ fontSize: 13 }}>
                {c.client_code ? c.client_code + ' — ' : ''}{c.name}
                {!c.email && <span style={{ color: '#b91c1c', fontSize: 11 }}> (no email)</span>}
              </span>
            </label>
          ))}
        </div>

        {/* Preview / hint */}
        <div>
          {selectedIds.length === 0 ? (
            <div className="empty-state"><p>Tick one or more clients on the left.</p></div>
          ) : selectedIds.length > 1 ? (
            <div className="empty-state">
              <p>{selectedIds.length} clients selected — use "Print selected" or "Email selected" above.</p>
            </div>
          ) : loadingPreview ? (
            <div className="loading-screen">Loading…</div>
          ) : statement ? (
            <div className="export-table-wrapper">
              <table className="export-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Debit</th>
                    <th style={{ textAlign: 'right' }}>Credit</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ fontStyle: 'italic', color: '#64748b' }}>
                    <td colSpan={4}>Opening balance</td>
                    <td style={{ textAlign: 'right' }}>{eur(statement.opening)}</td>
                  </tr>
                  {statement.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                      <td>{r.description}</td>
                      <td style={{ textAlign: 'right' }}>{r.debit ? eur(r.debit) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.credit ? eur(r.credit) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{eur(r.balance)}</td>
                    </tr>
                  ))}
                  {statement.rows.length === 0 && (
                    <tr><td colSpan={5} style={{ color: '#64748b' }}>No transactions in this period.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                    <td colSpan={4}>Balance due</td>
                    <td style={{ textAlign: 'right' }}>{eur(statement.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
