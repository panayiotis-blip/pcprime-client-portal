import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../../services/api';

type EmailListRow = {
  id: number;
  client_id: number;
  direction: 'inbound' | 'outbound';
  sender_email: string | null;
  sender_name: string | null;
  recipient_emails: string[];
  cc_emails: string[];
  subject: string | null;
  received_at: string;
  attachment_count: number;
};

type EmailDetail = EmailListRow & {
  body_html: string | null;
  body_plain: string | null;
  raw_message_id: string | null;
};

type Attachment = {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
};

const fmtDateTime = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtSize = (bytes: number | null) => {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

interface Props { clientId: number; }

export default function ClientEmails({ clientId }: Props) {
  const [emails, setEmails] = useState<EmailListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openEmail, setOpenEmail] = useState<EmailDetail | null>(null);
  const [openAttachments, setOpenAttachments] = useState<Attachment[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getClientEmails(clientId);
      setEmails(data as EmailListRow[]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return emails;
    return emails.filter(e =>
      (e.subject || '').toLowerCase().includes(q) ||
      (e.sender_email || '').toLowerCase().includes(q) ||
      (e.sender_name || '').toLowerCase().includes(q)
    );
  }, [emails, search]);

  const openDetail = async (row: EmailListRow) => {
    setLoadingDetail(true);
    try {
      const [detail, atts] = await Promise.all([
        api.getClientEmailDetail(row.id),
        api.getClientEmailAttachments(row.id),
      ]);
      setOpenEmail(detail as EmailDetail);
      setOpenAttachments(atts as Attachment[]);
    } catch (err: any) {
      alert('Failed to load email: ' + err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const downloadAttachment = async (att: Attachment) => {
    try {
      const url = await api.getClientEmailAttachmentSignedUrl(att.storage_path, 120);
      // Open in a new tab — browser handles whether to inline or download
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      alert('Failed to fetch attachment: ' + err.message);
    }
  };

  const sanitisedBody = useMemo(() => {
    if (!openEmail) return '';
    if (openEmail.body_html) {
      return DOMPurify.sanitize(openEmail.body_html, {
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'style'],
        ALLOW_DATA_ATTR: false,
      });
    }
    // Fallback to plain text rendered as preformatted
    return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${(openEmail.body_plain || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c))}</pre>`;
  }, [openEmail]);

  return (
    <div className="client-emails">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search by sender or subject..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : error ? (
        <div className="empty-state"><p style={{ color: '#b91c1c' }}>Failed to load emails: {error}</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{emails.length === 0 ? 'No emails captured for this client yet.' : 'No emails match your search.'}</p>
          {emails.length === 0 && (
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
              BCC or forward emails to this client's unique address to capture them here.
            </p>
          )}
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Dir.</th>
                <th>From</th>
                <th>Subject</th>
                <th style={{ width: 50 }} title="Attachments">📎</th>
                <th style={{ width: 140 }}>Received</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(e)}>
                  <td>
                    <span className="status-badge" style={{
                      background: e.direction === 'inbound' ? '#dbeafe' : '#eef1f5',
                      color:      e.direction === 'inbound' ? '#1e40af' : 'var(--pc-navy-2)',
                    }}>
                      {e.direction === 'inbound' ? '← In' : '→ Out'}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{e.sender_name || e.sender_email || '—'}</div>
                    {e.sender_name && e.sender_email && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>{e.sender_email}</div>
                    )}
                  </td>
                  <td style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.subject || '(no subject)'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {e.attachment_count > 0 ? <span title={`${e.attachment_count} attachment${e.attachment_count === 1 ? '' : 's'}`}>📎{e.attachment_count}</span> : ''}
                  </td>
                  <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDateTime(e.received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(openEmail || loadingDetail) && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 100, padding: '32px 16px', overflowY: 'auto',
        }} onClick={() => { setOpenEmail(null); setOpenAttachments([]); }}>
          <div
            style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 800 }}
            onClick={e => e.stopPropagation()}
          >
            {loadingDetail || !openEmail ? (
              <p>Loading…</p>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <h3 style={{ margin: 0, flex: 1 }}>{openEmail.subject || '(no subject)'}</h3>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setOpenEmail(null); setOpenAttachments([]); }}
                  >
                    ✕ Close
                  </button>
                </div>
                <div style={{
                  marginTop: 8, padding: 10,
                  background: '#f8fafc', borderRadius: 6, fontSize: 13,
                }}>
                  <div><strong>From:</strong> {openEmail.sender_name ? `${openEmail.sender_name} <${openEmail.sender_email || ''}>` : (openEmail.sender_email || '—')}</div>
                  <div><strong>To:</strong> {(openEmail.recipient_emails || []).join(', ')}</div>
                  {openEmail.cc_emails && openEmail.cc_emails.length > 0 && (
                    <div><strong>Cc:</strong> {openEmail.cc_emails.join(', ')}</div>
                  )}
                  <div><strong>Received:</strong> {fmtDateTime(openEmail.received_at)}</div>
                  <div><strong>Direction:</strong> {openEmail.direction}</div>
                </div>

                {openAttachments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: 13 }}>Attachments ({openAttachments.length})</strong>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0 0' }}>
                      {openAttachments.map(att => (
                        <li key={att.id} style={{
                          padding: '6px 10px', marginBottom: 4,
                          background: '#eef1f5', borderRadius: 4, fontSize: 13,
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
