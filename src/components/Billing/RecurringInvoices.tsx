import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal, Button } from '../ui';

// Accounting — billing module Phase A. A per-client recurring billing
// profile; "Generate drafts" turns the active profiles into draft
// client_invoices for a chosen month, which are then issued as normal.

type Line = { description: string; quantity: number; unit_price: number; vatable: boolean; vat_rate: number };

type Profile = {
  id: number;
  client_id: number;
  label: string | null;
  vat_rate: number;
  discount_type: string | null;
  discount_value: number | null;
  active: boolean;
  last_generated_month: string | null;
  notes: string | null;
  client?: { name: string; client_code: string | null } | null;
  lines?: any[];
};

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Mirrors generate_recurring_invoices() so the form preview matches what
// each monthly invoice will total.
const computeTotals = (lines: Line[], discType: string | null, discVal: number) => {
  let sv = 0, snv = 0;
  for (const l of lines) {
    const amt = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
    if (l.vatable) sv += amt; else snv += amt;
  }
  const disc = discType === 'percent' ? sv * (discVal || 0) / 100
             : discType === 'amount'  ? Math.min(discVal || 0, sv)
             : 0;
  let vat = 0;
  for (const l of lines) {
    if (!l.vatable) continue;
    const amt   = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
    const rate  = Number(l.vat_rate || 0);
    const share = sv > 0 ? amt / sv : 0;
    const net   = Math.max(0, amt - share * disc);
    vat += net * rate / 100;
  }
  return { sv, snv, disc, vat, total: sv - disc + snv + vat };
};

const EMPTY_FORM = {
  client_id: '', label: '', vat_rate: '19', discount_type: '', discount_value: '', active: true, notes: '',
};

export default function RecurringInvoices() {
  const { clients } = useApp();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [genMonth, setGenMonth] = useState(currentMonth());
  const [generating, setGenerating] = useState(false);

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [formLines, setFormLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setProfiles(await api.getRecurringInvoices() as Profile[]); }
    catch (err: any) { alert('Failed to load recurring invoices: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const clientName = (p: Profile) =>
    p.client ? `${p.client.client_code ? p.client.client_code + ' — ' : ''}${p.client.name}` : `#${p.client_id}`;

  const profileTotal = (p: Profile) => {
    const lines: Line[] = (p.lines || []).map((l: any) => ({
      description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price),
      vatable: l.vatable, vat_rate: Number(l.vat_rate || 0),
    }));
    return computeTotals(lines, p.discount_type, Number(p.discount_value) || 0).total;
  };

  const openNew = () => {
    setForm(EMPTY_FORM);
    setFormLines([{ description: '', quantity: 1, unit_price: 0, vatable: true, vat_rate: 19 }]);
    setEditingId('new');
  };
  const openEdit = (p: Profile) => {
    setForm({
      client_id: String(p.client_id), label: p.label || '', vat_rate: String(p.vat_rate),
      discount_type: p.discount_type || '',
      discount_value: p.discount_value != null ? String(p.discount_value) : '',
      active: p.active, notes: p.notes || '',
    });
    setFormLines([...(p.lines || [])]
      .sort((a: any, b: any) => a.line_no - b.line_no)
      .map((l: any) => ({
        description: l.description, quantity: Number(l.quantity),
        unit_price: Number(l.unit_price), vatable: l.vatable,
        vat_rate: Number(l.vat_rate || (l.vatable ? 19 : 0)),
      })));
    setEditingId(p.id);
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setFormLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setFormLines(prev => [...prev, { description: '', quantity: 1, unit_price: 0, vatable: true, vat_rate: 19 }]);
  const removeLine = (i: number) => setFormLines(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!form.client_id) { alert('Pick a client.'); return; }
    const cleanLines = formLines.filter(l => l.description.trim());
    if (cleanLines.length === 0) { alert('Add at least one line item.'); return; }
    setBusy(true);
    try {
      await api.saveRecurringInvoice(
        {
          id: typeof editingId === 'number' ? editingId : undefined,
          client_id: Number(form.client_id),
          label: form.label.trim() || null,
          vat_rate: Number(form.vat_rate) || 0,
          discount_type: form.discount_type || null,
          discount_value: form.discount_type ? (Number(form.discount_value) || 0) : null,
          active: form.active,
          notes: form.notes.trim() || null,
        },
        cleanLines.map((l, i) => ({
          line_no: i + 1, line_type: 'fixed', description: l.description.trim(),
          quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0,
          amount: (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
          vatable: l.vatable, vat_rate: Number(l.vat_rate || 0),
        })),
      );
      setEditingId(null);
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (p: Profile) => {
    if (!confirm(`Delete the recurring profile for ${clientName(p)}? Invoices already generated from it are not affected.`)) return;
    try { await api.deleteRecurringInvoice(p.id); await load(); }
    catch (err: any) { alert('Delete failed: ' + err.message); }
  };

  const handleGenerate = async () => {
    if (!/^\d{4}-\d{2}$/.test(genMonth)) { alert('Pick a month first.'); return; }
    if (!confirm(`Generate draft invoices for ${genMonth}?\n\nOne draft per active recurring profile not yet generated for that month.`)) return;
    setGenerating(true);
    try {
      const r = await api.generateRecurringInvoices(genMonth);
      alert(`${r.generated} draft invoice${r.generated === 1 ? '' : 's'} generated for ${genMonth}.\n\nReview and issue them from Client Invoices.`);
      await load();
    } catch (err: any) {
      alert('Generate failed: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const preview = useMemo(
    () => computeTotals(formLines, form.discount_type || null, Number(form.discount_value) || 0),
    [formLines, form.discount_type, form.discount_value],
  );

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Recurring Invoices</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to="/billing" className="btn btn-link">← Client Invoices</Link>
          <Button onClick={openNew}>+ New Recurring</Button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Generate invoices for</label>
          <input type="month" className="form-input" value={genMonth} onChange={e => setGenMonth(e.target.value)} />
        </div>
        <Button variant="primary" onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate drafts'}
        </Button>
        <p style={{ fontSize: 12, color: 'var(--pc-text-2)', margin: 0, flex: 1, minWidth: 220 }}>
          Creates one draft invoice per active profile. Safe to re-run — profiles already
          generated for the chosen month are skipped.
        </p>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : profiles.length === 0 ? (
        <div className="empty-state"><p>No recurring profiles yet. Use "+ New Recurring" to set one up.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Label</th>
                <th style={{ textAlign: 'right' }}>Monthly total</th>
                <th>Last generated</th>
                <th style={{ textAlign: 'center' }}>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                  <td>{clientName(p)}</td>
                  <td>{p.label || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{profileTotal(p).toFixed(2)}</td>
                  <td>{p.last_generated_month || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{p.active ? '✓' : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(p)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        title={editingId === 'new' ? 'New Recurring Invoice' : 'Edit Recurring Invoice'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Client *</label>
              <select className="form-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— Select —</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Label</label>
              <input type="text" className="form-input" value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Monthly bookkeeping" />
            </div>
            <div className="form-group">
              <label>Discount</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="form-input" value={form.discount_type}
                  onChange={e => setForm({ ...form, discount_type: e.target.value })} style={{ maxWidth: 110 }}>
                  <option value="">None</option>
                  <option value="percent">%</option>
                  <option value="amount">€</option>
                </select>
                <input type="number" step="0.01" className="form-input" value={form.discount_value}
                  disabled={!form.discount_type}
                  onChange={e => setForm({ ...form, discount_value: e.target.value })} />
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>Line items</strong>
              <Button size="sm" variant="secondary" onClick={addLine}>+ Add line</Button>
            </div>
            <table className="export-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Description</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 90 }}>Unit €</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 50, textAlign: 'center' }}>VAT</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {formLines.map((l, i) => (
                  <tr key={i}>
                    <td><input type="text" className="form-input" value={l.description} onChange={e => setLine(i, { description: e.target.value })} /></td>
                    <td><input type="number" step="0.001" className="form-input" value={l.quantity} onChange={e => setLine(i, { quantity: Number(e.target.value) })} /></td>
                    <td><input type="number" step="0.01" className="form-input" value={l.unit_price} onChange={e => setLine(i, { unit_price: Number(e.target.value) })} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>€{((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <select className="form-input" style={{ width: 76 }}
                        value={l.vat_rate}
                        onChange={e => {
                          const r = Number(e.target.value);
                          setLine(i, { vat_rate: r, vatable: r > 0 });
                        }}
                      >
                        <option value={0}>0%</option>
                        <option value={5}>5%</option>
                        <option value={9}>9%</option>
                        <option value={19}>19%</option>
                      </select>
                    </td>
                    <td><button type="button" className="btn btn-link btn-sm" onClick={() => removeLine(i)} title="Remove line">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: '#f8fafc', borderRadius: 6, padding: 10, fontSize: 13 }}>
            <div>Subtotal (vatable): €{preview.sv.toFixed(2)}</div>
            {preview.snv > 0 && <div>Subtotal (non-vatable): €{preview.snv.toFixed(2)}</div>}
            {preview.disc > 0 && <div>Discount: −€{preview.disc.toFixed(2)}</div>}
            <div>VAT: €{preview.vat.toFixed(2)}</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>Monthly total: €{preview.total.toFixed(2)}</div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            Active — included when generating monthly invoices
          </label>
        </div>
      </Modal>
    </div>
  );
}
