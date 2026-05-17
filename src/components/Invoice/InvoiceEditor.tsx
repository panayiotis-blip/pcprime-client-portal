import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { JournalLine } from '../../types/invoice';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useScan, type ScannedInvoice } from '../../context/ScanContext';
import SearchableSelect from '../common/SearchableSelect';
import { Modal, Button, FormField, Input } from '../ui';

const emptyLine: JournalLine = {
  debitAccount: '', creditAccount: '', amount: 0,
  vatCode: '', vatAmount: 0, details: '',
  tAnalysis1: '', tAnalysis2: '', tAnalysis3: '', tAnalysis4: '', tAnalysis5: '',
};

export default function InvoiceEditor() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  const { clients, refreshInvoices, refreshClients } = useApp();
  const { scannedInvoices } = useScan();
  const [form, setForm] = useState<any>({
    client_id: 0, invoice_number: '', vendor_name: '', invoice_date: '', due_date: '',
    total_amount: 0, currency: '', currency_rate: '', raw_ocr_text: '', status: 'draft',
    journal: 'JV', reference: '', journal_lines: [{ ...emptyLine }],
  });
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const [journalTypes, setJournalTypes] = useState<any[]>([]);
  const [docCategories, setDocCategories] = useState<any[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string>('');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [vendorSuggestion, setVendorSuggestion] = useState<any>(null);
  const [patternApplied, setPatternApplied] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [clientOverride, setClientOverride] = useState(false);
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: '', tax_number: '', email: '', phone: '' });
  const [vendorBusy, setVendorBusy] = useState(false);

  const isBatch = location.state?.batch && scannedInvoices.current.length > 0;
  const totalInBatch = isBatch ? scannedInvoices.current.length : 0;

  // 5A — lock the client selector behind a read-only header when the client
  // is already known from context (existing invoice / batch scan / passed in).
  const clientFromContext = (!!id && id !== 'new') || isBatch || !!location.state?.clientId;
  const showClientSelector = !clientFromContext || clientOverride;

  // Prev/Next navigation among invoices
  const { invoices } = useApp();
  const clientInvoices = form.client_id
    ? invoices.filter((i: any) => i.client_id === form.client_id)
    : invoices;
  const currentIdx = id ? clientInvoices.findIndex((i: any) => i.id === parseInt(id)) : -1;
  const prevInvoice = currentIdx > 0 ? clientInvoices[currentIdx - 1] : null;
  const nextInvoice = currentIdx >= 0 && currentIdx < clientInvoices.length - 1 ? clientInvoices[currentIdx + 1] : null;
  const invoicePosition = currentIdx >= 0 ? `${currentIdx + 1} of ${clientInvoices.length}` : '';

  useEffect(() => { api.getJournalTypes().then(setJournalTypes).catch(() => {}); }, []);
  useEffect(() => { api.getDocumentCategories().then(setDocCategories).catch(() => {}); }, []);

  useEffect(() => {
    if (form.client_id) {
      api.getAccounts(form.client_id).then(setAccounts).catch(() => setAccounts([]));
    } else {
      setAccounts([]);
    }
  }, [form.client_id]);

  // Vendor pattern matching — suggest debit/credit/VAT based on past entries for this vendor
  useEffect(() => {
    if (form.client_id && form.vendor_name && form.vendor_name.length >= 3) {
      api.matchVendorPattern(form.client_id, form.vendor_name).then((pattern) => {
        if (pattern && !patternApplied) {
          // Only suggest if current line is blank
          const line = form.journal_lines?.[0];
          if (line && !line.debitAccount && !line.creditAccount) {
            setVendorSuggestion(pattern);
          } else {
            setVendorSuggestion(null);
          }
        } else {
          setVendorSuggestion(null);
        }
      }).catch(() => {});
    }
  }, [form.client_id, form.vendor_name]);

  const applyPattern = () => {
    if (!vendorSuggestion) return;
    setForm((prev: any) => {
      const lines = [...prev.journal_lines];
      if (lines[0]) {
        // Calculate vat_amount if we have rate and amount
        const rate = vendorSuggestion.vat_rate || 0;
        const total = lines[0].amount || prev.total_amount || 0;
        const vatAmount = rate > 0 ? Math.round((total / (1 + rate / 100)) * rate / 100 * 100) / 100 : lines[0].vatAmount;
        lines[0] = {
          ...lines[0],
          debitAccount: vendorSuggestion.debit_account || lines[0].debitAccount,
          creditAccount: vendorSuggestion.credit_account || lines[0].creditAccount,
          vatCode: vendorSuggestion.vat_code || lines[0].vatCode,
          vatAmount: vatAmount || lines[0].vatAmount,
          details: lines[0].details || vendorSuggestion.details_template || '',
        };
      }
      return {
        ...prev,
        journal: vendorSuggestion.journal_type || prev.journal,
        journal_lines: lines,
      };
    });
    setPatternApplied(true);
    setVendorSuggestion(null);
  };

  const loadScannedInvoice = (scan: ScannedInvoice) => {
    const details = scan.parsed.vendorName
      ? `${scan.parsed.vendorName}${scan.parsed.invoiceNumber ? ' - ' + scan.parsed.invoiceNumber : ''}`
      : scan.parsed.invoiceNumber || '';
    setForm({
      client_id: scan.clientId, journal: scan.journalCode,
      invoice_number: scan.parsed.invoiceNumber || '', vendor_name: scan.parsed.vendorName || '',
      invoice_date: scan.parsed.invoiceDate || '', due_date: scan.parsed.dueDate || '',
      total_amount: scan.parsed.totalAmount || 0, currency: scan.parsed.currency || '',
      currency_rate: '', raw_ocr_text: scan.rawOcrText || '', status: 'draft', reference: '',
      journal_lines: [{
        ...emptyLine, amount: scan.parsed.totalAmount || 0,
        vatAmount: scan.parsed.taxAmount || 0, details,
      }],
    });
    if (scan.fileBlob instanceof File) setFileToUpload(scan.fileBlob);
    else setFileToUpload(new File([scan.fileBlob], scan.fileName, { type: scan.mimeType }));
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(scan.fileBlob));
    setPreviewMime(scan.mimeType || scan.fileBlob.type || '');
  };

  useEffect(() => {
    if (isBatch) {
      loadScannedInvoice(scannedInvoices.current[batchIndex]);
    } else if (location.state?.parsed) {
      const { parsed, rawOcrText, journalCode, clientId: stateClientId } = location.state;
      const details = parsed.vendorName ? `${parsed.vendorName}${parsed.invoiceNumber ? ' - ' + parsed.invoiceNumber : ''}` : parsed.invoiceNumber || '';
      setForm({
        client_id: stateClientId || 0, journal: journalCode || 'JV',
        invoice_number: parsed.invoiceNumber || '', vendor_name: parsed.vendorName || '',
        invoice_date: parsed.invoiceDate || '', due_date: parsed.dueDate || '',
        total_amount: parsed.totalAmount || 0, currency: parsed.currency || '',
        currency_rate: '', raw_ocr_text: rawOcrText || '', status: 'draft', reference: '',
        journal_lines: [{ ...emptyLine, amount: parsed.totalAmount || 0, vatAmount: parsed.taxAmount || 0, details }],
      });
    } else if (location.state?.journalCode || location.state?.clientId) {
      setForm((prev: any) => ({ ...prev, journal: location.state?.journalCode || prev.journal, client_id: location.state?.clientId || prev.client_id }));
    } else if (id && id !== 'new') {
      api.getInvoice(parseInt(id)).then((inv) => {
        setForm({
          client_id: inv.client_id, invoice_number: inv.invoice_number, vendor_name: inv.vendor_name,
          invoice_date: inv.invoice_date, due_date: inv.due_date, total_amount: inv.total_amount,
          currency: inv.currency, currency_rate: inv.currency_rate, raw_ocr_text: inv.raw_ocr_text,
          status: inv.status, journal: inv.journal, reference: inv.reference,
          journal_lines: inv.journal_lines?.length ? inv.journal_lines.map((l: any) => ({
            debitAccount: l.debit_account, creditAccount: l.credit_account, amount: l.amount,
            vatCode: l.vat_code, vatAmount: l.vat_amount, details: l.details,
            tAnalysis1: l.t_analysis_1, tAnalysis2: l.t_analysis_2, tAnalysis3: l.t_analysis_3,
            tAnalysis4: l.t_analysis_4, tAnalysis5: l.t_analysis_5,
          })) : [{ ...emptyLine }],
        });
        if (inv.files?.length) {
          const f0 = inv.files[0];
          setPreviewMime(f0.mime_type || '');
          api.getInvoiceFileUrl(inv.id, f0.id).then((url: string) => setPreviewUrl(url)).catch(() => {});
        }
      });
    }
    return () => { if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl); };
  }, [id, batchIndex]);

  const handleChange = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const handleLineChange = (index: number, field: string, value: any) => {
    setForm((prev: any) => {
      const lines = [...prev.journal_lines];
      lines[index] = { ...lines[index], [field]: value };
      return { ...prev, journal_lines: lines };
    });
  };

  const addJournalLine = () => setForm((prev: any) => ({ ...prev, journal_lines: [...prev.journal_lines, { ...emptyLine }] }));
  const removeJournalLine = (i: number) => setForm((prev: any) => ({ ...prev, journal_lines: prev.journal_lines.filter((_: any, idx: number) => idx !== i) }));
  const duplicateJournalLine = (i: number) => setForm((prev: any) => { const lines = [...prev.journal_lines]; lines.splice(i + 1, 0, { ...lines[i] }); return { ...prev, journal_lines: lines }; });

  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    const { id: newId } = await api.createClient({ name: newClientName.trim() });
    await refreshClients();
    setForm((prev: any) => ({ ...prev, client_id: newId }));
    setNewClientName('');
    setShowNewClient(false);
  };

  // 6C — quick-create a vendor from the invoice editor and select it.
  const handleQuickCreateVendor = async () => {
    if (!vendorForm.name.trim()) { alert('Vendor name is required.'); return; }
    setVendorBusy(true);
    try {
      const row = await api.quickCreateVendor(vendorForm);
      await refreshClients();
      handleChange('vendor_name', row.name);
      setShowNewVendor(false);
    } catch (err: any) {
      alert('Could not create vendor: ' + err.message);
    } finally {
      setVendorBusy(false);
    }
  };

  const handleSave = async (status: string) => {
    setSaving(true);
    try {
      const data = {
        ...form, status,
        journal_lines: form.journal_lines.map((l: any) => ({
          debit_account: l.debitAccount, credit_account: l.creditAccount, amount: l.amount,
          vat_code: l.vatCode, vat_amount: l.vatAmount, details: l.details,
          t_analysis_1: l.tAnalysis1, t_analysis_2: l.tAnalysis2, t_analysis_3: l.tAnalysis3,
          t_analysis_4: l.tAnalysis4, t_analysis_5: l.tAnalysis5,
        })),
      };
      if (id && id !== 'new') {
        await api.updateInvoice(parseInt(id), data);
      } else {
        await api.createInvoice(data, fileToUpload || undefined);
      }
      await refreshInvoices();
      if (isBatch && batchIndex < totalInBatch - 1) { setBatchIndex((p) => p + 1); setSaving(false); window.scrollTo(0, 0); return; }
      navigate('/invoices');
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    if (isBatch && batchIndex < totalInBatch - 1) { setBatchIndex((p) => p + 1); window.scrollTo(0, 0); }
    else navigate('/invoices');
  };

  const accountOptions = accounts.map((acc: any) => ({ value: acc.code, label: acc.code, sublabel: acc.description }));

  // 5B — Due Date visibility is driven by the matching document category.
  const dueDateCat = docCategories.find((c: any) => c.journal_code && c.journal_code === form.journal);
  const showDueDate = dueDateCat ? !!dueDateCat.show_due_date : true;
  // 5A — the client shown in the read-only header.
  const ctxClient = clients.find((c: any) => c.id === form.client_id);
  // 5D — vendor / customer dropdown. Purchase invoices list vendor-flagged
  // clients; everything else lists active clients. The current value is kept
  // selectable even if it isn't a saved client (legacy free-text invoices).
  const isPurchase = form.journal === 'INP';
  const vendorPool = isPurchase
    ? clients.filter((c: any) => c.is_vendor)
    : clients.filter((c: any) => c.is_active !== false);
  const vendorOptions: { value: any; label: string; sublabel?: string }[] =
    vendorPool.map((c: any) => ({ value: c.name, label: c.name, sublabel: c.client_code || '' }));
  if (form.vendor_name && !vendorOptions.some((o) => o.value === form.vendor_name)) {
    vendorOptions.unshift({ value: form.vendor_name, label: form.vendor_name, sublabel: '(not a saved client)' });
  }

  return (
    <div className="editor-layout">
      {previewUrl && (
        <div className="editor-preview">
          <div className="preview-header">
            <h3>Invoice Preview</h3>
          </div>
          <div className="preview-content">
            {(() => {
              const mime = fileToUpload?.type || previewMime || '';
              return mime === 'application/pdf' || mime.startsWith('application/')
                ? <iframe src={previewUrl} className="preview-pdf" title="Invoice PDF" />
                : <img src={previewUrl} alt="Invoice" className="preview-img" />;
            })()}
          </div>
        </div>
      )}

      <div className="editor-form">
        <div className="editor-header">
          <h2>{id && id !== 'new' ? 'Edit Invoice' : 'New Invoice'}</h2>
          {isBatch && <span className="batch-indicator">Invoice {batchIndex + 1} of {totalInBatch}</span>}
        </div>

        {/* Sticky action bar (Part 5E) — always in view while scrolling */}
        <div className="editor-actions-bar no-print">
          {isBatch && <button className="btn btn-secondary" onClick={handleSkip}>Skip {batchIndex < totalInBatch - 1 ? 'to Next' : '& Finish'}</button>}
          <button className="btn btn-secondary" onClick={() => navigate('/invoices')}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleSave('draft')} disabled={saving}>{saving ? 'Saving...' : isBatch && batchIndex < totalInBatch - 1 ? 'Save & Next' : 'Save as Draft'}</button>
          <button className="btn btn-success" onClick={() => handleSave('reviewed')} disabled={saving}>{isBatch && batchIndex < totalInBatch - 1 ? 'Review & Next' : 'Mark as Reviewed'}</button>
        </div>

        {/* Prev / Next navigation */}
        {id && id !== 'new' && (
          <div className="invoice-nav">
            <button
              className="btn btn-secondary btn-sm"
              disabled={!prevInvoice}
              onClick={() => prevInvoice && navigate(`/invoices/${prevInvoice.id}`)}
            >
              ← Previous
            </button>
            <span className="invoice-nav-info">
              {invoicePosition && `Invoice ${invoicePosition}`}
              {form.invoice_number && ` — #${form.invoice_number}`}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!nextInvoice}
              onClick={() => nextInvoice && navigate(`/invoices/${nextInvoice.id}`)}
            >
              Next →
            </button>
          </div>
        )}

        <div className="form-section">
          <h3>Client</h3>
          {showClientSelector ? (
            <>
              <div className="form-row">
                <div style={{ flex: 1 }}>
                  <SearchableSelect
                    value={form.client_id}
                    onChange={(v) => handleChange('client_id', parseInt(String(v)) || 0)}
                    options={clients.map((c: any) => ({ value: c.id, label: c.name, sublabel: c.client_code || c.tax_number || '' }))}
                    placeholder="-- Select Client --"
                  />
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewClient(!showNewClient)}>+ New Client</button>
              </div>
              {showNewClient && (
                <div className="form-row" style={{ marginTop: 8 }}>
                  <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Client name" className="form-input" />
                  <button className="btn btn-primary btn-sm" onClick={handleAddClient}>Add</button>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15 }}>
                <strong>{ctxClient?.name || `Client #${form.client_id}`}</strong>
                {ctxClient?.client_code && (
                  <span style={{ color: 'var(--pc-text-2)', marginLeft: 8 }}>{ctxClient.client_code}</span>
                )}
              </span>
              <button className="btn btn-link btn-sm" onClick={() => setClientOverride(true)}>Change client</button>
            </div>
          )}
        </div>

        {vendorSuggestion && (
          <div className="vendor-suggestion card">
            <div className="vs-icon">💡</div>
            <div className="vs-body">
              <strong>Pattern found for "{vendorSuggestion.vendor_name_original}"</strong>
              <p>Used {vendorSuggestion.match_count} time(s). Auto-fill: Debit <code>{vendorSuggestion.debit_account}</code>, Credit <code>{vendorSuggestion.credit_account}</code>{vendorSuggestion.vat_code ? `, VAT ${vendorSuggestion.vat_code}` : ''}{vendorSuggestion.vat_rate ? ` (${vendorSuggestion.vat_rate}%)` : ''}</p>
            </div>
            <div className="vs-actions">
              <button className="btn btn-primary btn-sm" onClick={applyPattern}>Apply</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setVendorSuggestion(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <div className="form-section">
          <h3>Invoice Details</h3>
          <div className="form-grid">
            <div className="form-group"><label>Journal</label>
              <select value={form.journal} onChange={(e) => handleChange('journal', e.target.value)} className="form-input">
                {journalTypes.map((jt: any) => <option key={jt.id} value={jt.code}>{jt.code} - {jt.label}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Invoice Number / Reference</label><input type="text" value={form.invoice_number} onChange={(e) => handleChange('invoice_number', e.target.value)} className="form-input" /></div>
            <div className="form-group">
              <label>{isPurchase ? 'Vendor' : 'Vendor / Customer'}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <SearchableSelect
                    value={form.vendor_name}
                    onChange={(v) => handleChange('vendor_name', String(v || ''))}
                    options={vendorOptions}
                    placeholder={isPurchase ? 'Select vendor…' : 'Select client…'}
                    allowClear
                  />
                </div>
                {isPurchase && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setVendorForm({ name: '', tax_number: '', email: '', phone: '' }); setShowNewVendor(true); }}
                  >
                    + New
                  </button>
                )}
              </div>
            </div>
            <div className="form-group"><label>Date (DD/MM/YYYY)</label><input type="text" value={form.invoice_date} onChange={(e) => handleChange('invoice_date', e.target.value)} className="form-input" placeholder="DD/MM/YYYY" /></div>
            {showDueDate && (
              <div className="form-group"><label>Due Date</label><input type="text" value={form.due_date} onChange={(e) => handleChange('due_date', e.target.value)} className="form-input" placeholder="DD/MM/YYYY" /></div>
            )}
            <div className="form-group"><label>Total Amount</label><input type="number" step="0.01" value={form.total_amount} onChange={(e) => handleChange('total_amount', parseFloat(e.target.value) || 0)} className="form-input" /></div>
            <div className="form-group"><label>Currency</label><input type="text" value={form.currency} onChange={(e) => handleChange('currency', e.target.value)} className="form-input" /></div>
            <div className="form-group"><label>Currency Rate</label><input type="text" value={form.currency_rate} onChange={(e) => handleChange('currency_rate', e.target.value)} className="form-input" /></div>
          </div>
        </div>

        <div className="form-section">
          <div className="section-header">
            <h3>Journal Entry</h3>
            {!showSplit && form.journal_lines.length <= 1 && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSplit(true)}>⇅ Split Lines / VAT</button>
            )}
            {showSplit && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={() => addJournalLine()}>+ Debit Line</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setForm((prev: any) => ({ ...prev, journal_lines: [...prev.journal_lines, { ...emptyLine, creditAccount: prev.journal_lines[prev.journal_lines.length - 1]?.creditAccount || '' }] })); }}>+ Credit Line</button>
                <button className="btn btn-secondary btn-sm" title="Auto-create VAT split template" onClick={() => {
                  const total = form.total_amount || 0;
                  setForm((prev: any) => ({
                    ...prev,
                    journal_lines: [
                      { ...emptyLine, details: 'Standard rate', amount: 0, vatCode: 'S1', vatAmount: 0 },
                      { ...emptyLine, details: 'Reduced rate', amount: 0, vatCode: 'S2', vatAmount: 0 },
                      { ...emptyLine, details: 'Zero rate', amount: 0, vatCode: 'Z', vatAmount: 0 },
                      { ...emptyLine, creditAccount: prev.journal_lines[0]?.creditAccount || '', amount: total || 0, details: `Total — ${prev.vendor_name || ''}` },
                    ],
                  }));
                }}>⇅ VAT Template</button>
              </div>
            )}
          </div>

          {/* Simple single-line view (default) */}
          {!showSplit && form.journal_lines.length <= 1 && (() => {
            const line = form.journal_lines[0] || emptyLine;
            const i = 0;
            return (
              <div className="form-grid">
                <div className="form-group">
                  <label>Debit Account</label>
                  {accounts.length > 0 ? (
                    <SearchableSelect value={line.debitAccount} onChange={(v) => handleLineChange(i, 'debitAccount', String(v))} options={accountOptions} placeholder="Debit account" allowClear />
                  ) : (
                    <input type="text" value={line.debitAccount} onChange={(e) => handleLineChange(i, 'debitAccount', e.target.value)} className="form-input" placeholder="Account code" />
                  )}
                </div>
                <div className="form-group">
                  <label>Credit Account</label>
                  {accounts.length > 0 ? (
                    <SearchableSelect value={line.creditAccount} onChange={(v) => handleLineChange(i, 'creditAccount', String(v))} options={accountOptions} placeholder="Credit account" allowClear />
                  ) : (
                    <input type="text" value={line.creditAccount} onChange={(e) => handleLineChange(i, 'creditAccount', e.target.value)} className="form-input" placeholder="Account code" />
                  )}
                </div>
                <div className="form-group"><label>Amount</label><input type="number" step="0.01" value={line.amount} onChange={(e) => handleLineChange(i, 'amount', parseFloat(e.target.value) || 0)} className="form-input" /></div>
                <div className="form-group"><label>VAT Code</label><input type="text" value={line.vatCode} onChange={(e) => handleLineChange(i, 'vatCode', e.target.value)} className="form-input" /></div>
                <div className="form-group"><label>VAT Amount</label><input type="number" step="0.01" value={line.vatAmount} onChange={(e) => handleLineChange(i, 'vatAmount', parseFloat(e.target.value) || 0)} className="form-input" /></div>
                <div className="form-group full-width"><label>Details</label><input type="text" value={line.details} onChange={(e) => handleLineChange(i, 'details', e.target.value)} className="form-input" /></div>
              </div>
            );
          })()}

          {/* Split multi-line view */}
          {(showSplit || form.journal_lines.length > 1) && (<>
            {/* Debit lines */}
            <div className="jl-section">
              <div className="jl-section-label debit-label">DEBIT</div>
              {form.journal_lines.filter((l: any) => !l.creditAccount || l.debitAccount).map((line: any) => {
                const i = form.journal_lines.indexOf(line);
                return (
                  <div key={i} className="journal-line jl-debit" style={{ marginBottom: 8 }}>
                    <div className="jl-row">
                      <div className="jl-field jl-account">
                        <label>Account</label>
                        {accounts.length > 0 ? (
                          <SearchableSelect value={line.debitAccount} onChange={(v) => handleLineChange(i, 'debitAccount', String(v))} options={accountOptions} placeholder="Debit account" allowClear />
                        ) : (
                          <input type="text" value={line.debitAccount} onChange={(e) => handleLineChange(i, 'debitAccount', e.target.value)} className="form-input" />
                        )}
                      </div>
                      <div className="jl-field jl-amount"><label>Net</label><input type="number" step="0.01" value={line.amount} onChange={(e) => handleLineChange(i, 'amount', parseFloat(e.target.value) || 0)} className="form-input" /></div>
                      <div className="jl-field jl-vat-code"><label>VAT</label><input type="text" value={line.vatCode} onChange={(e) => handleLineChange(i, 'vatCode', e.target.value)} className="form-input" placeholder="S1" /></div>
                      <div className="jl-field jl-vat-amt"><label>VAT Amt</label><input type="number" step="0.01" value={line.vatAmount} onChange={(e) => handleLineChange(i, 'vatAmount', parseFloat(e.target.value) || 0)} className="form-input" /></div>
                      <div className="jl-field jl-line-total"><label>Total</label><div className="jl-computed">{((line.amount || 0) + (line.vatAmount || 0)).toFixed(2)}</div></div>
                      <div className="jl-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => duplicateJournalLine(i)} title="Duplicate">⧉</button>
                        {form.journal_lines.length > 1 && <button className="btn btn-danger btn-sm" onClick={() => removeJournalLine(i)}>×</button>}
                      </div>
                    </div>
                    <div className="jl-row-details">
                      <div className="jl-field" style={{ flex: 1 }}><label>Details</label><input type="text" value={line.details} onChange={(e) => handleLineChange(i, 'details', e.target.value)} className="form-input" /></div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Credit lines */}
            <div className="jl-section">
              <div className="jl-section-label credit-label">CREDIT</div>
              {form.journal_lines.filter((l: any) => l.creditAccount && !l.debitAccount).map((line: any) => {
                const i = form.journal_lines.indexOf(line);
                return (
                  <div key={i} className="journal-line jl-credit" style={{ marginBottom: 8 }}>
                    <div className="jl-row">
                      <div className="jl-field jl-account"><label>Account</label>
                        {accounts.length > 0 ? (
                          <SearchableSelect value={line.creditAccount} onChange={(v) => handleLineChange(i, 'creditAccount', String(v))} options={accountOptions} placeholder="Credit account" allowClear />
                        ) : (
                          <input type="text" value={line.creditAccount} onChange={(e) => handleLineChange(i, 'creditAccount', e.target.value)} className="form-input" />
                        )}
                      </div>
                      <div className="jl-field jl-amount"><label>Amount</label><input type="number" step="0.01" value={line.amount} onChange={(e) => handleLineChange(i, 'amount', parseFloat(e.target.value) || 0)} className="form-input" /></div>
                      <div className="jl-field" style={{ flex: 1 }}><label>Details</label><input type="text" value={line.details} onChange={(e) => handleLineChange(i, 'details', e.target.value)} className="form-input" /></div>
                      <div className="jl-actions">{form.journal_lines.length > 1 && <button className="btn btn-danger btn-sm" onClick={() => removeJournalLine(i)}>×</button>}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Balance check */}
            {(() => {
              const totalDebit = form.journal_lines.reduce((s: number, l: any) => s + (l.debitAccount && !l.creditAccount ? (l.amount || 0) + (l.vatAmount || 0) : 0), 0);
              const totalCredit = form.journal_lines.reduce((s: number, l: any) => s + (l.creditAccount && !l.debitAccount ? (l.amount || 0) : 0), 0);
              const diff = Math.abs(totalDebit - totalCredit);
              const balanced = diff < 0.01;
              return (
                <div className={`jl-balance ${balanced ? 'jl-balanced' : 'jl-unbalanced'}`}>
                  <span>Debits: <strong>{totalDebit.toFixed(2)}</strong></span>
                  <span>Credits: <strong>{totalCredit.toFixed(2)}</strong></span>
                  {balanced ? <span className="jl-check">✓ Balanced</span> : <span className="jl-check">⚠ Diff: {diff.toFixed(2)}</span>}
                </div>
              );
            })()}
            <button className="btn btn-link btn-sm" onClick={() => { if (form.journal_lines.length <= 1) setShowSplit(false); }} style={{ marginTop: 8 }}>
              {form.journal_lines.length <= 1 ? '← Back to simple view' : ''}
            </button>
          </>)}
        </div>

        {form.raw_ocr_text && <div className="form-section"><h3>Extracted Text</h3><pre className="ocr-text">{form.raw_ocr_text}</pre></div>}

        {/* 6C — quick-create vendor */}
        <Modal
          open={showNewVendor}
          onClose={() => setShowNewVendor(false)}
          title="Add new vendor"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowNewVendor(false)} disabled={vendorBusy}>Cancel</Button>
              <Button variant="primary" onClick={handleQuickCreateVendor} disabled={vendorBusy}>
                {vendorBusy ? 'Creating…' : 'Create vendor'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="Name" required>
              <Input
                value={vendorForm.name}
                onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Vendor / supplier name"
                autoFocus
              />
            </FormField>
            <FormField label="VAT / TIC">
              <Input value={vendorForm.tax_number} onChange={(e) => setVendorForm((f) => ({ ...f, tax_number: e.target.value }))} />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={vendorForm.email} onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))} />
            </FormField>
            <FormField label="Phone">
              <Input value={vendorForm.phone} onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))} />
            </FormField>
          </div>
          <p style={{ fontSize: 12, color: 'var(--pc-text-2)', margin: '12px 0 0' }}>
            Creates a vendor-only client. More detail can be added later from the Clients page.
          </p>
        </Modal>
      </div>
    </div>
  );
}
