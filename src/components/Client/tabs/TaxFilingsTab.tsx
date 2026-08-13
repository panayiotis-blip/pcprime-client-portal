import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../../services/api';
import { vatPeriodsForYear } from '../../../services/vatCategories';
import { downloadTaxisnetXml, validateExport } from '../../../services/taxisnetXml';
import {
  FILING_TYPES, FILING_STATUSES,
  filingTypeLabel, StatusPill, taxYears,
} from '../../shared/TaxFilingMeta';
// @ts-expect-error — JSX file with no exported types
import CyprusTaxCalculator from '../../CyprusTaxCalculator.jsx';
import TaxReturnChecklistGate from './TaxReturnChecklistGate';
import type { ChecklistState } from './TaxReturnChecklistGate';

interface Props { clientId: number; canEdit: boolean; clientName?: string; client?: any; }

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
  // Migration 181. Null on annual filings — a company return is identified by
  // its year and needs nothing more.
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
};

/** Filing types that recur within a year and therefore need a period. */
const PERIODIC_FILING_TYPES = new Set(['vat_return']);

type FormType = 'individuals' | 'self_employed';

// Which filing_types open the rich TD1 editor and which form variant they imply.
const FILING_TYPE_TO_FORM_TYPE: Record<string, FormType> = {
  individual_tax_return: 'individuals',
  individual_tax_return_self_employed: 'self_employed',
  individual_tax_return_pensioner: 'individuals',
};
const isTaxReturnFiling = (filingType: string) => filingType in FILING_TYPE_TO_FORM_TYPE;

const blank = (defaultYear: number): Partial<Filing> => ({
  tax_year: defaultYear,
  filing_type: 'individual_tax_return',
  status: 'pending',
  due_date: null,
  filed_date: null,
  reference_number: '',
  amount: null,
  notes: '',
  period_label: null,
  period_start: null,
  period_end: null,
});

// Tax Filings — unified tab that lists every filing type (VAT, corporate, etc.)
// AND opens the TD1 calculator editor in-place for individual tax return rows.
// Editor is backed by the separate `tax_returns` table, linked by (client_id, tax_year).
export default function TaxFilingsTab({ clientId, canEdit, clientName, client }: Props) {
  const [rows, setRows] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Partial<Filing>>(blank(new Date().getFullYear()));

  const needsPeriod = PERIODIC_FILING_TYPES.has(String(form.filing_type || ''));
  const periodOptions = useMemo(
    () => (needsPeriod
      ? vatPeriodsForYear(client?.vat_category, client?.vat_start_month, Number(form.tax_year))
      : []),
    [needsPeriod, client?.vat_category, client?.vat_start_month, form.tax_year],
  );

  // Changing the year or the type invalidates a period already picked — a
  // 'Feb–Apr 2025' left sitting on a 2026 return would be quietly wrong.
  useEffect(() => {
    setForm(f => (f.period_label && !periodOptions.some(o => o.label === f.period_label)
      ? { ...f, period_label: null, period_start: null, period_end: null }
      : f));
  }, [periodOptions]);
  const [saving, setSaving] = useState(false);

  // Editor mode (for tax-return-type filings)
  const [editorReturn, setEditorReturn] = useState<any | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  // Per-row busy flag for the one-click TaxisNet XML test export.
  const [xmlBusyId, setXmlBusyId] = useState<number | null>(null);
  // Pre-start checklist gate — editor stays closed until passed for this session.
  const [gatePassed, setGatePassed] = useState(false);

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

  // Build clientPrefill for the calculator from the client row.
  const clientPrefill = client ? {
    name: client?.name || [client?.first_name, client?.surname].filter(Boolean).join(' ').trim(),
    tic: client?.tax_number || '',
    idNumber: client?.id_number || client?.passport_number || '',
    dob: client?.date_of_birth || '',
    siNumber: client?.social_insurance_number || '',
    address: client?.address || '',
  } : undefined;

  // Open the rich editor for a tax-return-type filing. Loads or lazily creates
  // a `tax_returns` row keyed by (client_id, tax_year).
  const openEditor = async (filing: Filing) => {
    if (!isTaxReturnFiling(filing.filing_type)) return;
    setEditorBusy(true);
    try {
      const desiredFormType: FormType = FILING_TYPE_TO_FORM_TYPE[filing.filing_type];
      const existing = (await api.listTaxReturns(clientId)) as Array<{ id: number; tax_year: number }>;
      const match = existing.find(r => r.tax_year === filing.tax_year);
      let taxReturn;
      if (match) {
        taxReturn = await api.getTaxReturn(match.id);
      } else {
        const newId = await api.createTaxReturn({
          client_id: clientId,
          tax_year: filing.tax_year,
          form_type: desiredFormType,
          input_data: {},
          results: {},
          status: 'draft',
        });
        taxReturn = await api.getTaxReturn(newId);
      }
      setEditorReturn(taxReturn);
      // Skip the gate only if this return was already confirmed before.
      setGatePassed(!!taxReturn?.checklist?.confirmed_at);
    } catch (err: any) {
      alert('Could not open the return editor: ' + err.message);
    } finally {
      setEditorBusy(false);
    }
  };

  // One-click TaxisNet XML from a return's SAVED data — no editor / checklist
  // gate. Built for the test-import loop: generate the file, upload it to
  // TaxisNet in draft, and feed back whatever it accepts or rejects so inferred
  // mappings can be confirmed. Reads tax_returns.input_data for (client, year);
  // the taxpayer T.I.C. falls back to the client record if the return was never
  // saved through the editor.
  const handleTestXml = async (filing: Filing) => {
    if (!isTaxReturnFiling(filing.filing_type)) return;
    setXmlBusyId(filing.id);
    try {
      const formType = FILING_TYPE_TO_FORM_TYPE[filing.filing_type];
      const existing = (await api.listTaxReturns(clientId)) as Array<{ id: number; tax_year: number }>;
      const match = existing.find(r => r.tax_year === filing.tax_year);
      if (!match) {
        alert('No saved return data for this year yet. Click "Open Return", enter and save the figures, then export the XML.');
        return;
      }
      const tr = await api.getTaxReturn(match.id);
      const input = tr?.input_data || {};
      const inputForXml = { ...input, clientTIC: input.clientTIC || client?.tax_number || '' };

      const { errors, warnings } = validateExport(inputForXml, filing.tax_year, formType);
      if (errors.length) {
        alert('Cannot export this return yet:\n\n• ' + errors.join('\n• '));
        return;
      }
      if (warnings.length && !confirm(
        'Before this test export, note:\n\n• ' + warnings.join('\n• ') +
        '\n\nDownload the XML anyway?'
      )) return;

      downloadTaxisnetXml(inputForXml, filing.tax_year, formType);
    } catch (err: any) {
      alert('XML export failed: ' + err.message);
    } finally {
      setXmlBusyId(null);
    }
  };

  const saveCurrent = async (inputData: any, snapshot: { year: number; results: any }) => {
    if (!editorReturn) return;
    await api.updateTaxReturn(editorReturn.id, {
      input_data: inputData,
      results: snapshot.results,
    });
  };

  // Record the pre-start checklist confirmation on the return, then open editor.
  const confirmChecklist = async (state: ChecklistState) => {
    if (!editorReturn) return;
    try {
      await api.updateTaxReturn(editorReturn.id, { checklist: state });
      setEditorReturn({ ...editorReturn, checklist: state });
    } catch (err: any) {
      // Persisting the checklist shouldn't block data entry — log and proceed.
      console.error('Could not save checklist:', err);
    }
    setGatePassed(true);
  };

  // File a generated TaxisNet XML into the client's Documents folder so it can
  // be retrieved and uploaded to TaxisNet later.
  const saveXmlToClient = async (xml: string, filename: string) => {
    const file = new File([xml], filename, { type: 'application/xml' });
    await api.uploadDocumentsToFolder({
      clientId,
      folderId: null,
      docType: 'tax_return_xml',
      category: 'tax',
      month: '',
      year: String(editorReturn?.tax_year || ''),
      files: [file],
      notes: 'TaxisNet XML export (TD1)',
    });
  };

  const changeFormType = async (newType: FormType) => {
    if (!editorReturn || newType === editorReturn.form_type) return;
    if (!confirm(
      `Switch this return to "${newType === 'self_employed' ? 'Self Employed' : 'Individuals'}"? ` +
      `Existing input data is preserved but some fields may not apply to the other form.`
    )) return;
    try {
      await api.updateTaxReturn(editorReturn.id, { form_type: newType });
      setEditorReturn({ ...editorReturn, form_type: newType });
    } catch (err: any) {
      alert('Could not change form type: ' + err.message);
    }
  };

  const handleAdd = async () => {
    if (!form.tax_year || !form.filing_type || !form.status) {
      alert('Tax year, type and status are required'); return;
    }
    // A VAT return without its period is the ambiguity this whole thing exists
    // to remove — but only insist when we can actually offer the choice.
    if (needsPeriod && periodOptions.length > 0 && !form.period_label) {
      alert('Choose which period this VAT return is for.'); return;
    }
    setSaving(true);
    try {
      await api.createTaxFiling({
        client_id: clientId,
        tax_year:  form.tax_year,
        filing_type: form.filing_type,
        status:    form.status,
        period_label: form.period_label || null,
        period_start: form.period_start || null,
        period_end:   form.period_end || null,
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
      'Period':          r.period_label || '',
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

  // ---------------- EDITOR VIEW (TD1 calculator for an individual tax return) ----------------
  if (editorReturn) {
    const formType: FormType = (editorReturn.form_type as FormType) || 'individuals';
    const titleLabel = formType === 'self_employed' ? 'Self Employed' : 'Tax Return Individuals';

    // Gate: confirm we hold the client's information before opening the editor.
    if (!gatePassed) {
      return (
        <TaxReturnChecklistGate
          formType={formType}
          clientName={clientName}
          taxYear={editorReturn.tax_year}
          initial={editorReturn.checklist as ChecklistState}
          canEdit={canEdit}
          onConfirm={confirmChecklist}
          onCancel={() => { setEditorReturn(null); setGatePassed(false); }}
        />
      );
    }
    return (
      <div className="client-tab-content">
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setEditorReturn(null); setGatePassed(false); }}>
            ← Back to filings
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setGatePassed(false)} title="Review the information checklist">
            ☑ Checklist
          </button>
          <strong style={{ fontSize: '1.05em' }}>{titleLabel} {editorReturn.tax_year}</strong>
          <span style={{ fontSize: '0.78em', padding: '2px 8px', background: 'var(--pc-bg-alt, #e7eaef)', borderRadius: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {editorReturn.status}
          </span>
          {canEdit && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85em', marginLeft: 'auto' }}>
              <label style={{ color: 'var(--pc-text-2)' }}>Form:</label>
              <select className="form-input" style={{ padding: '2px 6px', fontSize: '0.85em', width: 'auto' }}
                      value={formType} onChange={(e) => changeFormType(e.target.value as FormType)}>
                <option value="individuals">Tax Return Individuals</option>
                <option value="self_employed">Self Employed</option>
              </select>
            </span>
          )}
        </div>
        <CyprusTaxCalculator
          clientPrefill={clientPrefill}
          initialState={editorReturn.input_data || {}}
          onSave={saveCurrent}
          onSaveXmlToClient={saveXmlToClient}
          taxYearLock={editorReturn.tax_year}
          formType={formType}
        />
      </div>
    );
  }

  // ---------------- LIST VIEW (all filings) ----------------
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

        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 0, marginBottom: 10 }}>
          Individual / Self-Employed / Pensioner tax-return rows open the full TD1 editor when clicked.
        </p>

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
                  <th>Period</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Filed</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Notes</th>
                  <th style={{ width: 170 }}></th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>{r.tax_year}</td>
                    <td>{filingTypeLabel(r.filing_type)}</td>
                    {/* Blank for annual filings, and for periodic rows entered
                        before periods existed — neither is worth inventing. */}
                    <td style={{ whiteSpace: 'nowrap' }}>{r.period_label || '—'}</td>
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
                    <td>
                      {isTaxReturnFiling(r.filing_type) && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditor(r)}
                            disabled={editorBusy}
                            title="Open the TD1 editor for this tax return"
                          >
                            {editorBusy ? '…' : 'Open Return'}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleTestXml(r)}
                            disabled={xmlBusyId === r.id}
                            title="Generate the TaxisNet XML from this return's saved data (for a test import)"
                          >
                            {xmlBusyId === r.id ? '…' : '⬇ XML'}
                          </button>
                        </div>
                      )}
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
              {/* VAT is not annual. The options come from this client's own
                  registration — category A-G and start month — so a 3-monthly
                  client gets their four periods and a monthly client twelve. */}
              {needsPeriod && (
                <div className="form-group">
                  <label>Period {periodOptions.length > 0 && '*'}</label>
                  {periodOptions.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#b4720d', margin: '4px 0 0' }}>
                      No VAT category or start month on this client — set them on the
                      Registrations tab and the periods appear here.
                    </p>
                  ) : (
                    <select
                      className="form-input"
                      value={form.period_label || ''}
                      onChange={e => {
                        const p = periodOptions.find(o => o.label === e.target.value);
                        setForm(f => ({
                          ...f,
                          period_label: p?.label ?? null,
                          period_start: p?.start ?? null,
                          period_end: p?.end ?? null,
                        }));
                      }}>
                      <option value="">— choose the period —</option>
                      {periodOptions.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                    </select>
                  )}
                </div>
              )}
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
            {form.filing_type && isTaxReturnFiling(form.filing_type) && (
              <p style={{ marginTop: 12, fontSize: 12, color: '#5a6478', background: '#f8fafc', padding: 8, borderLeft: '3px solid #9b861f', borderRadius: 2 }}>
                After saving you can click <strong>Open Return</strong> on the row to open the full TD1 calculator. A `tax_returns` row is created on first open.
              </p>
            )}
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
