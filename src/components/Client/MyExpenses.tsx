import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getPdfPageCount, renderPdfPageToJpegBlob } from '../../services/ocr/pdfRenderer';

const EXPENSE_TYPES = ['Rent', 'Utilities', 'Stock / Purchases', 'Travel', 'Subscriptions', 'Professional fees', 'Office supplies', 'Equipment', 'Marketing', 'Bank charges', 'Other'];
const EMPTY = { vendor_name: '', expense_date: '', amount: '', vat_amount: '', currency: 'EUR', expense_type: '', project_code: '', notes: '' };

async function fileToImageParts(file: File): Promise<{ media_type: string; data: string }[]> {
  const toB64 = (blob: Blob) => new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob);
  });
  if (file.type === 'application/pdf') {
    const pages = await getPdfPageCount(file).catch(() => 1);
    const parts: { media_type: string; data: string }[] = [];
    for (let p = 1; p <= Math.min(pages, 3); p++) {
      try { parts.push({ media_type: 'image/jpeg', data: await toB64(await renderPdfPageToJpegBlob(file, p)) }); } catch { /* skip */ }
    }
    return parts;
  }
  return [{ media_type: file.type || 'image/jpeg', data: await toB64(file) }];
}

const fmtDate = (iso: string | null) => iso || '—';
const statusBadge = (s: string) => ({
  submitted: { bg: '#fef9c3', fg: '#854d0e' }, allocated: { bg: '#dcfce7', fg: '#166534' }, rejected: { bg: '#fee2e2', fg: '#991b1b' },
}[s] || { bg: '#f1f5f9', fg: '#475569' });

// Client uploads/scans their expenses; AI pre-fills; they tag type + project
// and submit for the firm to allocate.
export default function MyExpenses() {
  const { user } = useAuth();
  const owner = user?.client_id;
  const [file, setFile]           = useState<File | null>(null);
  const [scanning, setScanning]   = useState(false);
  const [form, setForm]           = useState<any>({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  const load = async () => {
    if (!owner) { setLoading(false); return; }
    setLoading(true);
    try { setRows(await api.getMyExpenses(owner)); }
    catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [owner]);

  const f = (k: string, v: any) => setForm((s: any) => ({ ...s, [k]: v }));

  const onFile = async (sel: File) => {
    setFile(sel);
    setScanning(true);
    try {
      const parts = await fileToImageParts(sel);
      const ai = await api.extractDocument(parts);
      setForm((s: any) => ({
        ...s,
        vendor_name:  ai.vendor_name || s.vendor_name,
        expense_date: ai.invoice_date || s.expense_date,
        amount:       ai.total_amount != null ? String(ai.total_amount) : s.amount,
        vat_amount:   ai.vat_amount != null ? String(ai.vat_amount) : s.vat_amount,
        currency:     ai.currency || s.currency,
      }));
    } catch (err) {
      console.warn('AI extraction unavailable, fill manually:', err);
    } finally { setScanning(false); }
  };

  const submit = async () => {
    if (!owner) return;
    if (!file) { alert('Attach the expense document (file or photo).'); return; }
    if (!form.expense_type) { alert('Choose an expense type.'); return; }
    setSubmitting(true);
    try {
      const path = await api.uploadExpenseFile(owner, file);
      await api.createClientExpense({
        owner_client_id: owner, file_name: file.name, storage_path: path, mime_type: file.type,
        expense_type: form.expense_type, project_code: form.project_code || null,
        vendor_name: form.vendor_name || null, expense_date: form.expense_date || null,
        amount: form.amount ? Number(form.amount) : null, vat_amount: form.vat_amount ? Number(form.vat_amount) : null,
        currency: form.currency || null, notes: form.notes || null, status: 'submitted',
      });
      setFile(null); setForm({ ...EMPTY }); await load();
      alert('Expense submitted — your accountant will process it.');
    } catch (err: any) { alert('Submit failed: ' + err.message); }
    finally { setSubmitting(false); }
  };

  const viewFile = async (path: string) => {
    try { window.open(await api.expenseFileUrl(path), '_blank'); } catch (err: any) { alert(err.message); }
  };

  if (!owner) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>My Expenses</h2></div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Upload or photograph a purchase invoice/expense — we read it automatically. Tag the type and project, then submit for your accountant to process.
      </p>

      <datalist id="expense-types">{EXPENSE_TYPES.map(t => <option key={t} value={t} />)}</datalist>

      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div className="form-group">
          <label>Document {scanning && <span style={{ color: '#1e40af', fontSize: 12 }}>· reading…</span>}</label>
          <input type="file" accept="image/*,application/pdf" className="form-input"
            onChange={e => { const sel = e.target.files?.[0]; if (sel) onFile(sel); }} />
          {file && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{file.name}</div>}
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label>Expense type *</label>
            <input className="form-input" list="expense-types" value={form.expense_type} onChange={e => f('expense_type', e.target.value)} placeholder="e.g. Utilities" />
          </div>
          <div className="form-group">
            <label>Project code</label>
            <input className="form-input" value={form.project_code} onChange={e => f('project_code', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Supplier</label>
            <input className="form-input" value={form.vendor_name} onChange={e => f('vendor_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Date</label>
            <input type="date" className="form-input" value={form.expense_date} onChange={e => f('expense_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Amount</label>
            <input type="number" step="0.01" className="form-input" value={form.amount} onChange={e => f('amount', e.target.value)} />
          </div>
          <div className="form-group">
            <label>VAT</label>
            <input type="number" step="0.01" className="form-input" value={form.vat_amount} onChange={e => f('vat_amount', e.target.value)} />
          </div>
          <div className="form-group full-width">
            <label>Notes</label>
            <input className="form-input" value={form.notes} onChange={e => f('notes', e.target.value)} />
          </div>
        </div>
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || scanning}>{submitting ? 'Submitting…' : 'Submit expense'}</button>
        </div>
      </div>

      <h3 style={{ marginBottom: 8 }}>Submitted</h3>
      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No expenses submitted yet.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead><tr><th>Date</th><th>Supplier</th><th>Type</th><th>Project</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => {
                const b = statusBadge(r.status);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.expense_date)}</td>
                    <td>{r.vendor_name || '—'}</td>
                    <td>{r.expense_type || '—'}</td>
                    <td>{r.project_code || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.amount != null ? '€' + Number(r.amount).toFixed(2) : '—'}</td>
                    <td><span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{r.status}</span></td>
                    <td>{r.storage_path && <button className="btn btn-secondary btn-sm" onClick={() => viewFile(r.storage_path)}>View</button>}</td>
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
