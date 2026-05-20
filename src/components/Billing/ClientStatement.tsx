import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { buildStatement } from './statement';
import { generateDocumentPdf } from '../../services/documentPdf';

type Row = {
  client_id: number;
  name: string;
  client_code: string | null;
  email: string | null;
  balance: number;
};

type BalanceFilter = 'all' | 'owing' | 'zero' | 'credit';

// Client statements — a full-width searchable list with per-row tick boxes,
// a balance filter, and one-click batch print/email of selected clients.
export default function ClientStatement() {
  const { clients } = useApp();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch]     = useState('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [balFilter, setBalFilter] = useState<BalanceFilter>('all');

  const [balanceByClient, setBalanceByClient] = useState<Map<number, number>>(new Map());
  const [balancesLoaded, setBalancesLoaded]   = useState(false);

  const [preview, setPreview]                 = useState<any>(null);
  const [loadingPreview, setLoadingPreview]   = useState(false);
  const [emailing, setEmailing]               = useState('');

  const selectedIds = [...selected];

  // Compute the balance for every client from invoices + receipts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [invs, rcps] = await Promise.all([
          api.getClientInvoices(),
          api.getReceipts(),
        ]);
        if (cancelled) return;
        const m = new Map<number, number>();
        for (const inv of invs as any[]) {
          if (inv.status !== 'issued' && inv.status !== 'paid') continue;
          m.set(inv.client_id, (m.get(inv.client_id) || 0) + Number(inv.total_amount || 0));
        }
        for (const r of rcps as any[]) {
          m.set(r.client_id, (m.get(r.client_id) || 0) - Number(r.amount || 0));
        }
        // Round to 2dp to avoid floating-point fuzz on "zero".
        for (const [k, v] of m) m.set(k, Math.round(v * 100) / 100);
        setBalanceByClient(m);
      } catch (err: any) {
        alert('Failed to load balances: ' + err.message);
      } finally {
        if (!cancelled) setBalancesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows: Row[] = useMemo(() => {
    return clients.map((c: any) => ({
      client_id:   c.id,
      name:        c.name || '—',
      client_code: c.client_code || null,
      email:       c.email || null,
      balance:     balanceByClient.get(c.id) || 0,
    }));
  }, [clients, balanceByClient]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !(
        r.name.toLowerCase().includes(q) ||
        (r.client_code || '').toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q)
      )) return false;
      if (balFilter === 'owing'  && !(r.balance >  0)) return false;
      if (balFilter === 'zero'   && !(r.balance === 0)) return false;
      if (balFilter === 'credit' && !(r.balance <  0)) return false;
      return true;
    });
  }, [rows, search, balFilter]);

  const allVisibleTicked =
    filteredRows.length > 0 && filteredRows.every(r => selected.has(r.client_id));

  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleTicked) {
        for (const r of filteredRows) next.delete(r.client_id);
      } else {
        for (const r of filteredRows) next.add(r.client_id);
      }
      return next;
    });
  };

  // Ledger preview when exactly one client is ticked.
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

  const ledger = useMemo(() => {
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
            <label>Search</label>
            <input type="text" className="form-input" value={search}
              onChange={e => setSearch(e.target.value)} placeholder="Name, code or email…" />
          </div>
          <div className="form-group">
            <label>Balance</label>
            <select className="form-input" value={balFilter} onChange={e => setBalFilter(e.target.value as BalanceFilter)}>
              <option value="all">All</option>
              <option value="owing">Owing (&gt; 0)</option>
              <option value="zero">Zero balance</option>
              <option value="credit">In credit (&lt; 0)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="export-table-wrapper">
        <table className="export-table">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allVisibleTicked}
                  onChange={toggleAllVisible}
                  title={allVisibleTicked ? 'Unselect all visible' : 'Select all visible'}
                />
              </th>
              <th style={{ width: 110 }}>Code</th>
              <th>Name</th>
              <th>Email</th>
              <th style={{ width: 120, textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {!balancesLoaded ? (
              <tr><td colSpan={5} style={{ color: '#64748b' }}>Loading balances…</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={5} style={{ color: '#64748b' }}>No clients match the current filters.</td></tr>
            ) : filteredRows.map(r => (
              <tr key={r.client_id} style={{ cursor: 'pointer' }} onClick={() => toggleOne(r.client_id)}>
                <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(r.client_id)} onChange={() => toggleOne(r.client_id)} />
                </td>
                <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>{r.client_code || '—'}</td>
                <td>{r.name}</td>
                <td style={{ color: r.email ? undefined : '#b91c1c' }}>{r.email || 'no email'}</td>
                <td style={{
                  textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600,
                  color: r.balance > 0 ? '#b91c1c' : (r.balance < 0 ? '#166534' : '#64748b'),
                }}>{eur(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0' }}>
        {filteredRows.length} of {rows.length} clients shown · {selectedIds.length} selected
      </p>

      {/* Ledger preview when exactly one client is ticked */}
      {selectedIds.length === 1 && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ marginBottom: 8 }}>Ledger preview</h3>
          {loadingPreview ? (
            <div className="loading-screen">Loading…</div>
          ) : ledger ? (
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
                    <td style={{ textAlign: 'right' }}>{eur(ledger.opening)}</td>
                  </tr>
                  {ledger.rows.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                      <td>{r.description}</td>
                      <td style={{ textAlign: 'right' }}>{r.debit ? eur(r.debit) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.credit ? eur(r.credit) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{eur(r.balance)}</td>
                    </tr>
                  ))}
                  {ledger.rows.length === 0 && (
                    <tr><td colSpan={5} style={{ color: '#64748b' }}>No transactions in this period.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                    <td colSpan={4}>Balance due</td>
                    <td style={{ textAlign: 'right' }}>{eur(ledger.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
