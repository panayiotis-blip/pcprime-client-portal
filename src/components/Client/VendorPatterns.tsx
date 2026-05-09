import { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function VendorPatterns({ clientId }: { clientId: number }) {
  const [patterns, setPatterns] = useState<any[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [edits, setEdits] = useState<any>({});

  const load = async () => { try { setPatterns(await api.getVendorPatterns(clientId)); } catch {} };
  useEffect(() => { load(); }, [clientId]);

  const handleSave = async (id: number) => {
    await api.updateVendorPattern(id, edits);
    setEditing(null);
    setEdits({});
    await load();
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this vendor pattern? Future invoices from this vendor won\'t auto-fill.')) {
      await api.deleteVendorPattern(id);
      await load();
    }
  };

  return (
    <div className="vendor-patterns">
      <div className="list-header">
        <h3>Vendor Patterns ({patterns.length})</h3>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
        Each time you review and save an invoice, the system learns the debit/credit accounts and VAT code for that vendor. Future invoices from the same vendor are auto-filled.
      </p>

      {patterns.length === 0 ? (
        <div className="empty-state">
          <p>No patterns learned yet. Review and save a few invoices and they'll appear here.</p>
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Journal</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>VAT</th>
                <th>Rate</th>
                <th>Used</th>
                <th>Last Used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p: any) => {
                const isEditing = editing === p.id;
                return (
                  <tr key={p.id}>
                    <td><strong>{p.vendor_name_original}</strong></td>
                    <td>{isEditing ? <input defaultValue={p.journal_type} onChange={(e) => setEdits((d: any) => ({ ...d, journal_type: e.target.value }))} className="form-input" style={{ width: 70 }} /> : p.journal_type || '-'}</td>
                    <td>{isEditing ? <input defaultValue={p.debit_account} onChange={(e) => setEdits((d: any) => ({ ...d, debit_account: e.target.value }))} className="form-input" /> : p.debit_account || '-'}</td>
                    <td>{isEditing ? <input defaultValue={p.credit_account} onChange={(e) => setEdits((d: any) => ({ ...d, credit_account: e.target.value }))} className="form-input" /> : p.credit_account || '-'}</td>
                    <td>{isEditing ? <input defaultValue={p.vat_code} onChange={(e) => setEdits((d: any) => ({ ...d, vat_code: e.target.value }))} className="form-input" style={{ width: 80 }} /> : p.vat_code || '-'}</td>
                    <td>{isEditing ? <input type="number" step="0.1" defaultValue={p.vat_rate} onChange={(e) => setEdits((d: any) => ({ ...d, vat_rate: parseFloat(e.target.value) || 0 }))} className="form-input" style={{ width: 70 }} /> : (p.vat_rate ? `${p.vat_rate}%` : '-')}</td>
                    <td>{p.match_count}×</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(p.last_used).toLocaleDateString()}</td>
                    <td>
                      {isEditing ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => handleSave(p.id)}>Save</button>
                          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => { setEditing(null); setEdits({}); }}>X</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(p.id); setEdits({ debit_account: p.debit_account, credit_account: p.credit_account, vat_code: p.vat_code, vat_rate: p.vat_rate, journal_type: p.journal_type, details_template: p.details_template }); }}>Edit</button>
                          <button className="btn btn-danger btn-sm" style={{ marginLeft: 4 }} onClick={() => handleDelete(p.id)}>X</button>
                        </>
                      )}
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
