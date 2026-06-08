import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from './FileUpload';
import CameraCapture from './CameraCapture';
import { recognizeImage } from '../../services/ocr/ocrService';
import { extractPdfText, renderPdfToImages, getPdfPageCount, renderPdfPageToJpegBlob, fileToAiImageParts, MAX_OCR_PAGES } from '../../services/ocr/pdfRenderer';
import { parseInvoiceText, type ParsedInvoice } from '../../services/ocr/invoiceParser';
import { useScan, type ScannedInvoice } from '../../context/ScanContext';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import SearchableSelect from '../common/SearchableSelect';

// Map Claude's structured output onto the ParsedInvoice the review screen uses.
function aiToParsed(ai: Record<string, any>): ParsedInvoice {
  return {
    invoiceNumber: ai.invoice_number || '',
    vendorName:    ai.vendor_name || '',
    invoiceDate:   ai.invoice_date || '',
    dueDate:       ai.due_date || '',
    subtotal:      Number(ai.subtotal || 0),
    taxAmount:     Number(ai.vat_amount || 0),
    totalAmount:   Number(ai.total_amount || 0),
    currency:      ai.currency || '',
    lineItems:     Array.isArray(ai.line_items) ? ai.line_items.map((li: any) => ({
      description: li.description || '',
      quantity:    li.quantity != null ? Number(li.quantity) : undefined,
      unitPrice:   li.unit_price != null ? Number(li.unit_price) : undefined,
      amount:      Number(li.amount || 0),
    })) : [],
    details: '',
  };
}

// One row of the document_categories master list (migration 050).
type DocCategory = {
  id: number;
  name: string;
  code: string | null;
  target_folder: string;
  ocr_enabled: boolean;
  journal_code: string | null;
};

// When `lockedClientId` is provided, the client picker UI is hidden and the
// scan is filed against that client (used by the client-portal MyScan page).
export default function ScannerPage({ lockedClientId }: { lockedClientId?: number } = {}) {
  const navigate = useNavigate();
  const { clients, refreshClients } = useApp();
  const { scannedInvoices } = useScan();
  const [showCamera, setShowCamera] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Per-file metadata: page count for PDFs + whether to split a multi-page PDF
  // into one invoice per page. Keyed by File identity (stable per picked file).
  const [fileMeta, setFileMeta] = useState<Map<File, { pageCount: number | null; splitMode: boolean }>>(new Map());
  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number>(0);
  const [clientId, setClientId] = useState<number>(lockedClientId ?? 0);
  const isClientLocked = lockedClientId != null && lockedClientId > 0;
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [notes, setNotes] = useState('');
  // Branch B confirmation state — set once documents have been filed.
  const [done, setDone] = useState<{ count: number; folder: string; client: string } | null>(null);
  // Bulk batch progress — one row per job (post-split). Drives the inline
  // panel that shows queued / scanning / done / failed / cancelled for each
  // file as the batch runs.
  type BatchStatus = 'queued' | 'scanning' | 'done' | 'failed' | 'cancelled';
  // Cancellation flag — useRef so the running loop sees the new value
  // immediately (state setters are batched and async; the loop body would
  // otherwise capture the initial value). `cancelling` state mirrors the
  // ref only so the Cancel button can re-render to its "Cancelling…" label.
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  type BatchRow = {
    name: string;
    status: BatchStatus;
    vendor?: string;
    total?: number;
    confidence?: number;
    error?: string;
  };
  const [batchProgress, setBatchProgress] = useState<BatchRow[]>([]);

  useEffect(() => {
    api.getDocumentCategories()
      .then((rows) => {
        setCategories(rows as DocCategory[]);
        if (rows.length > 0) setCategoryId((rows[0] as DocCategory).id);
      })
      .catch(() => {});
  }, []);

  // Keep the local clientId in sync if the lockedClientId prop arrives /
  // changes after the first render (e.g. client portal loads user lazily).
  useEffect(() => {
    if (lockedClientId != null && lockedClientId > 0) setClientId(lockedClientId);
  }, [lockedClientId]);

  const category = categories.find((c) => c.id === categoryId) || null;
  const isOcr = !!category?.ocr_enabled;

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
    setFileMeta((prev) => {
      const next = new Map(prev);
      for (const f of files) if (!next.has(f)) next.set(f, { pageCount: null, splitMode: true });
      return next;
    });
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

  const resetAfterDone = () => {
    setSelectedFiles([]);
    setFileMeta(new Map());
    setNotes('');
    setDone(null);
  };

  // Branch A — OCR every file, then hand off to the Edit Invoice screen in
  // batch-review mode so the user checks each extraction before saving.
  const runOcrBranch = async (cat: DocCategory) => {
    type Job = { file: File; displayName: string };
    const jobs: Job[] = [];
    for (const file of selectedFiles) {
      const meta = fileMeta.get(file);
      const shouldSplit = file.type === 'application/pdf' && meta?.pageCount && meta.pageCount > 1 && meta.splitMode;
      if (shouldSplit) {
        const baseName = file.name.replace(/\.pdf$/i, '');
        for (let pageNum = 1; pageNum <= (meta!.pageCount as number); pageNum++) {
          setStatusText(`Splitting ${file.name}: page ${pageNum} of ${meta!.pageCount}…`);
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
    if (jobs.length === 0) { alert('Nothing to scan.'); return; }

    // Reset cancellation flag/state for this batch.
    cancelRef.current = false;
    setCancelling(false);

    // Seed the batch progress panel — one row per job, all queued.
    setBatchProgress(jobs.map(j => ({ name: j.displayName, status: 'queued' as BatchStatus })));

    const journalCode = cat.journal_code || 'JV';
    const results: ScannedInvoice[] = [];
    const truncated: string[] = [];
    for (let i = 0; i < jobs.length; i++) {
      // Check the cancel flag before starting each file. If set, mark every
      // remaining queued row as cancelled and break out — already-processed
      // results are kept and the user is taken to review them.
      if (cancelRef.current) {
        setBatchProgress(prev => prev.map((row, idx) => idx >= i && row.status === 'queued' ? { ...row, status: 'cancelled' } : row));
        break;
      }
      const { file, displayName } = jobs[i];
      setStatusText(`Scanning ${i + 1} of ${jobs.length}: ${displayName}`);
      setBatchProgress(prev => prev.map((row, idx) => idx === i ? { ...row, status: 'scanning' } : row));
      try {
        let parsed: ParsedInvoice;
        let text = '';
        let confidence = 0;
        let fieldConfidences: Record<string, number> | undefined;
        let fieldNotes: string[] | undefined;
        try {
          // Primary: AI extraction with Claude (reads English + Greek).
          const img = await fileToAiImageParts(file);
          if (img.truncated) truncated.push(`${displayName} (${img.totalPages} pages)`);
          const ai = await api.extractDocument(img.parts);
          parsed = aiToParsed(ai);
          text = typeof ai.full_text === 'string' ? ai.full_text : '';
          confidence = typeof ai.confidence === 'number' ? ai.confidence : 90;
          // S2: capture per-field confidence + notes so InvoiceEditor can flag
          // low-confidence values for the reviewer to verify.
          if (ai.field_confidences && typeof ai.field_confidences === 'object') {
            fieldConfidences = ai.field_confidences as Record<string, number>;
          }
          if (Array.isArray(ai.field_notes) && ai.field_notes.length > 0) {
            fieldNotes = ai.field_notes.filter((n: any) => typeof n === 'string' && n.trim());
          }
        } catch (aiErr) {
          // Fallback: on-device Tesseract + regex, so scanning still works
          // if the AI key / function is unavailable. Per-field confidences
          // aren't available from the fallback path.
          console.warn('AI extraction failed, falling back to on-device OCR:', aiErr);
          const r = await scanSingleFile(file);
          text = r.text;
          confidence = r.confidence;
          parsed = parseInvoiceText(text);
        }
        results.push({ fileBlob: file, fileName: file.name, mimeType: file.type, parsed, rawOcrText: text, confidence, fieldConfidences, fieldNotes, journalCode, clientId });
        // Mark this row done with a quick preview the panel can show.
        setBatchProgress(prev => prev.map((row, idx) => idx === i ? {
          ...row,
          status: 'done',
          vendor: parsed.vendorName || '—',
          total: parsed.totalAmount || 0,
          confidence,
        } : row));
      } catch (err) {
        console.error(`Failed to scan ${file.name}:`, err);
        results.push({
          fileBlob: file, fileName: file.name, mimeType: file.type,
          parsed: { invoiceNumber: '', vendorName: '', invoiceDate: '', dueDate: '', subtotal: 0, taxAmount: 0, totalAmount: 0, currency: '', lineItems: [], details: '' },
          rawOcrText: '', confidence: 0, journalCode, clientId,
        });
        setBatchProgress(prev => prev.map((row, idx) => idx === i ? {
          ...row,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        } : row));
      }
    }

    if (truncated.length > 0) {
      alert(`Only the first ${MAX_OCR_PAGES} pages were read for AI extraction on:\n\n${truncated.join('\n')}\n\nReview the extracted fields, and split the PDF if later pages are needed.`);
    }

    // If cancelled with nothing processed, stay on the scanner page so the
    // user can adjust files / category and try again. Otherwise hand off to
    // the Edit Invoice screen (batch mode steps through each result).
    if (results.length === 0) {
      if (cancelRef.current) setStatusText('Batch cancelled — no files processed.');
      return;
    }
    scannedInvoices.current = results;
    navigate('/invoices/new', { state: { batch: true } });
  };

  // Branch B — no OCR; file the documents straight into the category's folder.
  const runUploadBranch = async (cat: DocCategory) => {
    setStatusText(`Uploading ${selectedFiles.length} document(s)…`);
    const folderId = await api.getFolderIdByCategoryKey(clientId, cat.target_folder);
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { inserted } = await api.uploadDocumentsToFolder({
      clientId,
      folderId,
      docType: cat.name,
      category: cat.target_folder,
      month: ym,
      files: selectedFiles,
      notes,
    });
    const clientName = clients.find((c: any) => c.id === clientId)?.name || 'client';
    setSelectedFiles([]);
    setFileMeta(new Map());
    setDone({ count: inserted, folder: cat.name, client: clientName });
  };

  const handleProcess = async () => {
    if (selectedFiles.length === 0) return;
    if (!clientId) { alert('Please select a client before continuing.'); return; }
    if (!category) { alert('Please choose a document category first.'); return; }
    setScanning(true);
    try {
      if (isOcr) await runOcrBranch(category);
      else await runUploadBranch(category);
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    } finally {
      setScanning(false);
      setStatusText('');
    }
  };

  // ---- Branch B confirmation screen ----
  if (done) {
    return (
      <div className="scanner-page">
        <h2>Scan Document</h2>
        <div className="form-section" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, color: 'var(--pc-green)' }}>✓</div>
          <h3 style={{ marginTop: 4 }}>{done.count} document{done.count === 1 ? '' : 's'} uploaded</h3>
          <p style={{ color: 'var(--pc-text-2)' }}>
            Filed under <strong>{done.folder}</strong> for <strong>{done.client}</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={resetAfterDone}>Scan another</button>
            <button className="btn btn-primary" onClick={() => navigate(`/clients/${clientId}`)}>Open client</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scanner-page">
      <h2>Scan Document</h2>

      {/* Step 1: Select Client — hidden when the page is rendered from the
          client portal (clientId is forced to the logged-in client's row). */}
      {!isClientLocked && (
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
      )}

      {/* Step 2: Document Category */}
      <div className="form-section">
        <h3>2. Document Category</h3>
        <select
          className="form-input"
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
          style={{ maxWidth: 360 }}
        >
          {categories.length === 0 && <option value={0}>Loading categories…</option>}
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.code ? `${c.code} — ${c.name}` : c.name}</option>
          ))}
        </select>
        {category && (
          <p style={{ fontSize: 13, color: 'var(--pc-text-2)', marginTop: 8 }}>
            {isOcr
              ? 'Runs OCR and opens the invoice editor so you can review each extraction before saving.'
              : 'Files the documents straight into the client’s folders — no OCR, no invoice record.'}
          </p>
        )}
      </div>

      {/* Step 3: Upload */}
      <div className="form-section">
        <h3>3. Upload Documents</h3>
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
                {isMultiPagePdf && isOcr && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', marginLeft: 8 }}>
                    <input type="checkbox" checked={!!meta?.splitMode} onChange={() => toggleSplitMode(file)} />
                    Split {pages} pages → {pages} invoices
                  </label>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => removeFile(i)}>X</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Notes — Branch B only */}
      {selectedFiles.length > 0 && !isOcr && (
        <div className="form-section">
          <label style={{ fontSize: 13, fontWeight: 500 }}>Notes (optional)</label>
          <textarea
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything to note about these documents…"
            style={{ width: '100%', marginTop: 4 }}
          />
        </div>
      )}

      {selectedFiles.length > 0 && !showCamera && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <button className="btn btn-primary btn-scan" onClick={handleProcess} disabled={scanning} style={{ flex: 1 }}>
            {scanning
              ? statusText || 'Working…'
              : isOcr
                ? `Scan ${selectedFiles.length} Document(s)`
                : `Upload ${selectedFiles.length} Document(s)`}
          </button>
          {scanning && isOcr && (
            <button
              className="btn btn-secondary"
              onClick={() => { cancelRef.current = true; setCancelling(true); setStatusText('Cancelling — finishing the current file…'); }}
              disabled={cancelling}
              title="Stop after the current file finishes. Already-processed results are kept."
            >
              {cancelling ? 'Cancelling…' : '⏹ Cancel batch'}
            </button>
          )}
        </div>
      )}

      {scanning && (
        <div className="progress-bar">
          <div className="progress-fill progress-indeterminate" />
        </div>
      )}

      {/* Bulk-batch live progress panel — one row per job, updates as the
          loop in runOcrBranch advances. Hidden until a batch starts. */}
      {batchProgress.length > 0 && (
        <div className="form-section" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px', marginTop: 12 }}>
          {(() => {
            const total = batchProgress.length;
            const done = batchProgress.filter(r => r.status === 'done').length;
            const failed = batchProgress.filter(r => r.status === 'failed').length;
            const cancelled = batchProgress.filter(r => r.status === 'cancelled').length;
            const scanningCount = batchProgress.filter(r => r.status === 'scanning').length;
            // Completed = anything that won't progress further.
            const finished = done + failed + cancelled;
            const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <strong style={{ color: '#1a365d', fontSize: 14 }}>
                    Batch progress: {finished} of {total}
                    {scanningCount > 0 && <span style={{ color: '#64748b', fontWeight: 400 }}> · {scanningCount} in flight</span>}
                  </strong>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {done > 0 && <span style={{ color: '#166534' }}>✓ {done} done</span>}
                    {failed > 0 && <span style={{ color: '#b91c1c', marginLeft: 8 }}>⚠ {failed} failed</span>}
                    {cancelled > 0 && <span style={{ color: '#64748b', marginLeft: 8 }}>⏹ {cancelled} cancelled</span>}
                  </span>
                </div>
                {/* Determinate progress bar based on completed jobs. Grey when
                    the batch was cancelled with no successes, amber if some
                    failed, green otherwise. */}
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: cancelled > 0 && done === 0 ? '#94a3b8' : failed > 0 ? '#f59e0b' : '#15803d',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#64748b', textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px', fontWeight: 500 }}>File</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 90 }}>Status</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500 }}>Vendor</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 90, textAlign: 'right' }}>Total</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 60, textAlign: 'right' }}>Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchProgress.map((row, idx) => {
                        const bg =
                          row.status === 'done' ? '#dcfce7' :
                          row.status === 'failed' ? '#fee2e2' :
                          row.status === 'scanning' ? '#dbeafe' :
                          row.status === 'cancelled' ? '#e2e8f0' :
                          '#f1f5f9';
                        const fg =
                          row.status === 'done' ? '#166534' :
                          row.status === 'failed' ? '#b91c1c' :
                          row.status === 'scanning' ? '#1e40af' :
                          row.status === 'cancelled' ? '#475569' :
                          '#64748b';
                        const label =
                          row.status === 'queued' ? '⋯ queued' :
                          row.status === 'scanning' ? '⏳ scanning' :
                          row.status === 'done' ? '✓ done' :
                          row.status === 'cancelled' ? '⏹ cancelled' :
                          '⚠ failed';
                        const conf = row.confidence != null ? Math.round(row.confidence) : null;
                        const confColor = conf == null ? '#94a3b8' : conf >= 85 ? '#166534' : conf >= 70 ? '#92400e' : '#b91c1c';
                        // Cancelled rows render with reduced opacity so the eye
                        // immediately separates them from real failures.
                        const rowOpacity = row.status === 'cancelled' ? 0.7 : 1;
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', opacity: rowOpacity }}>
                            <td style={{ padding: '4px 6px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.name}>{row.name}</td>
                            <td style={{ padding: '4px 6px' }}>
                              <span style={{ background: bg, color: fg, padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600 }}>{label}</span>
                            </td>
                            <td style={{ padding: '4px 6px', color: row.vendor ? '#1a365d' : '#94a3b8' }}>{row.vendor || (row.status === 'failed' ? <span style={{ color: '#b91c1c', fontStyle: 'italic' }} title={row.error || ''}>{row.error || 'failed'}</span> : '—')}</td>
                            <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.total ? row.total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                            <td style={{ padding: '4px 6px', textAlign: 'right', color: confColor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{conf != null ? `${conf}%` : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {failed > 0 && !scanning && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
                    {failed} file{failed === 1 ? '' : 's'} failed extraction — they appear in the editor with empty fields. Fix or remove them in the batch review.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div className="manual-entry">
        <button
          className="btn btn-link"
          onClick={() => navigate('/invoices/new', { state: { journalCode: category?.journal_code || 'JV', clientId } })}
        >
          Or enter invoice details manually
        </button>
      </div>
    </div>
  );
}
