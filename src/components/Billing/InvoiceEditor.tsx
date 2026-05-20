import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button } from '../ui';
import EmailDocumentModal from './EmailDocumentModal';

type LineType = 'time' | 'fixed' | 'expense';
type Status   = 'draft' | 'issued' | 'paid' | 'cancelled';

type Line = {
  id?: number;            // undefined for unsaved
  invoice_id: number;
  line_no: number;
  line_type: LineType;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  vatable: boolean;
  vat_rate: number;
  time_entry_id: number | null;
  _dirty?: boolean;       // tracks local edits not yet persisted
  _new?: boolean;
};

type Invoice = {
  id: number;
  client_id: number;
  client: any;
  invoice_number: string | null;
  status: Status;
  issue_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  vat_rate: number;
  discount_type: 'percent' | 'amount' | null;
  discount_value: number | null;
  subtotal_vatable: number;
  subtotal_nonvatable: number;
  discount_amount: number;
  vat_amount: number;
  total_amount: number;
  billing_address: string | null;
  notes: string | null;
  lines: Line[];
};

const STATUS_BADGE: Record<Status, { bg: string; fg: string; label: string }> = {
  draft:     { bg: '#f1f5f9', fg: '#475569', label: 'Draft' },
  issued:    { bg: '#dbeafe', fg: '#1e40af', label: 'Issued' },
  paid:      { bg: '#dcfce7', fg: '#166534', label: 'Paid' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b', label: 'Cancelled' },
};

// Compute invoice totals from line list. Each line carries its own VAT rate
// (so a single invoice can mix 0/5/9/19%). Discount applies to vatable lines
// only (firm-side services); non-vatable lines (typically out-of-pocket
// expenses) pass through at face value. The discount is allocated pro-rata
// across the vatable lines before VAT is calculated per line.
function computeTotals(
  lines: Line[],
  discount_type: 'percent' | 'amount' | null,
  discount_value: number | null,
) {
  const subtotal_vatable    = lines.filter(l => l.vatable).reduce((s, l) => s + Number(l.amount || 0), 0);
  const subtotal_nonvatable = lines.filter(l => !l.vatable).reduce((s, l) => s + Number(l.amount || 0), 0);
  let discount_amount = 0;
  if (discount_type === 'percent' && discount_value && discount_value > 0) {
    discount_amount = subtotal_vatable * (discount_value / 100);
  } else if (discount_type === 'amount' && discount_value && discount_value > 0) {
    discount_amount = Math.min(discount_value, subtotal_vatable);
  }
  let vat_amount = 0;
  for (const l of lines) {
    if (!l.vatable) continue;
    const amt   = Number(l.amount || 0);
    const rate  = Number(l.vat_rate || 0);
    const share = subtotal_vatable > 0 ? amt / subtotal_vatable : 0;
    const net   = Math.max(0, amt - share * discount_amount);
    vat_amount += net * rate / 100;
  }
  const total = Math.max(0, subtotal_vatable - discount_amount) + vat_amount + subtotal_nonvatable;
  return {
    subtotal_vatable: round2(subtotal_vatable),
    subtotal_nonvatable: round2(subtotal_nonvatable),
    discount_amount: round2(discount_amount),
    vat_amount: round2(vat_amount),
    total_amount: round2(total),
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

const formatBillingAddress = (c: any) =>
  [
    c.address,
    [c.postal_code, c.city].filter(Boolean).join(' '),
    c.country,
    c.vat_number ? `VAT: ${c.vat_number}` : null,
    c.phone ? `Tel: ${c.phone}` : null,
    c.email ? `Email: ${c.email}` : null,
  ].filter(Boolean).join('\n');

export default function InvoiceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { clients } = useApp();
  const { user } = useAuth();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lines, setLines]     = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [eligibleEntries, setEligibleEntries] = useState<any[]>([]);
  const [showAddTime, setShowAddTime] = useState(false);
  const [selectedEntries, setSelectedEntries] = useState<Set<number>>(new Set());

  const isLeadership = user?.role === 'owner' || user?.role === 'supervisor';
  const isDraft = invoice?.status === 'draft';
  const isEditable = isDraft || (isLeadership && invoice?.status === 'issued');

  const load = async () => {
    if (!id) return;
    try {
      const data = await api.getClientInvoice(Number(id));
      setInvoice(data as Invoice);
      setLines((data.lines || []).map((l: any) => ({ ...l })));
    } catch (err: any) {
      alert('Failed to load invoice: ' + err.message);
      navigate('/billing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Load approved + unbilled time entries for this client so the user can add
  // them to the draft. Refreshes when invoice loads.
  useEffect(() => {
    if (!invoice) return;
    (async () => {
      try {
        const data = await api.getTimeEntries({
          client_id: invoice.client_id,
          approval_status: 'approved',
          billing_status: 'unbilled',
        });
        // Exclude entries already pinned to another invoice
        const filtered = (data as any[]).filter(e => !e.invoice_id || e.invoice_id === invoice.id);
        setEligibleEntries(filtered);
      } catch {}
    })();
  }, [invoice]);

  // Live-computed totals from current line state — what the user sees in the
  // sidebar matches what gets saved.
  const liveTotals = useMemo(() => {
    if (!invoice) return null;
    return computeTotals(lines, invoice.discount_type, invoice.discount_value);
  }, [lines, invoice]);

  // ---------- mutations ----------

  const patchInvoice = (patch: Partial<Invoice>) => {
    if (!invoice) return;
    setInvoice({ ...invoice, ...patch });
  };

  const addLine = (line: Omit<Line, 'invoice_id' | 'line_no'>) => {
    if (!invoice) return;
    const maxNo = lines.reduce((m, l) => Math.max(m, l.line_no), 0);
    setLines([...lines, {
      ...line,
      invoice_id: invoice.id,
      line_no: maxNo + 1,
      _dirty: true,
      _new: true,
    }]);
  };

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch, _dirty: true } : l));
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  // ---------- save ----------

  const handleSave = async (options?: { silent?: boolean }) => {
    if (!invoice) return;
    setSaving(true);
    try {
      const totals = computeTotals(lines, invoice.discount_type, invoice.discount_value);
      // 1. Update header
      await api.updateClientInvoice(invoice.id, {
        issue_date:     invoice.issue_date || null,
        due_date:       invoice.due_date || null,
        vat_rate:       invoice.vat_rate,
        discount_type:  invoice.discount_type,
        discount_value: invoice.discount_value,
        notes:          invoice.notes || null,
        billing_address: invoice.billing_address || null,
        ...totals,
      });

      // 2. Delete lines that were removed
      const originalIds = new Set((invoice.lines || []).map((l: any) => l.id));
      const currentIds  = new Set(lines.filter(l => l.id).map(l => l.id!));
      for (const id of originalIds) {
        if (!currentIds.has(id)) await api.deleteInvoiceLine(id as number);
      }

      // 3. Insert new lines + update existing dirty ones
      for (const l of lines) {
        if (l._new) {
          await api.addInvoiceLine(invoice.id, {
            line_no: l.line_no,
            line_type: l.line_type,
            description: l.description,
            quantity: Number(l.quantity || 0),
            unit_price: Number(l.unit_price || 0),
            amount: Number(l.amount || 0),
            vatable: l.vatable,
            vat_rate: Number(l.vat_rate || 0),
            time_entry_id: l.time_entry_id,
          });
        } else if (l._dirty && l.id) {
          await api.updateInvoiceLine(l.id, {
            line_no:     l.line_no,
            line_type:   l.line_type,
            description: l.description,
            quantity:    Number(l.quantity || 0),
            unit_price:  Number(l.unit_price || 0),
            amount:      Number(l.amount || 0),
            vatable:     l.vatable,
            vat_rate:    Number(l.vat_rate || 0),
            time_entry_id: l.time_entry_id,
          });
        }
      }
      await load();
      if (!options?.silent) alert('Saved.');
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleIssue = async () => {
    if (!invoice) return;
    if (!confirm('Issue this invoice? An invoice number will be assigned and edits will be locked except for leadership.')) return;
    try {
      await handleSave({ silent: true });   // ensure latest state is persisted
      const num = await api.issueClientInvoice(invoice.id);
      alert(`Issued as ${num}.`);
      await load();
    } catch (err: any) {
      alert('Issue failed: ' + err.message);
    }
  };

  const handleCancel = async () => {
    if (!invoice) return;
    if (!confirm('Cancel this invoice? Linked time entries will be released back to unbilled.')) return;
    try {
      await api.cancelClientInvoice(invoice.id);
      await load();
    } catch (err: any) {
      alert('Cancel failed: ' + err.message);
    }
  };

  // Service presets — catalogue of reusable line descriptions.
  const [servicePresets, setServicePresets] = useState<any[]>([]);
  useEffect(() => {
    api.getServicePresets({ activeOnly: true }).then(setServicePresets).catch(() => {});
  }, []);

  // When a line description matches a preset, pull in its price + VAT flag.
  const onDescChange = (idx: number, value: string) => {
    const preset = servicePresets.find(p => p.description === value);
    const patch: Partial<Line> = { description: value };
    if (preset) {
      patch.vatable  = preset.vatable;
      patch.vat_rate = preset.vatable ? Number(invoice?.vat_rate || 19) : 0;
      if (preset.default_price != null && !Number(lines[idx]?.unit_price)) {
        const q = Number(lines[idx]?.quantity || 1);
        patch.unit_price = Number(preset.default_price);
        patch.amount = round2(q * Number(preset.default_price));
      }
    }
    updateLine(idx, patch);
  };

  // Email-document dialog config (invoice or its receipt).
  const [emailCfg, setEmailCfg] = useState<{
    routePath: string; fileName: string; defaultSubject: string; defaultMessage: string;
  } | null>(null);

  const handleEmailInvoice = () => {
    if (!invoice) return;
    const num  = invoice.invoice_number || `draft-${invoice.id}`;
    const name = invoice.client?.name || 'Sir/Madam';
    setEmailCfg({
      routePath: `/billing/${invoice.id}/print`,
      fileName: `Invoice-${num}.pdf`,
      defaultSubject: `Invoice ${num}`,
      defaultMessage: `Dear ${name},\n\nPlease find attached invoice ${num}.\n\nKind regards`,
    });
  };

  const handleEmailReceipt = async () => {
    if (!invoice) return;
    try {
      const r = await api.getReceiptForInvoice(invoice.id);
      if (!r) { alert('No receipt found for this invoice.'); return; }
      const name = invoice.client?.name || 'Sir/Madam';
      setEmailCfg({
        routePath: `/billing/receipt/${r.id}/print`,
        fileName: `Receipt-${r.receipt_number}.pdf`,
        defaultSubject: `Receipt ${r.receipt_number}`,
        defaultMessage: `Dear ${name},\n\nPlease find attached receipt ${r.receipt_number}.\n\nKind regards`,
      });
    } catch (err: any) {
      alert('Could not load receipt: ' + err.message);
    }
  };

  // Mark-paid flow: a small dialog captures the payment date + method,
  // then mark_client_invoice_paid issues a numbered receipt server-side.
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payDate, setPayDate]           = useState('');
  const [payMethod, setPayMethod]       = useState('Bank Transfer');
  const [paying, setPaying]             = useState(false);

  const handleMarkPaid = () => {
    if (!invoice) return;
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod('Bank Transfer');
    setPayModalOpen(true);
  };

  const confirmMarkPaid = async () => {
    if (!invoice) return;
    setPaying(true);
    try {
      await api.markClientInvoicePaid(invoice.id, payDate || undefined, payMethod);
      setPayModalOpen(false);
      await load();
    } catch (err: any) {
      alert('Mark paid failed: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const handlePrintReceipt = async () => {
    if (!invoice) return;
    try {
      const r = await api.getReceiptForInvoice(invoice.id);
      if (!r) { alert('No receipt found for this invoice.'); return; }
      window.open(`/billing/receipt/${r.id}/print`, '_blank');
    } catch (err: any) {
      alert('Could not open receipt: ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    if (!confirm('Delete this draft? Linked time entries will be released back to unbilled.')) return;
    try {
      await api.deleteClientInvoice(invoice.id);
      navigate('/billing');
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const addSelectedTimeEntries = () => {
    if (!invoice) return;
    const ids = Array.from(selectedEntries);
    const toAdd = eligibleEntries.filter(e => ids.includes(e.id));
    if (toAdd.length === 0) return;
    const maxNo = lines.reduce((m, l) => Math.max(m, l.line_no), 0);
    const newLines: Line[] = toAdd.map((e, i) => {
      const hours = Number(e.minutes) / 60;
      const rate  = Number(e.rate_snapshot || 0);
      const amt   = round2(hours * rate);
      const desc  = `${e.entry_date} · ${e.service}${e.description ? ' · ' + e.description : ''}`;
      return {
        invoice_id: invoice.id,
        line_no: maxNo + i + 1,
        line_type: 'time',
        description: desc,
        quantity: round2(hours),
        unit_price: round2(rate),
        amount: amt,
        vatable: true,
        vat_rate: Number(invoice.vat_rate || 19),
        time_entry_id: e.id,
        _dirty: true, _new: true,
      };
    });
    setLines([...lines, ...newLines]);
    setSelectedEntries(new Set());
    setShowAddTime(false);
  };

  // ---------- render ----------

  if (loading || !invoice) return <div className="loading-screen">Loading…</div>;

  const c = invoice.client || {};
  const b = STATUS_BADGE[invoice.status];

  return (
    <div className="dashboard">
      {/* Toolbar */}
      <div className="dashboard-header" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Link to="/billing" className="btn btn-link" style={{ padding: 0 }}>← Back to invoices</Link>
          <h2 style={{ margin: '4px 0 0' }}>
            {invoice.invoice_number || 'Draft Invoice'}
            <span style={{
              marginLeft: 12, background: b.bg, color: b.fg,
              padding: '4px 10px', borderRadius: 4, fontSize: 13, fontWeight: 500,
            }}>{b.label}</span>
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isEditable && (
            <button className="btn btn-secondary" onClick={() => handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          )}
          {isDraft && (
            <button className="btn btn-primary" onClick={handleIssue} disabled={saving || lines.length === 0}>
              📨 Issue invoice
            </button>
          )}
          {invoice.status === 'issued' && (
            <button className="btn btn-primary" onClick={handleMarkPaid}>
              ✓ Mark paid
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={async () => {
              // Save first so the preview shows the on-screen state, not whatever
              // was last persisted. For non-draft invoices the save is a no-op
              // since the editor disables the inputs anyway.
              if (isEditable) {
                try { await handleSave({ silent: true }); } catch { /* handleSave already alerted */ }
              }
              window.open(`/billing/${invoice.id}/print`, '_blank');
            }}
          >
            🖨 {isDraft ? 'Preview' : 'Print'}
          </button>
          {(invoice.status === 'issued' || invoice.status === 'paid') && (
            <button className="btn btn-secondary" onClick={handleEmailInvoice}>
              ✉ Email invoice
            </button>
          )}
          {isDraft && (
            <button className="btn btn-danger" onClick={handleDelete}>Delete draft</button>
          )}
          {isLeadership && invoice.status === 'issued' && (
            <button className="btn btn-danger" onClick={handleCancel}>Cancel invoice</button>
          )}
        </div>
      </div>

      {/* Two-column layout: form + sidebar totals */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
        <div>
          {/* Header form */}
          <div className="form-section">
            <h3>Invoice details</h3>
            <div className="form-grid">
              <div className="form-group full-width">
                <label>Client</label>
                <div className="form-input" style={{ background: '#f8fafc' }}>
                  {c.client_code && <span style={{ color: '#64748b' }}>{c.client_code} — </span>}
                  {c.name || '—'}
                </div>
              </div>
              <div className="form-group">
                <label>Issue date</label>
                <input type="date" className="form-input"
                  value={invoice.issue_date || ''}
                  onChange={e => patchInvoice({ issue_date: e.target.value })}
                  disabled={!isEditable}
                />
              </div>
              <div className="form-group">
                <label>Due date</label>
                <input type="date" className="form-input"
                  value={invoice.due_date || ''}
                  onChange={e => patchInvoice({ due_date: e.target.value })}
                  disabled={!isEditable}
                />
              </div>
              <div className="form-group full-width">
                <label>Bill-to details (snapshot)</label>
                <textarea className="form-input" rows={2}
                  value={invoice.billing_address || ''}
                  onChange={e => patchInvoice({ billing_address: e.target.value })}
                  disabled={!isEditable}
                  placeholder={formatBillingAddress(c) || 'Enter bill-to address, phone, and email'}
                />
                {!invoice.billing_address && isEditable && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm"
                    style={{ marginTop: 4 }}
                    onClick={() => patchInvoice({ billing_address: formatBillingAddress(c) })}
                  >Use client details</button>
                )}
              </div>
            </div>
          </div>

          {/* Lines */}
          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Line items</h3>
              {isEditable && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowAddTime(o => !o)}
                  >
                    + Add time entries ({eligibleEntries.length})
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => addLine({
                      line_type: 'fixed', description: '', quantity: 1, unit_price: 0, amount: 0,
                      vatable: true, vat_rate: Number(invoice.vat_rate || 19), time_entry_id: null,
                    })}
                  >+ Fixed fee line</button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => addLine({
                      line_type: 'expense', description: '', quantity: 1, unit_price: 0, amount: 0,
                      vatable: false, vat_rate: 0, time_entry_id: null,
                    })}
                  >+ Expense line</button>
                </div>
              )}
            </div>

            {/* Eligible time entries picker */}
            {showAddTime && isEditable && (
              <div className="card" style={{ marginTop: 12 }}>
                {eligibleEntries.length === 0 ? (
                  <p style={{ margin: 0, color: '#475569' }}>
                    No approved + unbilled time entries for this client.
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: '#475569', margin: '0 0 8px' }}>
                      Tick entries to add as line items. Quantity = hours, unit price = rate snapshot.
                    </p>
                    <table className="export-table">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Date</th>
                          <th>Service</th>
                          <th>Description</th>
                          <th style={{ textAlign: 'right' }}>Hours</th>
                          <th style={{ textAlign: 'right' }}>Rate</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eligibleEntries.map(e => {
                          const hours = Number(e.minutes) / 60;
                          const amt = hours * Number(e.rate_snapshot || 0);
                          return (
                            <tr key={e.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedEntries.has(e.id)}
                                  onChange={() => setSelectedEntries(prev => {
                                    const next = new Set(prev);
                                    if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                                    return next;
                                  })}
                                />
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                              <td>{e.service}</td>
                              <td>{e.description || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{hours.toFixed(2)}h</td>
                              <td style={{ textAlign: 'right' }}>€{Number(e.rate_snapshot || 0).toFixed(2)}</td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{amt.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={addSelectedTimeEntries} disabled={selectedEntries.size === 0}>
                        Add {selectedEntries.size} as line{selectedEntries.size === 1 ? '' : 's'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowAddTime(false)}>Close</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {lines.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 12 }}>
                <p>No lines yet. Add time entries, a fixed fee, or an expense.</p>
              </div>
            ) : (
              <div className="export-table-wrapper" style={{ marginTop: 12 }}>
                <datalist id="invoice-service-presets">
                  {servicePresets.map((p, i) => <option key={i} value={p.description} />)}
                </datalist>
                <table className="export-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Type</th>
                      <th>Description</th>
                      <th style={{ width: 80, textAlign: 'right' }}>Qty</th>
                      <th style={{ width: 100, textAlign: 'right' }}>Unit price</th>
                      <th style={{ width: 110, textAlign: 'right' }}>Amount</th>
                      <th style={{ width: 70, textAlign: 'center' }}>VAT</th>
                      {isEditable && <th style={{ width: 30 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={l.id || `new-${idx}`}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12, textTransform: 'capitalize' }}>{l.line_type}</td>
                        <td>
                          {isEditable ? (
                            <input type="text" className="form-input" value={l.description}
                              list="invoice-service-presets"
                              onChange={e => onDescChange(idx, e.target.value)}
                            />
                          ) : l.description}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isEditable ? (
                            <input type="number" step="0.01" className="form-input" style={{ width: 70, textAlign: 'right' }}
                              value={l.quantity}
                              onChange={e => {
                                const q = Number(e.target.value || 0);
                                updateLine(idx, { quantity: q, amount: round2(q * Number(l.unit_price || 0)) });
                              }}
                            />
                          ) : Number(l.quantity).toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isEditable ? (
                            <input type="number" step="0.01" className="form-input" style={{ width: 90, textAlign: 'right' }}
                              value={l.unit_price}
                              onChange={e => {
                                const p = Number(e.target.value || 0);
                                updateLine(idx, { unit_price: p, amount: round2(Number(l.quantity || 0) * p) });
                              }}
                            />
                          ) : `€${Number(l.unit_price).toFixed(2)}`}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isEditable ? (
                            <input type="number" step="0.01" className="form-input" style={{ width: 100, textAlign: 'right' }}
                              value={l.amount}
                              onChange={e => updateLine(idx, { amount: Number(e.target.value || 0) })}
                            />
                          ) : `€${Number(l.amount).toFixed(2)}`}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {isEditable ? (
                            <select
                              className="form-input" style={{ width: 76 }}
                              value={l.vat_rate}
                              onChange={e => {
                                const r = Number(e.target.value);
                                updateLine(idx, { vat_rate: r, vatable: r > 0 });
                              }}
                            >
                              <option value={0}>0%</option>
                              <option value={5}>5%</option>
                              <option value={9}>9%</option>
                              <option value={19}>19%</option>
                            </select>
                          ) : `${Number(l.vat_rate || 0).toFixed(0)}%`}
                        </td>
                        {isEditable && (
                          <td>
                            <button className="btn btn-danger btn-sm" onClick={() => removeLine(idx)}>×</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="form-section">
            <h3>Notes</h3>
            <textarea
              className="form-input"
              rows={3}
              value={invoice.notes || ''}
              onChange={e => patchInvoice({ notes: e.target.value })}
              disabled={!isEditable}
              placeholder="Internal notes or payment terms shown on the invoice."
            />
          </div>
        </div>

        {/* Totals sidebar */}
        <div style={{ position: 'sticky', top: 16 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Totals</h3>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                <tr>
                  <td style={{ color: '#475569', padding: '4px 0' }}>Vatable subtotal</td>
                  <td style={{ textAlign: 'right', padding: '4px 0' }}>€{liveTotals?.subtotal_vatable.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style={{ color: '#475569', padding: '4px 0' }}>Expenses (no VAT)</td>
                  <td style={{ textAlign: 'right', padding: '4px 0' }}>€{liveTotals?.subtotal_nonvatable.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style={{ color: '#475569', padding: '4px 0' }}>Discount</td>
                  <td style={{ textAlign: 'right', padding: '4px 0', color: '#b91c1c' }}>-€{liveTotals?.discount_amount.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style={{ color: '#475569', padding: '4px 0' }}>VAT</td>
                  <td style={{ textAlign: 'right', padding: '4px 0' }}>€{liveTotals?.vat_amount.toFixed(2)}</td>
                </tr>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ fontWeight: 600, padding: '8px 0' }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, padding: '8px 0' }}>€{liveTotals?.total_amount.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            {isEditable && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                  <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>Discount</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select
                      className="form-input" style={{ flex: 1 }}
                      value={invoice.discount_type || ''}
                      onChange={e => patchInvoice({ discount_type: (e.target.value || null) as any })}
                    >
                      <option value="">None</option>
                      <option value="percent">Percent</option>
                      <option value="amount">Amount (€)</option>
                    </select>
                    <input
                      type="number" step="0.01" min="0"
                      className="form-input" style={{ width: 90 }}
                      value={invoice.discount_value ?? ''}
                      onChange={e => patchInvoice({ discount_value: e.target.value === '' ? null : Number(e.target.value) })}
                      disabled={!invoice.discount_type}
                      placeholder={invoice.discount_type === 'percent' ? '%' : '€'}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {invoice.status === 'paid' && invoice.paid_date && (
            <div className="card" style={{ marginTop: 12, background: '#dcfce7', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span><strong>Paid on:</strong> {invoice.paid_date}</span>
              <button className="btn btn-secondary btn-sm" onClick={handlePrintReceipt}>🧾 Print Receipt</button>
              <button className="btn btn-secondary btn-sm" onClick={handleEmailReceipt}>✉ Email Receipt</button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={payModalOpen}
        onClose={() => { if (!paying) setPayModalOpen(false); }}
        title="Mark invoice paid"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayModalOpen(false)} disabled={paying}>Cancel</Button>
            <Button variant="primary" onClick={confirmMarkPaid} disabled={paying}>
              {paying ? 'Saving…' : 'Mark paid & issue receipt'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group">
            <label>Paid on</label>
            <input
              type="date" className="form-input"
              value={payDate} onChange={e => setPayDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Payment method</label>
            <select className="form-input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
              <option>Bank Transfer</option>
              <option>Cash</option>
              <option>Cheque</option>
              <option>Card</option>
              <option>Other</option>
            </select>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
            A numbered receipt for the full invoice total will be created automatically.
          </p>
        </div>
      </Modal>

      <EmailDocumentModal
        open={!!emailCfg}
        onClose={() => setEmailCfg(null)}
        routePath={emailCfg?.routePath || ''}
        fileName={emailCfg?.fileName || 'document.pdf'}
        defaultTo={invoice.client?.email || ''}
        defaultSubject={emailCfg?.defaultSubject || ''}
        defaultMessage={emailCfg?.defaultMessage || ''}
      />
    </div>
  );
}
