import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../../services/api';

// Client-portal Inbox — a read-only record of email correspondence on the
// client's file, including mail our office sent on their behalf (bulk emails,
// tax-info requests, notices). Clients can read but not send from here.

// Inbound email bodies are attacker-controlled, so sanitise before rendering.
const SANITISE_OPTS = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
  ALLOW_DATA_ATTR: false,
};
const escapeHtml = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
const sanitiseBody = (m: { body_html: string | null; body_plain: string | null }) =>
  m?.body_html
    ? DOMPurify.sanitize(m.body_html, SANITISE_OPTS)
    : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(m?.body_plain || '')}</pre>`;

type Row = {
  id: number; direction: string; sender_name: string | null; sender_email: string | null;
  subject: string | null; received_at: string; attachment_count: number;
};

export default function MyEmails() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<any | null>(null);

  useEffect(() => {
    api.getMyEmails().then((d) => setRows(d as Row[])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const openDetail = async (id: number) => {
    try { setOpen(await api.getClientEmailDetail(id)); } catch { /* ignore */ }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>✉ Inbox</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Email correspondence on your file, including messages our office has sent on your behalf. This is a
        read-only record — to message us, use <strong>Messages</strong>.
      </p>

      {loading ? <p>Loading…</p> : rows.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>No emails yet.</p>
      ) : (
        <table className="export-table">
          <thead><tr><th style={{ width: 90 }}>Type</th><th>From / To</th><th>Subject</th><th style={{ width: 150 }}>Date</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(r.id)}>
                <td>
                  <span style={{ fontSize: 12, fontWeight: 600, color: r.direction === 'outbound' ? '#1a365d' : '#047857' }}>
                    {r.direction === 'outbound' ? 'Sent for you' : 'Received'}
                  </span>
                </td>
                <td>{r.sender_name || r.sender_email || '—'}</td>
                <td>{r.subject || '(no subject)'}{r.attachment_count > 0 && ' 📎'}</td>
                <td>{new Date(r.received_at).toLocaleString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <div onClick={() => setOpen(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 760 }}>
            <h3 style={{ marginTop: 0, color: '#1a365d' }}>{open.subject || '(no subject)'}</h3>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
              {open.direction === 'outbound' ? 'Sent on your behalf' : 'Received'} ·{' '}
              {new Date(open.received_at).toLocaleString('en-GB')}
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, fontSize: 14, lineHeight: 1.5 }}
              dangerouslySetInnerHTML={{ __html: sanitiseBody(open) }} />
            <div style={{ textAlign: 'right', marginTop: 14 }}>
              <button className="btn btn-secondary" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
