import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { generateExcel, generateCSV } from '../../services/export/spreadsheetService';
import SearchableSelect from '../common/SearchableSelect';

export default function ExportPage() {
  const { invoices, clients, refreshInvoices } = useApp();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [filterClient, setFilterClient] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<string>('not-exported');
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState(0);

  const filtered = invoices.filter((inv: any) => {
    if (filterClient && inv.client_id !== filterClient) return false;
    if (filterStatus === 'not-exported' && inv.status === 'exported') return false;
    if (filterStatus && filterStatus !== 'not-exported' && inv.status !== filterStatus) return false;
    return true;
  });

  useEffect(() => { setSelectedIds(new Set(filtered.map((inv: any) => inv.id))); }, [filterClient, filterStatus, invoices.length]);

  const toggleSelect = (id: number) => { setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const selectAll = () => { setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map((inv: any) => inv.id))); };
  const getClientName = (cId: number) => clients.find((c: any) => c.id === cId)?.name || 'Unknown';

  const handleExport = async (format: 'xlsx' | 'csv') => {
    const selected = invoices.filter((inv: any) => selectedIds.has(inv.id));
    if (selected.length === 0) { alert('Select at least one invoice.'); return; }
    setExporting(true);
    try {
      // Convert API format to export format
      const exportData = selected.map((inv: any) => ({
        journal: inv.journal, reference: inv.reference, invoiceDate: inv.invoice_date,
        totalAmount: inv.total_amount, currency: inv.currency, currencyRate: inv.currency_rate,
        journalLines: (inv.journal_lines || []).map((l: any) => ({
          debitAccount: l.debit_account, creditAccount: l.credit_account, amount: l.amount,
          vatCode: l.vat_code, vatAmount: l.vat_amount, details: l.details,
          tAnalysis1: l.t_analysis_1, tAnalysis2: l.t_analysis_2, tAnalysis3: l.t_analysis_3,
          tAnalysis4: l.t_analysis_4, tAnalysis5: l.t_analysis_5,
        })),
      }));

      const fileName = `btms_import_${new Date().toISOString().slice(0, 10)}`;
      if (format === 'xlsx') generateExcel(exportData as any, fileName);
      else generateCSV(exportData as any, fileName);

      // Mark as exported
      await api.batchUpdateStatus(Array.from(selectedIds), 'exported');
      setLastExportCount(selected.length);
      await refreshInvoices();
      setSelectedIds(new Set());
    } finally { setExporting(false); }
  };

  return (
    <div className="export-page">
      <h2>Export to BTMS</h2>
      {lastExportCount > 0 && <div className="export-success">Exported {lastExportCount} invoice(s) and marked as exported.</div>}
      <div className="export-summary">
        <span>{invoices.filter((i: any) => i.status !== 'exported').length} invoice(s) ready to export</span>
        <span>{invoices.filter((i: any) => i.status === 'exported').length} already exported</span>
      </div>
      <div className="export-filters">
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchableSelect
            value={filterClient}
            onChange={(v) => setFilterClient(parseInt(String(v)) || 0)}
            options={[{ value: 0, label: 'All Clients' }, ...clients.map((c: any) => ({ value: c.id, label: c.name, sublabel: c.client_code || '' }))]}
            placeholder="All Clients"
          />
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="form-input">
          <option value="not-exported">Not Yet Exported</option>
          <option value="">All Statuses</option>
          <option value="draft">Draft Only</option>
          <option value="reviewed">Reviewed Only</option>
          <option value="exported">Already Exported</option>
        </select>
      </div>
      <div className="export-table-wrapper">
        <table className="export-table">
          <thead><tr><th><input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={selectAll} /></th><th>Invoice #</th><th>Client</th><th>Vendor</th><th>Date</th><th>Batch</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((inv: any) => (
              <tr key={inv.id} className={`${selectedIds.has(inv.id) ? 'selected' : ''} ${inv.status === 'exported' ? 'row-exported' : ''}`}>
                <td><input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)} /></td>
                <td>{inv.invoice_number || '-'}</td>
                <td>{inv.client_name || getClientName(inv.client_id)}</td>
                <td>{inv.vendor_name || '-'}</td>
                <td>{inv.invoice_date}</td>
                <td>{inv.batch_month}</td>
                <td>{(inv.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td><span className={`status-badge status-${inv.status}`}>{inv.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <div className="empty-state"><p>{filterStatus === 'not-exported' ? 'All invoices exported.' : 'No invoices match filters.'}</p></div>}
      <div className="export-actions">
        <p>{selectedIds.size} selected</p>
        <button className="btn btn-primary" onClick={() => handleExport('xlsx')} disabled={exporting || selectedIds.size === 0}>{exporting ? 'Exporting...' : 'Export Excel'}</button>
        <button className="btn btn-secondary" onClick={() => handleExport('csv')} disabled={exporting || selectedIds.size === 0}>Export CSV</button>
        {filterStatus === 'exported' && selectedIds.size > 0 && (
          <button className="btn btn-secondary" onClick={async () => { await api.batchUpdateStatus(Array.from(selectedIds), 'draft'); await refreshInvoices(); setSelectedIds(new Set()); }}>
            Un-export Selected ({selectedIds.size})
          </button>
        )}
      </div>
    </div>
  );
}
