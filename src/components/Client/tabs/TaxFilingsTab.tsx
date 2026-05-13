import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../../services/api';
import {
  FILING_TYPES, FILING_STATUSES,
  filingTypeLabel, StatusPill, taxYears,
} from '../../shared/TaxFilingMeta';

interface Props { clientId: number; canEdit: boolean; clientName?: string; }

type Filing = {
  id: number;
  client_id: number;
  tax_year: number;
  filing_type: string;
  status: string;
  due_date: string | null;
  filed_date: string | null;
  filed_by_user_id: string | null;
  reference_number: string | null;
  amount: number | null;
  notes: string | null;
};

const blank = (defaultYear: number): Partial<Filing> => ({
  tax_year: defaultYear,
  filing_type: 'individual_tax_return',
  status: 'pending',
  due_date: null,
  filed_date: null,
  reference_number: '',
  amount: null,
  notes: '',
});

// Tab 9 (new): Tax Filings per client — list + filter + add/edit modal +
// inline status edit + delete + Excel export.
export default function TaxFilingsTab({ clientId, canEdit, clientName }: Props) {
  const [rows, setRows] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Partial<Filing>>(blank(new Date().getFullYear()));
  const [saving, setSaving] = useState(false);

  // Filters
  const [fYear, setFYear] = useState<string>('');
  const [fType, setFType] = useState<string>('');
  const [fStatus, setFStatus] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getClientTaxFilings(clientId);
      setRows(data as Filing[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId]);

  const filtered = useMemo(() => rows.filter(r =>
    (!fYear   || String(r.tax_year) === fYear) &&
    (!fType   || r.filing_type === fType) &&
    (!fStatus || r.status === fStatus)
  ), [rows, fYear, fType, fStatus]);

  const handleAdd = async () => {
    if (!form.tax_year || !form.filing_type || !form.status) {
      alert('Tax year, type and status are required'); return;
    }
    setSaving(true);
    try {
      await api.createTaxFiling({
        client_id: clientId,
        tax_year:  form.tax_year,
        filing_type: form.filing_type,
        status:    form.status,
        due_date:  form.due_date || null,
        filed_date: form.filed_date || null,
        reference_number: form.reference_number || null,
        amount:    form.amount,
        notes:     form.notes || null,
      });
      setForm(blank(form.tax_year || new Date().getFullYear()));
      setShowAdd(false);
      await load();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const patchRow = async (id: number, patch: Partial<Filing>) => {
    try {
      await api.updateTaxFiling(id, patch);
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    } catch (err: any) {
      alert('Update failed: ' + err.message);
      await load();
    }
  };

  const handleDelete = async (r: Filing) => {
    if (!confirm(`Delete ${r.tax_year} ${filingTypeLabel(r.filing_type)} filing?`)) return;
    try {
      await api.deleteTaxFiling(r.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const exportExcel = () => {
    const data = filtered.map(r => ({
      'Tax Year':        r.tax_year,
      'Filing Type':     filingTypeLabel(r.filing_type),
      'Status':          r.status,
      'Due Date':        r.due_date || '',
      'Filed Date':      r.filed_date || '',
      'Reference':       r.reference_number || '',
      'Amount':          r.amount ?? '',
      'Notes':           r.notes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tax Filings');
    const fname = `tax-filings-${(clientName || 'client').replace(/[^a-zA-Z0-9-]+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fname);
  };

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Tax Filings ({rows.length})</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={exportExcel} disabled={filtered.length === 0}>
              ⬇ Export Excel
            </button>
            {canEdit && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Filing</button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select className="form-input form-input-sm" value={fYear} onChange={e => setFYear(e.target.value)} style={{ maxWidth: 130 }}>
            <option value="">All years</option>
            {taxYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="form-input form-input-sm" value={fType} onChange={e => setFType(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">All types</option>
            {FILING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="form-input form-input-sm" value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All statuses</option>
            {FILING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {(fYear || fType || fStatus) && (
            <button className="btn btn-link btn-sm" onClick={() => { setFYear(''); setFType(''); setFStatus(''); }}>Clear filters</button>
          )}
        </div>

        {filtered.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>
            {rows.length === 0 ? 'No tax filings recorded yet.' : 'No filings match the current filters.'}
          </p>
        ) : (
          <div className="compliance-table-wrapper">
            <table className="compliance-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Year</th>
                  <th>Filing</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Filed</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Notes</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>{r.tax_year}</td>
                    <td>{filingTypeLabel(r.filing_type)}</td>
                    <td>
                      {canEdit ? (
                        <select
                          className="form-input form-input-sm"
                          value={r.status}
                          onChange={e => patchRow(r.id, { status: e.target.value })}
                          style={{ width: 130 }}
                        >
                          {FILING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      ) : <StatusPill status={r.status} />}
                    </td>
                    <td>
                      {canEdit ? (
                        <input
                          type="date"
                          className="form-input form-input-sm"
                          defaultValue={r.due_date || ''}
                          onBlur={e => (e.target.value || null) !== r.due_date && patchRow(r.id, { due_date: e.target.value || null })}
                        />
                      ) : (r.due_date || '—')}
                    </td>
                    <td>
                      {canEdit ? (
                        <input
                          type="date"
                          className="form-input form-input-sm"
                          defaultValue={r.filed_date || ''}
                          onBlur={e => (e.target.value || null) !== r.filed_date && patchRow(r.id, { filed_date: e.target.value || null })}
                        />
                      ) : (r.filed_date || '—')}
                    </td>
                    <td>
                      {canEdit ? (
                        <input
                          type="text"
                          className="form-input form-input-sm"
                          defaultValue={r.reference_number || ''}
                          onBlur={e => (e.target.value || null) !== r.reference_number && patchRow(r.id, { reference_number: e.target.value || null })}
                          style={{ width: 140 }}
                        />
                      ) : (r.reference_number || '—')}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {canEdit ? (
                        <input
                          type="number"
                          step={0.01}
                          className="form-input form-input-sm"
                          defaultValue={r.amount ?? ''}
                          onBlur={e => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            if (v !== r.amount) patchRow(r.id, { amount: v });
                          }}
                          style={{ width: 90, textAlign: 'right' }}
                        />
                      ) : (r.amount != null ? r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—')}
                    </td>
                    <td style={{ maxWidth: 220, fontSize: 12 }}>
                      {canEdit ? (
                        <input
                          type="text"
                          className="form-input form-input-sm"
                          defaultValue={r.notes || ''}
                          onBlur={e => (e.target.value || null) !== r.notes && patchRow(r.id, { notes: e.target.value || null })}
                        />
                      ) : (r.notes || '—')}
                    </td>
                    {canEdit && (
                      <td>
                        <button className="btn btn-link btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>Add tax filing</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>Tax Year *</label>
                <select className="form-input" value={form.tax_year || ''} onChange={e => setForm(p => ({ ...p, tax_year: Number(e.target.value) }))}>
                  {taxYears().map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Filing Type *</label>
                <select className="form-input" value={form.filing_type || ''} onChange={e => setForm(p => ({ ...p, filing_type: e.target.value }))}>
                  {FILING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Status *</label>
                <select className="form-input" value={form.status || ''} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  {FILING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Due Date</label><input type="date" className="form-input" value={form.due_date || ''} onChange={e => setForm(p => ({ ...p, due_date: e.target.value || null }))} /></div>
              <div className="form-group"><label>Filed Date</label><input type="date" className="form-input" value={form.filed_date || ''} onChange={e => setForm(p => ({ ...p, filed_date: e.target.value || null }))} /></div>
              <div className="form-group"><label>Reference Number</label><input type="text" className="form-input" value={form.reference_number || ''} onChange={e => setForm(p => ({ ...p, reference_number: e.target.value }))} placeholder="e.g. TAXISNET ref" /></div>
              <div className="form-group"><label>Amount</label><input type="number" step={0.01} className="form-input" value={form.amount ?? ''} onChange={e => setForm(p => ({ ...p, amount: e.target.value === '' ? null : Number(e.target.value) as any }))} /></div>
              <div className="form-group full-width"><label>Notes</label><textarea className="form-input" rows={3} value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>{saving ? 'Saving…' : 'Save filing'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
