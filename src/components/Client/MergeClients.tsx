import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';

const COMPARE_FIELDS = [
  { key: 'client_code', label: 'Client Code' },
  { key: 'name', label: 'Legal Name' },
  { key: 'trading_name', label: 'Trading Name' },
  { key: 'business_type', label: 'Business Type' },
  { key: 'tax_number', label: 'Tax Number (TIC)' },
  { key: 'vat_number', label: 'VAT Number' },
  { key: 'registration_number', label: 'Registration Number' },
  { key: 'social_insurance_number', label: 'Social Insurance' },
  { key: 'employer_number', label: 'Employer Number' },
  { key: 'ergani_number', label: 'Ergani Number' },
  { key: 'id_number', label: 'ID Number' },
  { key: 'passport_number', label: 'Passport' },
  { key: 'director_name', label: 'Director' },
  { key: 'contact_person', label: 'Contact Person' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'postal_code', label: 'Postal Code' },
  { key: 'country', label: 'Country' },
  { key: 'services', label: 'Services' },
  { key: 'monthly_fee', label: 'Monthly Fee' },
  { key: 'notes', label: 'Notes' },
];

export default function MergeClients({ onDone }: { onDone?: () => void }) {
  const { clients, refreshClients, invoices } = useApp();
  const { runWith } = useMFAStepUp();
  const [keepId, setKeepId] = useState<number>(0);
  const [mergeId, setMergeId] = useState<number>(0);
  const [selections, setSelections] = useState<Record<string, 'keep' | 'merge'>>({});
  const [searchKeep, setSearchKeep] = useState('');
  const [searchMerge, setSearchMerge] = useState('');
  const [merging, setMerging] = useState(false);

  const keepClient = clients.find((c: any) => c.id === keepId);
  const mergeClient = clients.find((c: any) => c.id === mergeId);

  const filteredKeep = clients.filter((c: any) => c.id !== mergeId && (c.name || '').toLowerCase().includes(searchKeep.toLowerCase()));
  const filteredMerge = clients.filter((c: any) => c.id !== keepId && (c.name || '').toLowerCase().includes(searchMerge.toLowerCase()));

  // Auto-select: prefer non-empty value from keep, otherwise from merge
  useEffect(() => {
    if (keepClient && mergeClient) {
      const newSel: Record<string, 'keep' | 'merge'> = {};
      for (const f of COMPARE_FIELDS) {
        const keepVal = keepClient[f.key] || '';
        const mergeVal = mergeClient[f.key] || '';
        if (keepVal && !mergeVal) newSel[f.key] = 'keep';
        else if (!keepVal && mergeVal) newSel[f.key] = 'merge';
        else newSel[f.key] = 'keep'; // default to keep when both have values
      }
      setSelections(newSel);
    }
  }, [keepId, mergeId]);

  const invoiceCount = (id: number) => invoices.filter((i: any) => i.client_id === id).length;

  const handleMerge = async () => {
    if (!keepId || !mergeId) { alert('Select both clients'); return; }
    const conf = `Merge "${mergeClient?.name}" INTO "${keepClient?.name}"?\n\nAll invoices, documents, credentials, chart of accounts from "${mergeClient?.name}" will move to "${keepClient?.name}".\n"${mergeClient?.name}" will then be DELETED.\n\nThis cannot be undone.`;
    if (!confirm(conf)) return;

    // Build field overrides: any "merge" selection where source has value
    const fieldOverrides: Record<string, string> = {};
    for (const f of COMPARE_FIELDS) {
      if (selections[f.key] === 'merge' && mergeClient?.[f.key]) {
        fieldOverrides[f.key] = mergeClient[f.key];
      }
    }

    setMerging(true);
    try {
      await runWith(() => api.mergeClient(keepId, mergeId, fieldOverrides));
      await refreshClients();
      alert('Merge complete!');
      setKeepId(0); setMergeId(0); setSelections({});
      if (onDone) onDone();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Merge failed: ' + err.message);
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="merge-clients">
      <div className="merge-header">
        <h3>Merge Duplicate Clients</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Select two clients. All data (invoices, documents, credentials) from the "merge from" client will move into the "keep" client. The "merge from" client will then be deleted.
        </p>
      </div>

      <div className="merge-selectors">
        <div className="merge-col">
          <label className="merge-label keep-label">KEEP (primary)</label>
          <input type="text" placeholder="Search..." value={searchKeep} onChange={(e) => setSearchKeep(e.target.value)} className="form-input" />
          <div className="merge-list">
            {filteredKeep.slice(0, 50).map((c: any) => (
              <div
                key={c.id}
                className={`merge-item ${keepId === c.id ? 'selected' : ''}`}
                onClick={() => setKeepId(c.id)}
              >
                <div className="merge-item-name">{c.name}</div>
                <div className="merge-item-meta">
                  {c.client_code && <span>{c.client_code}</span>}
                  {c.tax_number && <span>{c.tax_number}</span>}
                  <span>{invoiceCount(c.id)} inv</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="merge-col">
          <label className="merge-label merge-from-label">MERGE FROM (will be deleted)</label>
          <input type="text" placeholder="Search..." value={searchMerge} onChange={(e) => setSearchMerge(e.target.value)} className="form-input" />
          <div className="merge-list">
            {filteredMerge.slice(0, 50).map((c: any) => (
              <div
                key={c.id}
                className={`merge-item ${mergeId === c.id ? 'selected-merge' : ''}`}
                onClick={() => setMergeId(c.id)}
              >
                <div className="merge-item-name">{c.name}</div>
                <div className="merge-item-meta">
                  {c.client_code && <span>{c.client_code}</span>}
                  {c.tax_number && <span>{c.tax_number}</span>}
                  <span>{invoiceCount(c.id)} inv</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Field comparison */}
      {keepClient && mergeClient && (
        <div className="merge-compare">
          <h4>Choose which value to keep for each field:</h4>
          <table className="merge-compare-table">
            <thead>
              <tr>
                <th>Field</th>
                <th className="keep-col">
                  Keep: {keepClient.name}
                </th>
                <th className="merge-col-head">
                  From: {mergeClient.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_FIELDS.map((f) => {
                const kVal = keepClient[f.key] || '';
                const mVal = mergeClient[f.key] || '';
                if (!kVal && !mVal) return null;
                const selected = selections[f.key] || 'keep';
                return (
                  <tr key={f.key}>
                    <td className="field-label">{f.label}</td>
                    <td className={`value-cell ${selected === 'keep' ? 'chosen' : ''}`} onClick={() => setSelections(p => ({ ...p, [f.key]: 'keep' }))}>
                      <input type="radio" checked={selected === 'keep'} onChange={() => setSelections(p => ({ ...p, [f.key]: 'keep' }))} />
                      <span>{kVal || <em>(empty)</em>}</span>
                    </td>
                    <td className={`value-cell ${selected === 'merge' ? 'chosen' : ''}`} onClick={() => setSelections(p => ({ ...p, [f.key]: 'merge' }))}>
                      <input type="radio" checked={selected === 'merge'} onChange={() => setSelections(p => ({ ...p, [f.key]: 'merge' }))} />
                      <span>{mVal || <em>(empty)</em>}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="merge-summary card" style={{ marginTop: 16 }}>
            <h4>After merge:</h4>
            <ul>
              <li><strong>{invoiceCount(mergeId)}</strong> invoices will move from "{mergeClient.name}" to "{keepClient.name}"</li>
              <li>All documents, credentials, chart of accounts will transfer</li>
              <li>"{mergeClient.name}" will be permanently deleted</li>
            </ul>
            <button className="btn btn-danger" onClick={handleMerge} disabled={merging} style={{ marginTop: 12 }}>
              {merging ? 'Merging...' : `Merge "${mergeClient.name}" into "${keepClient.name}"`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
