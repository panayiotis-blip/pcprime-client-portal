import { useState, useEffect, useRef } from 'react';
import { api, isStaffRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../services/dates';
import { PanelSkeleton } from '../ui';

const DOC_TYPES = [
  { value: 'invoice', label: 'Invoice (Received)' },
  { value: 'issued_invoice', label: 'Invoice (Issued to Client)' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'contract', label: 'Contract' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'report', label: 'Financial Report' },
  { value: 'other', label: 'Other' },
];

// System folder icons
const SYSTEM_ICONS: Record<string, string> = {
  kyc: '🆔',
  contracts: '📄',
  agreements: '🤝',
  company_records: '📋',
  audited_accounts: '📊',
  scanned: '🗂️',
  issued_invoices: '📤',
  other: '📁',
};

interface Props { clientId: number; }

interface FolderNode {
  id: number;
  name: string;
  parent_id: number | null;
  is_system: number;
  category_key: string;
  doc_count: number;
  children?: FolderNode[];
}

export default function ClientDocuments({ clientId }: Props) {
  const { user } = useAuth();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeFolder, setActiveFolder] = useState<FolderNode | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState<number | null | 'root'>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState('invoice');
  const [uploadMonth, setUploadMonth] = useState(new Date().toISOString().slice(0, 7));
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadInvoiceNo, setUploadInvoiceNo] = useState('');
  const [uploadEmailedDate, setUploadEmailedDate] = useState('');
  const [activeYear, setActiveYear] = useState<string>('');
  const [activeMonth, setActiveMonth] = useState<string>('');
  // Covers the whole opening sequence — folders, then that folder's documents.
  // The tab used to render an empty shell for both round trips, which read as
  // "there's nothing here" rather than "still loading".
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const buildTree = (flat: FolderNode[]): FolderNode[] => {
    const map = new Map(flat.map(f => [f.id, { ...f, children: [] as FolderNode[] }]));
    const roots: FolderNode[] = [];
    for (const f of map.values()) {
      if (f.parent_id && map.has(f.parent_id)) {
        map.get(f.parent_id)!.children!.push(f);
      } else {
        roots.push(f);
      }
    }
    return roots;
  };

  const loadFolders = async () => {
    try {
      const flat = await api.getFolders(clientId);
      const tree = buildTree(flat);
      setFolders(tree);
      if (!activeFolder && tree.length > 0) {
        const scanned = flat.find((f: any) => f.category_key === 'scanned');
        setActiveFolder(scanned || tree[0]);
      } else if (tree.length === 0) {
        // No folders at all — no document fetch will follow, so release the
        // loading gate here or the skeleton would never clear.
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const loadDocuments = async () => {
    if (!activeFolder) return;
    const params: Record<string, string> = { client_id: String(clientId) };
    if (activeFolder.is_system && activeFolder.category_key) {
      params.category = activeFolder.category_key;
    } else {
      params.folder_id = String(activeFolder.id);
    }
    if (activeYear) params.year = activeYear;
    if (activeMonth) params.month = activeMonth;
    try { setDocuments(await api.getDocuments(params)); } catch {}
  };

  useEffect(() => { setLoading(true); loadFolders(); }, [clientId]);
  useEffect(() => {
    // Wait for the folder tree to pick a default before fetching documents;
    // loadDocuments would otherwise no-op and clear the gate too early.
    if (!activeFolder) return;
    loadDocuments().finally(() => setLoading(false));
  }, [clientId, activeFolder, activeYear, activeMonth]);

  const toggleExpanded = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateFolder = async (parentId: number | null) => {
    if (!newFolderName.trim()) return;
    await api.createFolder({ client_id: clientId, parent_id: parentId, name: newFolderName.trim() });
    setNewFolderName('');
    setShowNewFolder(null);
    if (parentId) setExpanded(prev => new Set(prev).add(parentId));
    await loadFolders();
  };

  const handleRename = async (id: number) => {
    if (!renameName.trim()) return;
    await api.renameFolder(id, renameName.trim());
    setRenamingId(null);
    setRenameName('');
    await loadFolders();
  };

  const handleDeleteFolder = async (id: number, name: string) => {
    if (!confirm(`Delete folder "${name}"? Documents inside will move to its parent folder.`)) return;
    await api.deleteFolder(id);
    if (activeFolder?.id === id) setActiveFolder(null);
    await loadFolders();
  };

  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) { alert('Select files'); return; }
    if (!activeFolder) { alert('Select a folder first'); return; }
    setUploading(true);
    try {
      // Combine invoice-specific metadata into notes for issued invoices
      let notes = uploadNotes;
      if (isIssuedFolder) {
        const parts: string[] = [];
        if (uploadInvoiceNo) parts.push(`Invoice #${uploadInvoiceNo}`);
        if (uploadEmailedDate) parts.push(`Emailed ${uploadEmailedDate}`);
        if (uploadNotes) parts.push(uploadNotes);
        notes = parts.join(' • ');
      }
      await api.uploadDocumentsToFolder({
        clientId,
        folderId: activeFolder.is_system ? null : activeFolder.id,
        docType: uploadType,
        category: activeFolder.is_system ? activeFolder.category_key : 'custom',
        month: uploadMonth,
        files: Array.from(files),
        notes,
      });
      if (fileRef.current) fileRef.current.value = '';
      setUploadNotes('');
      setUploadInvoiceNo('');
      setUploadEmailedDate('');
      setShowUpload(false);
      await loadFolders();
      await loadDocuments();
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const isIssuedFolder = activeFolder?.category_key === 'issued_invoices';

  // Auto-set doc type when folder changes
  useEffect(() => {
    if (activeFolder?.category_key === 'issued_invoices') setUploadType('issued_invoice');
    else if (activeFolder?.category_key === 'scanned') setUploadType('invoice');
    else if (activeFolder?.category_key === 'contracts') setUploadType('contract');
    else if (activeFolder?.category_key === 'agreements') setUploadType('agreement');
    else if (activeFolder?.category_key === 'audited_accounts') setUploadType('report');
  }, [activeFolder?.id]);

  const hasYearMonthGrouping = !!(activeFolder?.category_key && (
    activeFolder.category_key === 'scanned' ||
    activeFolder.category_key === 'issued_invoices' ||
    activeFolder.category_key.startsWith('scanned_')
  ));
  const availableYears = hasYearMonthGrouping ? Array.from(new Set(documents.map((d: any) => d.year).filter(Boolean))).sort().reverse() : [];
  const availableMonths = (hasYearMonthGrouping && activeYear)
    ? Array.from(new Set(documents.filter((d: any) => d.year === activeYear).map((d: any) => d.month).filter(Boolean))).sort().reverse()
    : [];

  const visibleDocs = documents.filter((d: any) => {
    if (activeYear && d.year !== activeYear) return false;
    if (activeMonth && d.month !== activeMonth) return false;
    return true;
  });

  const renderFolder = (folder: FolderNode, depth: number = 0): React.ReactNode => {
    const isOpen = expanded.has(folder.id);
    const hasChildren = folder.children && folder.children.length > 0;
    const isActive = activeFolder?.id === folder.id;
    const icon = folder.is_system ? SYSTEM_ICONS[folder.category_key] || '📁' : '📁';

    return (
      <div key={folder.id}>
        <div
          className={`folder-tree-item ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <button
            className="tree-toggle"
            onClick={(e) => { e.stopPropagation(); toggleExpanded(folder.id); }}
            style={{ visibility: hasChildren || !folder.is_system ? 'visible' : 'hidden' }}
          >
            {isOpen ? '▼' : '▶'}
          </button>
          <span className="tree-icon" onClick={() => setActiveFolder(folder)}>{icon}</span>
          {renamingId === folder.id ? (
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onBlur={() => handleRename(folder.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(folder.id); if (e.key === 'Escape') { setRenamingId(null); setRenameName(''); } }}
              className="form-input tree-rename-input"
            />
          ) : (
            <span className="tree-name" onClick={() => setActiveFolder(folder)}>{folder.name}</span>
          )}
          <span className="tree-count">{folder.doc_count || ''}</span>
          {isStaffRole(user) && (
            <div className="tree-actions">
              <button title="Add subfolder" onClick={(e) => { e.stopPropagation(); setShowNewFolder(folder.id); setExpanded(p => new Set(p).add(folder.id)); }}>+</button>
              {!folder.is_system && (
                <>
                  <button title="Rename" onClick={(e) => { e.stopPropagation(); setRenamingId(folder.id); setRenameName(folder.name); }}>✎</button>
                  <button title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id, folder.name); }}>×</button>
                </>
              )}
            </div>
          )}
        </div>

        {isOpen && showNewFolder === folder.id && (
          <div className="new-folder-inline" style={{ paddingLeft: 40 + depth * 16 }}>
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder(folder.id);
                if (e.key === 'Escape') { setShowNewFolder(null); setNewFolderName(''); }
              }}
              placeholder="New folder name"
              className="form-input tree-rename-input"
            />
            <button className="btn btn-primary btn-sm" onClick={() => handleCreateFolder(folder.id)}>Add</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowNewFolder(null); setNewFolderName(''); }}>Cancel</button>
          </div>
        )}

        {isOpen && hasChildren && folder.children!.map(c => renderFolder(c, depth + 1))}
      </div>
    );
  };

  if (loading) return <div className="client-documents"><PanelSkeleton rows={7} /></div>;

  return (
    <div className="client-documents">
      <div className="list-header">
        <h3>Documents</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {isStaffRole(user) && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowNewFolder('root')}>+ New Top Folder</button>
          )}
          {/* Clients may upload into existing folders, but not create/delete folders or delete files. */}
          <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(!showUpload)} disabled={!activeFolder}>
            {showUpload ? 'Cancel' : '+ Upload'}
          </button>
        </div>
      </div>

      {showNewFolder === 'root' && (
        <div className="new-folder-inline" style={{ marginBottom: 12 }}>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder(null);
              if (e.key === 'Escape') { setShowNewFolder(null); setNewFolderName(''); }
            }}
            placeholder="New top-level folder"
            className="form-input"
            style={{ maxWidth: 300 }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => handleCreateFolder(null)}>Add</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setShowNewFolder(null); setNewFolderName(''); }}>Cancel</button>
        </div>
      )}

      <div className="documents-layout">
        <aside className="folder-tree">
          {folders.map(f => renderFolder(f))}
        </aside>

        <div className="documents-content">
          {!activeFolder ? (
            <div className="empty-state"><p>Select a folder to view documents.</p></div>
          ) : (
            <>
              <div className="folder-title">
                <h3>{activeFolder.name}</h3>
                <span className="folder-count">{visibleDocs.length} document(s)</span>
              </div>

              {/* Upload form */}
              {showUpload && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <h4 style={{ marginBottom: 12 }}>Upload to "{activeFolder.name}"</h4>
                  {isIssuedFolder && (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                      📤 For invoices you've issued from BTMS and emailed to this client.
                    </p>
                  )}
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Document Type</label>
                      <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} className="form-input">
                        {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Period (Month)</label>
                      <input type="month" value={uploadMonth} onChange={(e) => setUploadMonth(e.target.value)} className="form-input" />
                    </div>
                    {isIssuedFolder && (
                      <>
                        <div className="form-group">
                          <label>Invoice Number</label>
                          <input type="text" value={uploadInvoiceNo} onChange={(e) => setUploadInvoiceNo(e.target.value)} className="form-input" placeholder="e.g. INV-2026-001" />
                        </div>
                        <div className="form-group">
                          <label>Date Emailed</label>
                          <input type="date" value={uploadEmailedDate} onChange={(e) => setUploadEmailedDate(e.target.value)} className="form-input" />
                        </div>
                      </>
                    )}
                    <div className="form-group full-width">
                      <label>{isIssuedFolder ? 'Additional Notes' : 'Notes'}</label>
                      <input type="text" value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} className="form-input" />
                    </div>
                    <div className="form-group full-width">
                      <label>Files</label>
                      <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.doc,.docx" className="form-input" />
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={handleUpload} disabled={uploading} style={{ marginTop: 12 }}>
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              )}

              {/* Year/Month filters for Scanned folder */}
              {hasYearMonthGrouping && availableYears.length > 0 && (
                <div className="folder-breadcrumbs">
                  <button className={`breadcrumb-btn ${!activeYear ? 'active' : ''}`} onClick={() => { setActiveYear(''); setActiveMonth(''); }}>All Years</button>
                  {availableYears.map((year: string) => (
                    <button key={year} className={`breadcrumb-btn ${activeYear === year ? 'active' : ''}`} onClick={() => { setActiveYear(year); setActiveMonth(''); }}>
                      📁 {year}
                    </button>
                  ))}
                </div>
              )}
              {hasYearMonthGrouping && activeYear && availableMonths.length > 0 && (
                <div className="folder-breadcrumbs folder-months">
                  <button className={`breadcrumb-btn ${!activeMonth ? 'active' : ''}`} onClick={() => setActiveMonth('')}>All Months</button>
                  {availableMonths.map((month: string) => {
                    const monthNum = month.split('-')[1];
                    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    return <button key={month} className={`breadcrumb-btn ${activeMonth === month ? 'active' : ''}`} onClick={() => setActiveMonth(month)}>📂 {names[parseInt(monthNum)] || monthNum}</button>;
                  })}
                </div>
              )}

              {visibleDocs.length === 0 ? (
                <div className="empty-state">
                  <p>No documents in this folder.</p>
                  <button className="btn btn-primary" onClick={() => setShowUpload(true)}>+ Upload</button>
                </div>
              ) : (
                <div className="document-grid">
                  {visibleDocs.map((doc: any) => (
                    <div key={doc.id} className="document-card">
                      <div className="doc-icon">
                        {doc.mime_type?.includes('pdf') ? '📄' : doc.mime_type?.includes('image') ? '🖼️' : doc.mime_type?.includes('sheet') ? '📊' : '📎'}
                      </div>
                      <div className="doc-body">
                        <p className="doc-name">{doc.file_name}</p>
                        <p className="doc-meta">
                          {doc.month && <span>{doc.month}</span>}
                          {doc.doc_type && <span className="doc-type-tag">{doc.doc_type.replace(/_/g, ' ')}</span>}
                        </p>
                        {doc.notes && <p className="doc-notes">{doc.notes}</p>}
                        <p className="doc-uploaded">Uploaded {formatDate(doc.created_at)}</p>
                      </div>
                      <div className="doc-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={async () => {
                            try {
                              const url = await api.downloadDocumentUrl(doc.id);
                              window.open(url, '_blank', 'noopener,noreferrer');
                            } catch (err: any) { alert(err.message); }
                          }}
                        >View</button>
                        {isStaffRole(user) && (
                          <button className="btn btn-danger btn-sm" onClick={async () => { if (confirm('Delete?')) { await api.deleteDocument(doc.id); await loadFolders(); await loadDocuments(); } }}>X</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
