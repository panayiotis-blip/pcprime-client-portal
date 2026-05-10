import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from './FileUpload';
import CameraCapture from './CameraCapture';
import { recognizeImage } from '../../services/ocr/ocrService';
import { extractPdfText, renderPdfToImages, getPdfPageCount, renderPdfPageToJpegBlob } from '../../services/ocr/pdfRenderer';
import { parseInvoiceText } from '../../services/ocr/invoiceParser';
import { type ScannedInvoice } from '../../context/ScanContext';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import SearchableSelect from '../common/SearchableSelect';

export default function ScannerPage() {
  const navigate = useNavigate();
  const { clients, refreshClients, refreshInvoices } = useApp();
  const [showCamera, setShowCamera] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Per-file metadata: page count for PDFs + whether the user wants to split
  // a multi-page PDF into one invoice per page. Map keyed by File identity
  // (which is stable for the lifetime of a picked file).
  const [fileMeta, setFileMeta] = useState<Map<File, { pageCount: number | null; splitMode: boolean }>>(new Map());
  const [journalCode, setJournalCode] = useState('INP');
  const [clientId, setClientId] = useState<number>(0);
  const [journalTypes, setJournalTypes] = useState<any[]>([]);
  const [showAddType, setShowAddType] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  useEffect(() => {
    api.getJournalTypes().then(setJournalTypes).catch(() => {});
  }, []);

  const handleAddJournalType = async () => {
    if (!newCode.trim() || !newLabel.trim()) return;
    await api.createJournalType({ code: newCode.trim().toUpperCase(), label: newLabel.trim(), client_id: 0 });
    setJournalTypes(await api.getJournalTypes());
    setNewCode('');
    setNewLabel('');
    setShowAddType(false);
  };

  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    const { id } = await api.createClient({ name: newClientName.trim() });
    await refreshClients();
    setClientId(id);
    setNewClientName('');
    setShowNewClient(false);
  };

  const handleFilesSelect = (files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files]);
    // Add placeholder meta immediately so the UI can show "checking pages..."
    setFileMeta((prev) => {
      const next = new Map(prev);
      for (const f of files) if (!next.has(f)) next.set(f, { pageCount: null, splitMode: true });
      return next;
    });
    // Async: compute page counts for PDFs (other types are 1 page).
    files.forEach(async (file) => {
      let pages = 1;
      if (file.type === 'application/pdf') {
        try { pages = await getPdfPageCount(file); } catch { pages = 1; }
      }
      setFileMeta((prev) => {
        const next = new Map(prev);
        if (next.has(file)) next.set(file, { pageCount: pages, splitMode: pages > 1 });
        return next;
      });
    });
  };

  const removeFile = (index: number) => {
    const file = selectedFiles[index];
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFileMeta((prev) => {
      const next = new Map(prev);
      next.delete(file);
      return next;
    });
  };

  const handleCameraCapture = (blob: Blob) => {
    const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
    setSelectedFiles((prev) => [...prev, file]);
    setFileMeta((prev) => {
      const next = new Map(prev);
      next.set(file, { pageCount: 1, splitMode: false });
      return next;
    });
    setShowCamera(false);
  };

  const toggleSplitMode = (file: File) => {
    setFileMeta((prev) => {
      const next = new Map(prev);
      const meta = next.get(file);
      if (meta) next.set(file, { ...meta, splitMode: !meta.splitMode });
      return next;
    });
  };

  const scanSingleFile = async (file: File): Promise<{ text: string; confidence: number }> => {
    if (file.type === 'application/pdf') {
      try {
        const text = await extractPdfText(file);
        if (text && text.replace(/\s/g, '').length >= 20) {
          return { text, confidence: 95 };
        }
      } catch (err) {
        console.warn('Direct PDF text extraction failed:', err);
      }
      const canvases = await renderPdfToImages(file);
      let fullText = '';
      let totalConfidence = 0;
      for (const canvas of canvases) {
        const result = await recognizeImage(canvas);
        fullText += result.text + '\n';
        totalConfidence += result.confidence;
      }
      return { text: fullText, confidence: totalConfidence / (canvases.length || 1) };
    } else {
      const result = await recognizeImage(file);
      return { text: result.text, confidence: result.confidence };
    }
  };

  const handleScanAll = async () => {
    if (selectedFiles.length === 0) return;
    if (!clientId) {
      alert('Please select a client before scanning.');
      return;
    }
    setScanning(true);

    // First, expand any multi-page PDFs that the user wants split into per-page jobs.
    // Each job becomes one invoice.
    type Job = { file: File; displayName: string };
    const jobs: Job[] = [];
    for (const file of selectedFiles) {
      const meta = fileMeta.get(file);
      const shouldSplit = file.type === 'application/pdf' && meta?.pageCount && meta.pageCount > 1 && meta.splitMode;
      if (shouldSplit) {
        const baseName = file.name.replace(/\.pdf$/i, '');
        for (let pageNum = 1; pageNum <= (meta.pageCount as number); pageNum++) {
          setStatusText(`Splitting ${file.name}: page ${pageNum} of ${meta.pageCount}…`);
          try {
            const blob = await renderPdfPageToJpegBlob(file, pageNum);
            const pageFile = new File([blob], `${baseName}-page-${pageNum}.jpg`, { type: 'image/jpeg' });
            jobs.push({ file: pageFile, displayName: `${file.name} (page ${pageNum})` });
          } catch (err) {
            console.warn(`Failed to render ${file.name} page ${pageNum}:`, err);
          }
        }
      } else {
        jobs.push({ file, displayName: file.name });
      }
    }

    const results: ScannedInvoice[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const { file, displayName } = jobs[i];
      setStatusText(`Scanning ${i + 1} of ${jobs.length}: ${displayName}`);
      try {
        const { text, confidence } = await scanSingleFile(file);
        const parsed = parseInvoiceText(text);
        results.push({
          fileBlob: file, fileName: file.name, mimeType: file.type,
          parsed, rawOcrText: text, confidence, journalCode, clientId,
        });
      } catch (err) {
        console.error(`Failed to scan ${file.name}:`, err);
        results.push({
          fileBlob: file, fileName: file.name, mimeType: file.type,
          parsed: { invoiceNumber: '', vendorName: '', invoiceDate: '', dueDate: '', subtotal: 0, taxAmount: 0, totalAmount: 0, currency: '', lineItems: [], details: '' },
          rawOcrText: '', confidence: 0, journalCode, clientId,
        });
      }
    }

    // Auto-save all scanned invoices as drafts
    setStatusText('Saving invoices...');
    let savedCount = 0;
    const failures: { name: string; reason: string }[] = [];
    for (const scan of results) {
      try {
        const details = scan.parsed.vendorName
          ? `${scan.parsed.vendorName}${scan.parsed.invoiceNumber ? ' - ' + scan.parsed.invoiceNumber : ''}`
          : scan.parsed.invoiceNumber || '';
        const data = {
          client_id: scan.clientId,
          invoice_number: scan.parsed.invoiceNumber || '',
          vendor_name: scan.parsed.vendorName || '',
          invoice_date: scan.parsed.invoiceDate || '',
          due_date: scan.parsed.dueDate || '',
          total_amount: scan.parsed.totalAmount || 0,
          currency: scan.parsed.currency || '',
          currency_rate: '',
          raw_ocr_text: scan.rawOcrText || '',
          status: 'draft',
          journal: scan.journalCode,
          reference: '',
          journal_lines: [{
            debit_account: '', credit_account: '', amount: scan.parsed.totalAmount || 0,
            vat_code: '', vat_amount: scan.parsed.taxAmount || 0, details,
            t_analysis_1: '', t_analysis_2: '', t_analysis_3: '', t_analysis_4: '', t_analysis_5: '',
          }],
        };
        const file = scan.fileBlob instanceof File
          ? scan.fileBlob
          : new File([scan.fileBlob], scan.fileName, { type: scan.mimeType });
        await api.createInvoice(data, file);
        savedCount++;
      } catch (err: any) {
        console.error('Failed to save invoice:', err);
        failures.push({ name: scan.fileName, reason: err?.message || String(err) });
      }
    }

    setScanning(false);
    setStatusText('');
    setSelectedFiles([]);
    await refreshInvoices();
    let msg = `${savedCount} invoice(s) scanned and saved as drafts. You can now edit and correct them.`;
    if (failures.length) {
      msg += `\n\n${failures.length} file(s) failed:\n` +
             failures.map(f => `  • ${f.name}: ${f.reason}`).join('\n');
    }
    alert(msg);
    if (savedCount > 0) navigate('/invoices');
  };

  return (
    <div className="scanner-page">
      <h2>Scan Invoices</h2>

      {/* Step 1: Select Client */}
      <div className="form-section">
        <h3>1. Select Client</h3>
        <div className="form-row">
          <div style={{ flex: 1 }}>
            <SearchableSelect
              value={clientId}
              onChange={(v) => setClientId(parseInt(String(v)) || 0)}
              options={clients.map((c: any) => ({ value: c.id, label: c.name, sublabel: c.client_code || c.tax_number || '' }))}
              placeholder="-- Select Client --"
            />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowNewClient(!showNewClient)}>
            + New Client
          </button>
        </div>
        {showNewClient && (
          <div className="form-row" style={{ marginTop: 8 }}>
            <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Client name" className="form-input" />
            <button className="btn btn-primary btn-sm" onClick={handleAddClient}>Add</button>
          </div>
        )}
      </div>

      {/* Step 2: Transaction Type */}
      <div className="form-section">
        <h3>2. Transaction Type</h3>
        <div className="journal-type-grid">
          {journalTypes.map((jt) => (
            <button key={jt.code} className={`journal-type-btn ${journalCode === jt.code ? 'active' : ''}`} onClick={() => setJournalCode(jt.code)}>
              <span className="jt-code">{jt.code}</span>
              <span className="jt-label">{jt.label}</span>
            </button>
          ))}
          <button className="journal-type-btn add-type-btn" onClick={() => setShowAddType(!showAddType)}>
            <span className="jt-code">+</span>
            <span className="jt-label">Add Type</span>
          </button>
        </div>
        {showAddType && (
          <div className="add-type-form">
            <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Code (e.g. REC)" className="form-input" maxLength={5} />
            <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (e.g. Receipt)" className="form-input" />
            <button className="btn btn-primary btn-sm" onClick={handleAddJournalType}>Add</button>
          </div>
        )}
      </div>

      {/* Step 3: Upload Files */}
      <div className="form-section">
        <h3>3. Upload Invoices</h3>
        {showCamera ? (
          <CameraCapture onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
        ) : (
          <>
            <FileUpload onFilesSelect={handleFilesSelect} multiple={true} />
            <div className="scanner-or"><span>or</span></div>
            <button className="btn btn-secondary btn-camera" onClick={() => setShowCamera(true)}>Use Camera</button>
          </>
        )}
      </div>

      {/* File list */}
      {selectedFiles.length > 0 && (
        <div className="file-list">
          <h3>{selectedFiles.length} file(s) selected</h3>
          {selectedFiles.map((file, i) => {
            const meta = fileMeta.get(file);
            const pages = meta?.pageCount;
            const isMultiPagePdf = file.type === 'application/pdf' && pages !== null && (pages || 0) > 1;
            return (
              <div key={i} className="file-list-item" style={{ flexWrap: 'wrap' }}>
                <span className="file-name">{file.name}</span>
                <span className="file-size">{(file.size / 1024).toFixed(0)} KB</span>
                {file.type === 'application/pdf' && pages === null && (
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>checking pages…</span>
                )}
                {isMultiPagePdf && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', marginLeft: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!meta?.splitMode}
                      onChange={() => toggleSplitMode(file)}
                    />
                    Split {pages} pages → {pages} invoices
                  </label>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => removeFile(i)}>X</button>
              </div>
            );
          })}
        </div>
      )}

      {selectedFiles.length > 0 && !showCamera && (
        <button className="btn btn-primary btn-scan" onClick={handleScanAll} disabled={scanning}>
          {scanning ? statusText || 'Scanning...' : `Scan ${selectedFiles.length} Invoice(s)`}
        </button>
      )}

      {scanning && (
        <div className="progress-bar">
          <div className="progress-fill progress-indeterminate" />
        </div>
      )}

      <div className="manual-entry">
        <button className="btn btn-link" onClick={() => navigate('/invoices/new', { state: { journalCode, clientId } })}>
          Or enter invoice details manually
        </button>
      </div>
    </div>
  );
}
