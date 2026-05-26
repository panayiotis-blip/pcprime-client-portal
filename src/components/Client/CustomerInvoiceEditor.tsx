import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { Modal, Button } from '../ui';

type LineType = 'fixed' | 'expense' | 'remarks';
type Line = {
  id?: number; line_no: number; line_type: LineType; description: string;
  quantity: number; unit_price: number; amount: number; vatable: boolean; vat_rate: number;
  _new?: boolean; _dirty?: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function computeTotals(lines: Line[], dType: string | null, dValue: number | null) {
  const taxable = lines.filter(l => l.line_type !== 'remarks' && l.vatable);
  const exempt  = lines.filter(l => l.line_type !== 'remarks' && !l.vatable);
  const sv  = taxable.reduce((s, l) => s + Number(l.amount || 0), 0);
  const snv = exempt.reduce((s, l) => s + Number(l.amount || 0), 0);
  let disc = 0;
  if (dType === 'percent' && dValue) disc = sv * (dValue / 100);
  else if (dType === 'amount' && dValue) disc = Math.min(dValue, sv);
  let vat = 0;
  for (const l of taxable) {
    const amt = Number(l.amount || 0);
    const share = sv > 0 ? amt / sv : 0;
    vat += Math.max(0, amt - share * disc) * Number(l.vat_rate || 0) / 100;
  }
  const total = Math.max(0, sv - disc) + snv + vat;
  return {
    subtotal_vatable: round2(sv), subtotal_nonvatable: round2(snv),
    discount_amount: round2(disc), vat_amount: round2(vat), total_amount: round2(total),
  };
}

const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f1f5f9', fg: '#475569' }, issued: { bg: '#dbeafe', fg: '#1e40af' },
  paid: { bg: '#dcfce7', fg: '#166534' }, cancelled: { bg: '#fee2e2', fg: '#991b1b' },
};

export default function CustomerInvoiceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<any>(null);
  const [lines, setLines]     = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [payOpen, setPayOpen]     = useState(false);
  const [payDate, setPayDate]     = useState('');
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [paying, setPaying]       = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const inv = await api.getCustomerInvoice(Number(id));
      setInvoice(inv);
      setLines((inv.lines || []).map((l: any) => ({
        id: l.id, line_no: l.line_no, line_type: l.line_type, description: l.description,
        quantity: Number(l.quantity), unit_price: Number(l.unit_price), amount: Number(l.amount),
        vatable: l.vatable, vat_rate: Number(l.vat_rate),
      })));
    } catch (err: any) { alert('Load failed: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const totals = useMemo(
    () => computeTotals(lines, invoice?.discount_type || null, invoice?.discount_value ?? null),
    [lines, invoice?.discount_type, invoice?.discount_value],
  );

  if (loading || !invoice) return <div className="loading-screen">Loading…</div>;

  const isEditable = invoice.status === 'draft';
  const c = invoice.customer || {};
  const b = STATUS_BADGE[invoice.status] || STATUS_BADGE.draft;
  const patch = (p: any) => setInvoice((i: any) => ({ ...i, ...p }));

  const addLine = (lt: LineType) => setLines(prev => [...prev, {
    line_no: prev.reduce((m, l) => Math.max(m, l.line_no), 0) + 1, line_type: lt, description: '',
    quantity: lt === 'remarks' ? 0 : 1, unit_price: 0, amount: 0,
    vatable: lt === 'fixed', vat_rate: lt === 'fixed' ? 19 : 0, _new: true, _dirty: true,
  }]);
  const updateLine = (idx: number, p: Partial<Line>) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...p, _dirty: true } : l));
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));

  const save = async (opts?: { silent?: boolean }) => {
    setSaving(true);
    try {
      const t = computeTotals(lines, invoice.discount_type || null, invoice.discount_value ?? null);
      await api.updateCustomerInvoice(invoice.id, {
        issue_date: invoice.issue_date || null, due_date: invoice.due_date || null,
        discount_type: invoice.discount_type || null, discount_value: invoice.discount_value ?? null,
        notes: invoice.notes || null, ...t,
      });
      const originalIds = new Set<number>((invoice.lines || []).map((l: any) => Number(l.id)));
      const currentIds  = new Set<number>(lines.filter(l => l.id).map(l => Number(l.id)));
      for (const oid of originalIds) if (!currentIds.has(oid)) await api.deleteCustomerInvoiceLine(oid);
      for (const l of lines) {
        const payload = {
          line_no: l.line_no, line_type: l.line_type, description: l.description,
          quantity: Number(l.quantity || 0), unit_price: Number(l.unit_price || 0),
          amount: Number(l.amount || 0), vatable: l.vatable, vat_rate: Number(l.vat_rate || 0),
        };
        if (l._new) await api.addCustomerInvoiceLine(invoice.id, payload);
        else if (l._dirty && l.id) await api.updateCustomerInvoiceLine(l.id, payload);
      }
      await load();
      if (!opts?.silent) alert('Saved.');
    } catch (err: any) { alert('Save failed: ' + err.message); }
    finally { setSaving(false); }
  };

  const issue = async () => {
    if (lines.length === 0) { alert('Add at least one line.'); return; }
    if (!confirm('Issue this invoice? A number will be assigned and it will be locked.')) return;
    try { await save({ silent: true }); const num = await api.issueCustomerInvoice(invoice.id); alert(`Issued as ${num}.`); await load(); }
    catch (err: any) { alert('Issue failed: ' + err.message); }
  };
  const markPaid = () => { setPayDate(new Date().toISOString().slice(0, 10)); setPayMethod('Bank Transfer'); setPayOpen(true); };
  const confirmPaid = async () => {
    setPaying(true);
    try { await api.markCustomerInvoicePaid(invoice.id, payDate || undefined, payMethod); setPayOpen(false); await load(); }
    catch (err: any) { alert('Failed: ' + err.message); }
    finally { setPaying(false); }
  };
  const printReceipt = async () => {
    try {
      const r = await api.getCustomerReceiptForInvoice(invoice.id);
      if (!r) { alert('No receipt found for this invoice.'); return; }
      window.open(`/sales/receipt/${r.id}/print`, '_blank');
    } catch (err: any) { alert(err.message); }
  };
  const cancel = async () => {
    if (!confirm('Cancel this invoice?')) return;
    try { await api.cancelCustomerInvoice(invoice.id); await load(); }
    catch (err: any) { alert(err.message); }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>
          Invoice {invoice.invoice_number || '(draft)'}
          <span style={{ marginLeft: 12, background: b.bg, color: b.fg, padding: '4px 10px', borderRadius: 4, fontSize: 13, fontWeight: 500, textTransform: 'capitalize' }}>{invoice.status}</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/sales" className="btn btn-link">← Sales Invoices</Link>
          {isEditable && <button className="btn btn-secondary" onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>}
          {invoice.status === 'draft' && <button className="btn btn-primary" onClick={issue} disabled={saving}>📨 Issue</button>}
          {invoice.status === 'issued' && <button className="btn btn-primary" onClick={markPaid}>✓ Mark paid</button>}
          <button className="btn btn-secondary" onClick={async () => { if (isEditable) { try { await save({ silent: true }); } catch { return; } } window.open(`/sales/${invoice.id}/print`, '_blank'); }}>🖨 {invoice.status === 'draft' ? 'Preview' : 'Print'}</button>
          {invoice.status === 'paid' && <button className="btn btn-secondary" onClick={printReceipt}>🧾 Receipt</button>}
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && <button className="btn btn-danger" onClick={cancel}>Cancel</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
        <div>
          <div className="form-section">
            <h3>Invoice details</h3>
            <div className="form-grid">
              <div className="form-group full-width">
                <label>Customer</label>
                <div className="form-input" style={{ background: '#f8fafc' }}>{c.name || '—'}</div>
              </div>
              <div className="form-group">
                <label>Issue date</label>
                <input type="date" className="form-input" value={invoice.issue_date || ''} onChange={e => patch({ issue_date: e.target.value })} disabled={!isEditable} />
              </div>
              <div className="form-group">
                <label>Due date</label>
                <input type="date" className="form-input" value={invoice.due_date || ''} onChange={e => patch({ due_date: e.target.value })} disabled={!isEditable} />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Line items</h3>
              {isEditable && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => addLine('fixed')}>+ Fee line</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => addLine('expense')}>+ Expense</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => addLine('remarks')}>+ Remarks</button>
                </div>
              )}
            </div>
            {lines.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 12 }}><p>No lines yet.</p></div>
            ) : (
              <div className="export-table-wrapper" style={{ marginTop: 12 }}>
                <table className="export-table">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Type</th><th>Description</th>
                      <th style={{ width: 70, textAlign: 'right' }}>Qty</th>
                      <th style={{ width: 90, textAlign: 'right' }}>Unit price</th>
                      <th style={{ width: 100, textAlign: 'right' }}>Amount</th>
                      <th style={{ width: 60, textAlign: 'center' }}>VAT</th>
                      {isEditable && <th style={{ width: 30 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => {
                      const isRemarks = l.line_type === 'remarks';
                      return (
                        <tr key={l.id || `new-${idx}`}>
                          <td style={{ fontSize: 12, textTransform: 'capitalize' }}>{l.line_type}</td>
                          <td>{isEditable
                            ? <input type="text" className="form-input" style={{ width: '100%' }} value={l.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                            : l.description}</td>
                          <td style={{ textAlign: 'right' }}>{isRemarks ? '—' : isEditable
                            ? <input type="number" step="0.01" className="form-input" style={{ width: 70, textAlign: 'right' }} value={l.quantity} onChange={e => { const q = Number(e.target.value || 0); updateLine(idx, { quantity: q, amount: round2(q * Number(l.unit_price || 0)) }); }} />
                            : Number(l.quantity).toFixed(2)}</td>
                          <td style={{ textAlign: 'right' }}>{isRemarks ? '—' : isEditable
                            ? <input type="number" step="0.01" className="form-input" style={{ width: 90, textAlign: 'right' }} value={l.unit_price} onChange={e => { const p = Number(e.target.value || 0); updateLine(idx, { unit_price: p, amount: round2(Number(l.quantity || 0) * p) }); }} />
                            : `€${Number(l.unit_price).toFixed(2)}`}</td>
                          <td style={{ textAlign: 'right' }}>{isRemarks ? '—' : isEditable
                            ? <input type="number" step="0.01" className="form-input" style={{ width: 100, textAlign: 'right' }} value={l.amount} onChange={e => updateLine(idx, { amount: Number(e.target.value || 0) })} />
                            : `€${Number(l.amount).toFixed(2)}`}</td>
                          <td style={{ textAlign: 'center' }}>{isRemarks ? '—' : isEditable
                            ? <select className="form-input" style={{ width: 76 }} value={l.vat_rate} onChange={e => { const r = Number(e.target.value); updateLine(idx, { vat_rate: r, vatable: r > 0 }); }}>
                                <option value={0}>0%</option><option value={5}>5%</option><option value={9}>9%</option><option value={19}>19%</option>
                              </select>
                            : `${Number(l.vat_rate || 0).toFixed(0)}%`}</td>
                          {isEditable && <td><button className="btn btn-danger btn-sm" onClick={() => removeLine(idx)}>×</button></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="form-section">
            <h3>Notes</h3>
            <textarea className="form-input" rows={3} value={invoice.notes || ''} onChange={e => patch({ notes: e.target.value })} disabled={!isEditable} placeholder="Notes / payment terms shown on the invoice." />
          </div>
        </div>

        <div style={{ position: 'sticky', top: 16 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Totals</h3>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                <tr><td style={{ color: '#475569', padding: '4px 0' }}>Vatable subtotal</td><td style={{ textAlign: 'right' }}>€{totals.subtotal_vatable.toFixed(2)}</td></tr>
                <tr><td style={{ color: '#475569', padding: '4px 0' }}>Expenses (no VAT)</td><td style={{ textAlign: 'right' }}>€{totals.subtotal_nonvatable.toFixed(2)}</td></tr>
                <tr><td style={{ color: '#475569', padding: '4px 0' }}>Discount</td><td style={{ textAlign: 'right', color: '#b91c1c' }}>-€{totals.discount_amount.toFixed(2)}</td></tr>
                <tr><td style={{ color: '#475569', padding: '4px 0' }}>VAT</td><td style={{ textAlign: 'right' }}>€{totals.vat_amount.toFixed(2)}</td></tr>
                <tr style={{ borderTop: '1px solid var(--border)' }}><td style={{ fontWeight: 600, padding: '8px 0' }}>Total</td><td style={{ textAlign: 'right', fontWeight: 700, fontSize: 16 }}>€{totals.total_amount.toFixed(2)}</td></tr>
              </tbody>
            </table>
            {isEditable && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>Discount</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select className="form-input" style={{ flex: 1 }} value={invoice.discount_type || ''} onChange={e => patch({ discount_type: e.target.value || null })}>
                    <option value="">None</option><option value="percent">Percent</option><option value="amount">Amount (€)</option>
                  </select>
                  <input type="number" step="0.01" min="0" className="form-input" style={{ width: 90 }} value={invoice.discount_value ?? ''} onChange={e => patch({ discount_value: e.target.value === '' ? null : Number(e.target.value) })} disabled={!invoice.discount_type} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={payOpen}
        onClose={() => { if (!paying) setPayOpen(false); }}
        title="Mark invoice paid"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayOpen(false)} disabled={paying}>Cancel</Button>
            <Button variant="primary" onClick={confirmPaid} disabled={paying}>{paying ? 'Saving…' : 'Mark paid & issue receipt'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group">
            <label>Paid on</label>
            <input type="date" className="form-input" value={payDate} onChange={e => setPayDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Payment method</label>
            <select className="form-input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
              <option>Bank Transfer</option><option>Cash</option><option>Cheque</option><option>Card</option><option>Other</option>
            </select>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>A numbered receipt for the invoice total will be created.</p>
        </div>
      </Modal>
    </div>
  );
}
