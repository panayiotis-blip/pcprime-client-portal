import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
// @ts-expect-error — JSX file with no exported types
import CyprusTaxCalculator from '../../CyprusTaxCalculator.jsx';

type FormType = 'individuals' | 'self_employed';

type TaxReturnRow = {
  id: number;
  tax_year: number;
  form_type: FormType;
  status: string;
  reference_number: string | null;
  updated_at: string;
  submitted_at: string | null;
};

type Props = {
  clientId: number;
  client: any;
  editable: boolean;
};

const AVAILABLE_YEARS = [2024, 2025, 2026];
const FORM_TYPE_LABEL: Record<FormType, string> = {
  individuals: 'Tax Return Individuals',
  self_employed: 'Self Employed',
};

// Default the form type from the client's category, but the practitioner can
// override per return in the dialog or in the editor header.
const defaultFormType = (client: any): FormType =>
  client?.client_category === 'self_employed' ? 'self_employed' : 'individuals';

export default function ClientTaxReturnTab({ clientId, client, editable }: Props) {
  const [returns, setReturns] = useState<TaxReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [currentReturn, setCurrentReturn] = useState<any>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newYear, setNewYear] = useState<number>(2025);
  const [newFormType, setNewFormType] = useState<FormType>(defaultFormType(client));
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = (await api.listTaxReturns(clientId)) as TaxReturnRow[];
      setReturns(rows);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Defensive: this tab should only mount for individual clients, but render
  // a friendly message just in case.
  if (client?.client_type !== 'individual') {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>Personal tax returns are only available for individual clients.</p>
      </div>
    );
  }

  // Build the client-prefill object that the calculator consumes.
  const clientPrefill = {
    name: client?.name || [client?.first_name, client?.surname].filter(Boolean).join(' ').trim(),
    tic: client?.tax_number || '',
    idNumber: client?.id_number || client?.passport_number || '',
    dob: client?.date_of_birth || '',
    siNumber: client?.social_insurance_number || '',
    address: client?.address || '',
  };

  const openReturn = async (id: number) => {
    try {
      const row = await api.getTaxReturn(id);
      setCurrentReturn(row);
      setView('edit');
    } catch (e: any) {
      alert(e.message);
    }
  };

  const createReturn = async () => {
    // Unique key for the form is (client_id, tax_year) per the DB constraint, so a
    // duplicate year still blocks regardless of form_type.
    const existing = returns.find(r => r.tax_year === newYear);
    if (existing) {
      alert(`A ${newYear} return already exists for this client. Open it from the list to continue editing.`);
      return;
    }
    setBusy(true);
    try {
      const id = await api.createTaxReturn({
        client_id: clientId,
        tax_year: newYear,
        form_type: newFormType,
        input_data: {},
        results: {},
        status: 'draft',
      });
      setShowNewDialog(false);
      await load();
      await openReturn(id);
    } catch (e: any) {
      alert('Could not create tax return: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteReturn = async (r: TaxReturnRow) => {
    if (!confirm(`Delete the ${r.tax_year} tax return for this client? This cannot be undone.`)) return;
    try {
      await api.deleteTaxReturn(r.id);
      await load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const saveCurrent = async (inputData: any, snapshot: { year: number; results: any }) => {
    if (!currentReturn) return;
    await api.updateTaxReturn(currentReturn.id, {
      input_data: inputData,
      results: snapshot.results,
    });
    await load();
  };

  const changeFormType = async (newType: FormType) => {
    if (!currentReturn) return;
    if (newType === currentReturn.form_type) return;
    if (!confirm(
      `Switch this return from "${FORM_TYPE_LABEL[currentReturn.form_type as FormType]}" to "${FORM_TYPE_LABEL[newType]}"? ` +
      `Existing input data is preserved but some fields may not apply to the other form.`
    )) return;
    try {
      await api.updateTaxReturn(currentReturn.id, { form_type: newType });
      setCurrentReturn({ ...currentReturn, form_type: newType });
      await load();
    } catch (e: any) {
      alert('Could not change form type: ' + e.message);
    }
  };

  // ---------------- EDIT VIEW ----------------
  if (view === 'edit' && currentReturn) {
    const formType: FormType = (currentReturn.form_type as FormType) || 'individuals';
    return (
      <div>
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setView('list'); setCurrentReturn(null); }}>
            ← Back to list
          </button>
          <strong style={{ fontSize: '1.05em' }}>{FORM_TYPE_LABEL[formType]} {currentReturn.tax_year}</strong>
          <span style={{ fontSize: '0.78em', padding: '2px 8px', background: 'var(--pc-bg-alt, #e7eaef)', borderRadius: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {currentReturn.status}
          </span>
          {editable && (
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
          initialState={currentReturn.input_data || {}}
          onSave={saveCurrent}
          taxYearLock={currentReturn.tax_year}
          formType={formType}
        />
      </div>
    );
  }

  // ---------------- LIST VIEW ----------------
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Personal tax returns</h4>
        <p style={{ color: 'var(--pc-text-2)', fontSize: '0.9em', marginTop: 0, marginBottom: 12 }}>
          Cyprus personal income tax (TD1). One return per tax year. Returns save as drafts; export to PDF or CSV from within the editor.
        </p>
        {editable && (
          <button className="btn btn-primary" onClick={() => { setNewFormType(defaultFormType(client)); setShowNewDialog(true); }}>
            + New tax return
          </button>
        )}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : returns.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--pc-text-2)' }}>
            No tax returns yet. Click "New tax return" above to start one for this client.
          </p>
        </div>
      ) : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Tax Year</th>
              <th>Form Type</th>
              <th>Status</th>
              <th>Reference</th>
              <th>Last updated</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {returns.map(r => (
              <tr key={r.id}>
                <td>{r.tax_year}</td>
                <td>{FORM_TYPE_LABEL[(r.form_type as FormType) || 'individuals']}</td>
                <td style={{ textTransform: 'capitalize' }}>{r.status}</td>
                <td>{r.reference_number || '—'}</td>
                <td>{new Date(r.updated_at).toLocaleString('en-GB')}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openReturn(r.id)}>Open</button>
                  {editable && (
                    <button className="btn btn-danger btn-sm" style={{ marginLeft: 8 }} onClick={() => deleteReturn(r)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNewDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
             onClick={() => !busy && setShowNewDialog(false)}>
          <div className="card" style={{ minWidth: 360, maxWidth: 460, margin: 0 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>New tax return</h4>
            <div className="form-group">
              <label>Form Type</label>
              <select className="form-input" value={newFormType} onChange={(e) => setNewFormType(e.target.value as FormType)}>
                <option value="individuals">Tax Return Individuals (other than self-employed)</option>
                <option value="self_employed">Self Employed</option>
              </select>
              <small style={{ color: 'var(--pc-text-2)', fontSize: '0.78em' }}>
                Default from client category — change here if this year's return is a different form.
              </small>
            </div>
            <div className="form-group">
              <label>Tax year</label>
              <select className="form-input" value={newYear} onChange={(e) => setNewYear(parseInt(e.target.value, 10))}>
                {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={createReturn} disabled={busy}>
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
