import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from './FileUpload';
import CameraCapture from './CameraCapture';
import { recognizeImage } from '../../services/ocr/ocrService';
import { extractPdfText, renderPdfToImages } from '../../services/ocr/pdfRenderer';
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
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCameraCapture = (blob: Blob) => {
    const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
    setSelectedFiles((prev) => [...prev, file]);
    setShowCamera(false);
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

    const results: ScannedInvoice[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setStatusText(`Scanning file ${i + 1} of ${selectedFiles.length}: ${file.name}`);
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
      } catch (err) {
        console.error('Failed to save invoice:', err);
      }
    }

    setScanning(false);
    setStatusText('');
    setSelectedFiles([]);
    await refreshInvoices();
    alert(`${savedCount} invoice(s) scanned and saved as drafts. You can now edit and correct them.`);
    navigate('/invoices');
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
          {selectedFiles.map((file, i) => (
            <div key={i} className="file-list-item">
              <span className="file-name">{file.name}</span>
              <span className="file-size">{(file.size / 1024).toFixed(0)} KB</span>
              <button className="btn btn-danger btn-sm" onClick={() => removeFile(i)}>X</button>
            </div>
          ))}
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
