import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../../services/api';
import { formatDateTime } from '../../services/dates';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../common/SearchableSelect';

// Shared firm inbox (info@primeandcalculate.com). Read-only: staff view
// incoming mail captured by the poll-inbox Edge Function; replies happen in
// Outlook. Mirrors the per-client ClientEmails view, minus per-client direction.

type InboxRow = {
  id: number;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  label_ids: string[] | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  has_attachments: boolean;
  is_read: boolean;
};

// Gmail labels → a single display folder.
type Folder = 'Inbox' | 'Sent' | 'Spam' | 'Trash' | 'Draft' | 'Other';
const folderOf = (labels: string[] | null): Folder => {
  const l = labels || [];
  if (l.includes('TRASH')) return 'Trash';
  if (l.includes('SPAM')) return 'Spam';
  if (l.includes('DRAFT')) return 'Draft';
  if (l.includes('SENT')) return 'Sent';
  if (l.includes('INBOX')) return 'Inbox';
  return 'Other';
};
const FOLDER_TABS: Array<'All' | Folder> = ['All', 'Inbox', 'Sent', 'Spam', 'Trash'];
const folderColor: Record<Folder, string> = {
  Inbox: '#1e40af', Sent: '#15803d', Spam: '#b45309', Trash: '#64748b', Draft: '#7c3aed', Other: '#475569',
};

type Attachment = {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
};

type InboxDetail = InboxRow & {
  to_emails: string[];
  cc_emails: string[];
  body_html: string | null;
  body_plain: string | null;
  attachments: Attachment[];
};

const fmtDateTime = (iso: string) => formatDateTime(iso, '');
const fmtSize = (bytes: number | null) => {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function Inbox() {
  const { clients } = useApp();
  const [emails, setEmails] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<'All' | Folder>('All');
  const [open, setOpen] = useState<InboxDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [assignClientId, setAssignClientId] = useState<number | ''>('');
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);

  const clientOptions = useMemo(
    () => (clients as any[]).map(c => ({ value: c.id, label: c.name, sublabel: c.client_code || '' })),
    [clients],
  );

  const handleAssign = async () => {
    if (!open || !assignClientId) return;
    setAssigning(true);
    setAssignMsg(null);
    try {
      const res = await api.assignInboxEmailToClient(open.id, Number(assignClientId));
      const name = (clients as any[]).find(c => c.id === Number(assignClientId))?.name || 'client';
      setAssignMsg(res.already ? `Already filed to ${name}.` : `Filed to ${name} (Emails tab + Documents${res.attachments_copied ? `, ${res.attachments_copied} attachment(s)` : ''}).`);
      setAssignClientId('');
    } catch (e: any) {
      setAssignMsg('Assign failed: ' + e.message);
    } finally {
      setAssigning(false);
    }
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getInboxEmails({ limit: 200 });
      setEmails(data as InboxRow[]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const unread = useMemo(() => emails.filter(e => !e.is_read).length, [emails]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return emails.filter(e => {
      if (folder !== 'All' && folderOf(e.label_ids) !== folder) return false;
      if (!q) return true;
      return (e.subject || '').toLowerCase().includes(q) ||
        (e.from_email || '').toLowerCase().includes(q) ||
        (e.from_name || '').toLowerCase().includes(q) ||
        (e.to_emails || []).join(' ').toLowerCase().includes(q) ||
        (e.snippet || '').toLowerCase().includes(q);
    });
  }, [emails, search, folder]);

  const folderCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of emails) { const f = folderOf(e.label_ids); c[f] = (c[f] || 0) + 1; }
    return c;
  }, [emails]);

  const openDetail = async (row: InboxRow) => {
    setLoadingDetail(true);
    setAssignClientId('');
    setAssignMsg(null);
    try {
      const detail = await api.getInboxEmail(row.id) as InboxDetail;
      setOpen(detail);
      if (!row.is_read) {
        // Mark read (best-effort) + reflect in the list immediately.
        api.markInboxRead(row.id, true).catch(() => {});
        setEmails(prev => prev.map(e => e.id === row.id ? { ...e, is_read: true } : e));
      }
    } catch (err: any) {
      alert('Failed to load email: ' + err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const downloadAttachment = async (att: Attachment) => {
    try {
      const url = await api.getInboxAttachmentUrl(att.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      alert('Failed to fetch attachment: ' + err.message);
    }
  };

  const sanitisedBody = useMemo(() => {
    if (!open) return '';
    if (open.body_html) {
      return DOMPurify.sanitize(open.body_html, {
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'style'],
        ALLOW_DATA_ATTR: false,
      });
    }
    return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${(open.body_plain || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c))}</pre>`;
  }, [open]);

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>
          📥 Inbox
          {unread > 0 && <span className="status-badge" style={{ marginLeft: 10, background: '#1a365d', color: '#fff' }}>{unread} unread</span>}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search sender or subject..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 10px' }}>
        A mirror of the <strong>info@primeandcalculate.com</strong> mailbox — Inbox, Sent, Spam &amp; Trash — visible to all staff. Read-only; reply from Outlook.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {FOLDER_TABS.map(t => {
          const n = t === 'All' ? emails.length : (folderCounts[t] || 0);
          const active = folder === t;
          return (
            <button key={t} onClick={() => setFolder(t)}
              className="btn btn-sm"
              style={{
                background: active ? '#1a365d' : '#fff',
                color: active ? '#fff' : '#1a365d',
                border: '1px solid #cbd5e1', borderRadius: 999, padding: '3px 12px', fontSize: 12.5,
              }}>
              {t} <span style={{ opacity: 0.7 }}>({n})</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : error ? (
        <div className="empty-state"><p style={{ color: '#b91c1c' }}>Failed to load inbox: {error}</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{emails.length === 0 ? 'No emails in the shared inbox yet.' : 'No emails match your search.'}</p>
          {emails.length === 0 && (
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
              Once the info@ mailbox is connected (Gmail API), incoming mail appears here within a few minutes.
            </p>
          )}
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Folder</th>
                <th>From / To</th>
                <th>Subject</th>
                <th style={{ width: 50 }} title="Attachments">📎</th>
                <th style={{ width: 150 }}>Received</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const f = folderOf(e.label_ids);
                const isSent = f === 'Sent';
                const party = isSent
                  ? (e.to_emails && e.to_emails.length ? e.to_emails.join(', ') : '—')
                  : (e.from_name || e.from_email || '—');
                return (
                <tr key={e.id} style={{ cursor: 'pointer', fontWeight: e.is_read ? 400 : 700 }} onClick={() => openDetail(e)}>
                  <td>
                    <span className="status-badge" style={{ background: '#eef1f5', color: folderColor[f], fontWeight: 600 }}>{f}</span>
                  </td>
                  <td>
                    <div>{isSent && <span style={{ color: '#94a3b8', fontWeight: 400 }}>To: </span>}{party}</div>
                    {!isSent && e.from_name && e.from_email && (
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>{e.from_email}</div>
                    )}
                  </td>
                  <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.subject || '(no subject)'}
                    {e.snippet && <span style={{ color: '#94a3b8', fontWeight: 400 }}> — {e.snippet}</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>{e.has_attachments ? '📎' : ''}</td>
                  <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', fontWeight: 400 }}>{fmtDateTime(e.received_at)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(open || loadingDetail) && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 100, padding: '32px 16px', overflowY: 'auto',
        }} onClick={() => setOpen(null)}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 820 }} onClick={e => e.stopPropagation()}>
            {loadingDetail || !open ? (
              <p>Loading…</p>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <h3 style={{ margin: 0, flex: 1 }}>{open.subject || '(no subject)'}</h3>
                  <button className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>✕ Close</button>
                </div>
                <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>
                  <div><strong>From:</strong> {open.from_name ? `${open.from_name} <${open.from_email || ''}>` : (open.from_email || '—')}</div>
                  <div><strong>To:</strong> {(open.to_emails || []).join(', ')}</div>
                  {open.cc_emails && open.cc_emails.length > 0 && <div><strong>Cc:</strong> {open.cc_emails.join(', ')}</div>}
                  <div><strong>Received:</strong> {fmtDateTime(open.received_at)}</div>
                </div>

                {/* Save to a client folder (Emails tab + Documents) */}
                <div style={{ marginTop: 10, padding: 10, background: '#f1f5f9', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>Save to client:</strong>
                  <div style={{ minWidth: 240, flex: 1 }}>
                    <SearchableSelect
                      value={assignClientId === '' ? '' : String(assignClientId)}
                      options={clientOptions}
                      onChange={(v) => setAssignClientId(v ? Number(v) : '')}
                      placeholder="Search and pick a client…"
                      allowClear
                    />
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={assigning || !assignClientId}>
                    {assigning ? 'Filing…' : 'Assign to client'}
                  </button>
                </div>
                {assignMsg && (
                  <div style={{ marginTop: 6, fontSize: 12.5, color: assignMsg.startsWith('Assign failed') ? '#b91c1c' : '#15803d' }}>{assignMsg}</div>
                )}

                {open.attachments && open.attachments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: 13 }}>Attachments ({open.attachments.length})</strong>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0 0' }}>
                      {open.attachments.map(att => (
                        <li key={att.id} style={{
                          padding: '6px 10px', marginBottom: 4, background: '#eef1f5', borderRadius: 4, fontSize: 13,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        }}>
                          <span>📎 {att.filename} <span style={{ color: '#64748b' }}>({fmtSize(att.size_bytes)})</span></span>
                          <button className="btn btn-link btn-sm" onClick={() => downloadAttachment(att)}>Download</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: 12, padding: 12, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, lineHeight: 1.45 }}>
                  <div dangerouslySetInnerHTML={{ __html: sanitisedBody }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
