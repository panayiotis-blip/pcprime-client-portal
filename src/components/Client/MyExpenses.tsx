import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { fileToAiImageParts, MAX_OCR_PAGES } from '../../services/ocr/pdfRenderer';
import { formatDate } from '../../services/dates';

const EXPENSE_TYPES = ['Rent', 'Utilities', 'Stock / Purchases', 'Travel', 'Subscriptions', 'Professional fees', 'Office supplies', 'Equipment', 'Marketing', 'Bank charges', 'Other'];
const EMPTY = { vendor_name: '', expense_date: '', amount: '', vat_amount: '', currency: 'EUR', expense_type: '', project_code: '', notes: '' };

const fmtDate = (iso: string | null) => formatDate(iso, '—');
const fromExpense = (r: any) => ({
  vendor_name: r.vendor_name || '', expense_date: r.expense_date || '',
  amount: r.amount != null ? String(r.amount) : '', vat_amount: r.vat_amount != null ? String(r.vat_amount) : '',
  currency: r.currency || 'EUR', expense_type: r.expense_type || '', project_code: r.project_code || '', notes: r.notes || '',
});
const statusBadge = (s: string) => ({
  submitted: { bg: '#fef9c3', fg: '#854d0e' }, allocated: { bg: '#dcfce7', fg: '#166534' }, rejected: { bg: '#fee2e2', fg: '#991b1b' },
}[s] || { bg: '#f1f5f9', fg: '#475569' });

// Client expense capture — split-screen (document left, details right). New
// uploads are AI-prefilled; submitted (not-yet-actioned) expenses stay
// editable until the firm allocates or rejects them.
export default function MyExpenses() {
  const { user } = useAuth();
  const owner = user?.client_id;
  const [file, setFile]             = useState<File | null>(null);
  const [editing, setEditing]       = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [scanning, setScanning]     = useState(false);
  const [form, setForm]             = useState<any>({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows]             = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);

  const load = async () => {
    if (!owner) { setLoading(false); return; }
    setLoading(true);
    try { setRows(await api.getMyExpenses(owner)); }
    catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [owner]);
  useEffect(() => () => { if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const f = (k: string, v: any) => setForm((s: any) => ({ ...s, [k]: v }));

  const reset = () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setFile(null); setEditing(null); setPreviewUrl(''); setForm({ ...EMPTY });
  };

  const onFile = async (sel: File) => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setEditing(null); setFile(sel); setPreviewUrl(URL.createObjectURL(sel)); setForm({ ...EMPTY });
    setScanning(true);
    try {
      const img = await fileToAiImageParts(sel);
      if (img.truncated) alert(`This PDF has ${img.totalPages} pages — only the first ${MAX_OCR_PAGES} were read. Check the details below.`);
      const ai = await api.extractDocument(img.parts);
      setForm((s: any) => ({
        ...s,
        vendor_name:  ai.vendor_name || '',
        expense_date: ai.invoice_date || '',
        amount:       ai.total_amount != null ? String(ai.total_amount) : '',
        vat_amount:   ai.vat_amount != null ? String(ai.vat_amount) : '',
        currency:     ai.currency || 'EUR',
      }));
    } catch (err) {
      console.warn('AI extraction unavailable, fill manually:', err);
    } finally { setScanning(false); }
  };

  const startEdit = async (r: any) => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setFile(null); setEditing(r); setForm(fromExpense(r)); setPreviewUrl('');
    try { setPreviewUrl(await api.expenseFileUrl(r.storage_path)); } catch { /* preview optional */ }
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    if (!owner || (!file && !editing)) return;
    if (!form.expense_type) { alert('Choose an expense type.'); return; }
    setSubmitting(true);
    try {
      const fields = {
        expense_type: form.expense_type, project_code: form.project_code || null,
        vendor_name: form.vendor_name || null, expense_date: form.expense_date || null,
        amount: form.amount ? Number(form.amount) : null, vat_amount: form.vat_amount ? Number(form.vat_amount) : null,
        currency: form.currency || null, notes: form.notes || null,
      };
      if (editing) {
        await api.updateExpense(editing.id, fields);
      } else {
        const path = await api.uploadExpenseFile(owner, file!);
        await api.createClientExpense({ owner_client_id: owner, file_name: file!.name, storage_path: path, mime_type: file!.type, status: 'submitted', ...fields });
      }
      const wasEdit = !!editing;
      reset(); await load();
      alert(wasEdit ? 'Expense updated.' : 'Expense submitted — your accountant will process it.');
    } catch (err: any) { alert('Save failed: ' + err.message); }
    finally { setSubmitting(false); }
  };

  const viewFile = async (path: string) => {
    try { window.open(await api.expenseFileUrl(path), '_blank'); } catch (err: any) { alert(err.message); }
  };

  if (!owner) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  const open = !!file || !!editing;
  const previewMime = file?.type || editing?.mime_type || '';
  const isImage = previewMime.startsWith('image/');
  const isPdf   = previewMime === 'application/pdf';

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>My Expenses</h2></div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Upload or photograph a purchase invoice — we read it automatically. Check it against the document, tag the type and project, then submit. You can edit a submitted expense until we process it.
      </p>

      <datalist id="expense-types">{EXPENSE_TYPES.map(t => <option key={t} value={t} />)}</datalist>

      {!open ? (
        <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: 32 }}>
          <p style={{ color: '#64748b' }}>Take a photo of the receipt, or choose a file.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
              📷 Take photo
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={e => { const sel = e.target.files?.[0]; if (sel) onFile(sel); }} />
            </label>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              📎 Choose file
              <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                onChange={e => { const sel = e.target.files?.[0]; if (sel) onFile(sel); }} />
            </label>
          </div>
        </div>
      ) : (
        <div className="expense-split">
          <div className="card expense-preview-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{file?.name || editing?.file_name || 'Document'}</strong>
              {!editing && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    📷 Photo
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                      onChange={e => { const sel = e.target.files?.[0]; if (sel) onFile(sel); }} />
                  </label>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    Change
                    <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                      onChange={e => { const sel = e.target.files?.[0]; if (sel) onFile(sel); }} />
                  </label>
                </div>
              )}
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 6, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
              {!previewUrl ? <p style={{ padding: 24, color: '#64748b' }}>Loading preview…</p>
                : isImage ? <img src={previewUrl} alt="Expense document" style={{ maxWidth: '100%', maxHeight: 560 }} />
                : isPdf ? <iframe src={previewUrl} title="Expense document" style={{ width: '100%', height: 560, border: 'none' }} />
                : <p style={{ padding: 24, color: '#64748b' }}>No preview for this file type.</p>}
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{editing ? 'Edit expense' : 'Details'}</strong>
              {scanning && <span style={{ color: '#1e40af', fontSize: 12 }}>reading…</span>}
            </div>
            <div className="form-grid">
              <div className="form-group"><label>Expense type *</label><input className="form-input" list="expense-types" value={form.expense_type} onChange={e => f('expense_type', e.target.value)} placeholder="e.g. Utilities" /></div>
              <div className="form-group"><label>Project code</label><input className="form-input" value={form.project_code} onChange={e => f('project_code', e.target.value)} /></div>
              <div className="form-group"><label>Supplier</label><input className="form-input" value={form.vendor_name} onChange={e => f('vendor_name', e.target.value)} /></div>
              <div className="form-group"><label>Date</label><input type="date" className="form-input" value={form.expense_date} onChange={e => f('expense_date', e.target.value)} /></div>
              <div className="form-group"><label>Amount</label><input type="number" step="0.01" className="form-input" value={form.amount} onChange={e => f('amount', e.target.value)} /></div>
              <div className="form-group"><label>VAT</label><input type="number" step="0.01" className="form-input" value={form.vat_amount} onChange={e => f('vat_amount', e.target.value)} /></div>
              <div className="form-group full-width"><label>Notes</label><input className="form-input" value={form.notes} onChange={e => f('notes', e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" onClick={reset} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={submitting || scanning}>{submitting ? 'Saving…' : (editing ? 'Save changes' : 'Submit expense')}</button>
            </div>
          </div>
        </div>
      )}

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
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {r.storage_path && <button className="btn btn-secondary btn-sm" onClick={() => viewFile(r.storage_path)}>View</button>}{' '}
                      {r.status === 'submitted' && <button className="btn btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button>}
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
