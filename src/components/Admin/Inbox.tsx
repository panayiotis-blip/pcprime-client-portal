import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../../services/api';
import { formatDateTime } from '../../services/dates';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../common/SearchableSelect';
import RichTextEditor from './RichTextEditor';

// Shared firm inbox (info@primeandcalculate.com), laid out like Outlook:
// folder sidebar · conversation list · reading pane. Full two-way — staff view
// mail captured by poll-inbox, and compose / reply / reply-all / forward
// (inbox-send) plus read-unread / archive / trash (inbox-action), all synced
// back to Gmail. Outgoing mail is rich-text, wrapped in a branded HTML shell,
// with the firm signature inserted (from firm_email_settings via migration 126).

type InboxRow = {
  id: number;
  gmail_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  label_ids: string[] | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  has_attachments: boolean;
  is_read: boolean;
  flagged: boolean;
  is_urgent: boolean;
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
const FOLDERS: Array<'All' | Folder> = ['All', 'Inbox', 'Sent', 'Spam', 'Trash'];
const folderIcon: Record<string, string> = {
  All: '🗂', Inbox: '📥', Sent: '📤', Spam: '⚠', Trash: '🗑',
};
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

type SyncStatus = {
  mailbox: string;
  last_run_at: string | null;
  last_error: string | null;
  has_cursor: boolean;
  message_count: number;
  unread_count: number;
  latest_received_at: string | null;
};

const fmtDateTime = (iso: string) => formatDateTime(iso, '');
const fmtSize = (bytes: number | null) => {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// The shared mailbox we send FROM — excluded from reply-all recipients.
const INFO_ADDRESS = 'info@primeandcalculate.com';

type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';
type ComposeState = {
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  body: string;          // HTML (from the rich-text editor)
  replyToInboxId?: number;
  files: File[];
};

const stripHtml = (h: string | null) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const escapeHtml = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));

// Sanitiser for DISPLAYING received mail (strict — no inline styles / scripts).
const SANITISE_OPTS = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'style'],
  ALLOW_DATA_ATTR: false,
};
const sanitiseBody = (msg: { body_html: string | null; body_plain: string | null }) =>
  msg.body_html
    ? DOMPurify.sanitize(msg.body_html, SANITISE_OPTS)
    : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(msg.body_plain || '')}</pre>`;

// Wrap the composed body in a clean, branded HTML email shell so recipients see
// a professional message rather than raw text. Applied at send time.
const wrapEmailHtml = (inner: string) =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
  `<body style="margin:0;padding:0;background:#f4f5f7;">` +
  `<div style="max-width:640px;margin:0 auto;padding:24px;` +
  `font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a365d;background:#ffffff;">` +
  `${inner}</div></body></html>`;

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = reject;
  r.readAsDataURL(file);
});
const dropPrefix = (subj: string | null, re: RegExp) => (subj || '').replace(re, '').trim();

export default function Inbox() {
  const { clients } = useApp();
  const [emails, setEmails] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<'All' | Folder>('All');
  const [thread, setThread] = useState<InboxDetail[] | null>(null);
  const [threadSubject, setThreadSubject] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [assignClientId, setAssignClientId] = useState<number | ''>('');
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  // Firm signature, loaded once (staff-readable RPC). Inserted into new mail.
  const [sigHtml, setSigHtml] = useState<string>('');
  // Resizable panes — widths persist in localStorage.
  const [sidebarW, setSidebarW] = useState<number>(() => Number(localStorage.getItem('inboxSidebarW')) || 190);
  const [listW, setListW] = useState<number>(() => Number(localStorage.getItem('inboxListW')) || 380);
  // Enlarge the compose window (Outlook-style maximise).
  const [composeMax, setComposeMax] = useState(false);

  useEffect(() => { localStorage.setItem('inboxSidebarW', String(sidebarW)); }, [sidebarW]);
  useEffect(() => { localStorage.setItem('inboxListW', String(listW)); }, [listW]);

  // Drag a pane divider. Clamps to sensible bounds so a pane can't vanish.
  const startDrag = (which: 'sidebar' | 'list', e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === 'sidebar' ? sidebarW : listW;
    const onMove = (ev: MouseEvent) => {
      const w = startW + (ev.clientX - startX);
      if (which === 'sidebar') setSidebarW(Math.max(150, Math.min(360, w)));
      else setListW(Math.max(260, Math.min(680, w)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const clientOptions = useMemo(
    () => (clients as any[]).map(c => ({ value: c.id, label: c.name, sublabel: c.client_code || '' })),
    [clients],
  );

  useEffect(() => {
    api.getFirmEmailSignature()
      .then(s => {
        if (s.signature_html && s.signature_html.trim()) setSigHtml(s.signature_html);
        else if (s.signature_text && s.signature_text.trim())
          setSigHtml(`<div style="white-space:pre-wrap">${escapeHtml(s.signature_text)}</div>`);
      })
      .catch(() => {});
  }, []);

  const handleAssign = async (msgId: number) => {
    if (!msgId || !assignClientId) return;
    setAssigning(true);
    setAssignMsg(null);
    try {
      const res = await api.assignInboxEmailToClient(msgId, Number(assignClientId));
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
    api.getInboxSyncStatus().then(setSync).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await api.triggerInboxSync();
      setSyncMsg(`Synced: ${r.stored} new, ${r.duplicate} duplicate${r.failed ? `, ${r.failed} failed` : ''}.`);
      await load();
    } catch (e: any) {
      setSyncMsg('Sync failed: ' + e.message);
      api.getInboxSyncStatus().then(setSync).catch(() => {});
    } finally {
      setSyncing(false);
    }
  };

  // ---- Compose / reply / forward ----
  // Signature-first body: two blank lines to type into, then the firm signature.
  const openingBody = () => `<div><br></div><div><br></div>${sigHtml}`;

  const quotedOriginal = (o: InboxDetail) => {
    const who = o.from_name ? `${o.from_name} <${o.from_email || ''}>` : (o.from_email || '');
    const inner = o.body_html
      ? DOMPurify.sanitize(o.body_html, SANITISE_OPTS)
      : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(o.body_plain || '')}</pre>`;
    return `<div><br></div>` +
      `<div style="border-left:3px solid #cbd5e1;padding-left:12px;color:#64748b;font-size:13px">` +
      `<div>On ${fmtDateTime(o.received_at)}, ${escapeHtml(who)} wrote:</div>${inner}</div>`;
  };

  const forwardedBlock = (o: InboxDetail) => {
    const inner = o.body_html
      ? DOMPurify.sanitize(o.body_html, SANITISE_OPTS)
      : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(o.body_plain || '')}</pre>`;
    return `<div><br></div>` +
      `<div style="color:#64748b;font-size:13px">---------- Forwarded message ----------<br>` +
      `From: ${escapeHtml(o.from_name ? `${o.from_name} <${o.from_email || ''}>` : (o.from_email || ''))}<br>` +
      `Date: ${escapeHtml(fmtDateTime(o.received_at))}<br>` +
      `Subject: ${escapeHtml(o.subject || '(no subject)')}<br>` +
      `To: ${escapeHtml((o.to_emails || []).join(', '))}</div>` +
      `<div><br></div>${inner}`;
  };

  const startCompose = () => { setSendErr(null); setCompose({ mode: 'new', to: '', cc: '', subject: '', body: openingBody(), files: [] }); };

  const startReply = (all: boolean, o: InboxDetail) => {
    const cc = all
      ? [...new Set([...(o.to_emails || []), ...(o.cc_emails || [])]
          .map(e => e.toLowerCase())
          .filter(e => e && e !== INFO_ADDRESS && e !== (o.from_email || '').toLowerCase()))]
      : [];
    const base = dropPrefix(o.subject, /^(re:\s*)+/i);
    setSendErr(null);
    setCompose({
      mode: all ? 'replyAll' : 'reply',
      to: o.from_email || '',
      cc: cc.join(', '),
      subject: base ? `Re: ${base}` : 'Re:',
      body: openingBody() + quotedOriginal(o),
      replyToInboxId: o.id,
      files: [],
    });
  };

  const startForward = (o: InboxDetail) => {
    const base = dropPrefix(o.subject, /^(fwd:\s*)+/i);
    setSendErr(null);
    setCompose({ mode: 'forward', to: '', cc: '', subject: base ? `Fwd: ${base}` : 'Fwd:', body: openingBody() + forwardedBlock(o), files: [] });
  };

  const handleSend = async () => {
    if (!compose) return;
    const to = compose.to.split(',').map(s => s.trim()).filter(Boolean);
    const cc = compose.cc.split(',').map(s => s.trim()).filter(Boolean);
    if (!to.length) { setSendErr('Add at least one recipient.'); return; }
    setSending(true); setSendErr(null);
    try {
      const attachments = await Promise.all(compose.files.map(async f => ({
        filename: f.name,
        mime_type: f.type || 'application/octet-stream',
        content_base64: await fileToBase64(f),
      })));
      const bodyHtml = wrapEmailHtml(DOMPurify.sanitize(compose.body));
      await api.sendInboxEmail({
        to, cc,
        subject: compose.subject,
        body_html: bodyHtml,
        reply_to_inbox_id: (compose.mode === 'reply' || compose.mode === 'replyAll') ? compose.replyToInboxId : undefined,
        attachments,
      });
      setCompose(null);
      setThread(null);
      setSelectedKey(null);
      setSyncMsg('Sent ✓ — pulling it into Sent…');
      await api.triggerInboxSync().catch(() => {});
      await load();
      setSyncMsg('Sent ✓');
    } catch (e: any) {
      setSendErr(e.message);
    } finally {
      setSending(false);
    }
  };

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
  // Unread counts per folder — shown as the bold badge in the sidebar.
  const folderUnread = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of emails) { if (!e.is_read) { const f = folderOf(e.label_ids); c[f] = (c[f] || 0) + 1; } }
    return c;
  }, [emails]);

  // Collapse the flat list into conversations (one row per Gmail thread).
  const threads = useMemo(() => {
    const map = new Map<string, { rep: InboxRow; count: number; unread: number }>();
    for (const e of filtered) {
      const key = e.gmail_thread_id || `single-${e.id}`;
      const g = map.get(key);
      if (!g) map.set(key, { rep: e, count: 1, unread: e.is_read ? 0 : 1 });
      else { g.count++; if (!e.is_read) g.unread++; }
    }
    return [...map.values()];
  }, [filtered]);

  const openThread = async (row: InboxRow) => {
    setLoadingDetail(true);
    setSelectedKey(row.gmail_thread_id || `single-${row.id}`);
    setAssignClientId('');
    setAssignMsg(null);
    setActionMsg(null);
    setThreadSubject(row.subject || '(no subject)');
    try {
      const msgs = row.gmail_thread_id
        ? (await api.getInboxThread(row.gmail_thread_id) as InboxDetail[])
        : [await api.getInboxEmail(row.id) as InboxDetail];
      setThread(msgs);
      setExpandedId(msgs.length ? msgs[msgs.length - 1].id : null);
      const unreadIds = msgs.filter(m => !m.is_read).map(m => m.id);
      if (unreadIds.length) {
        setEmails(prev => prev.map(e => unreadIds.includes(e.id) ? { ...e, is_read: true } : e));
        unreadIds.forEach(id => api.markInboxRead(id, true).catch(() => {}));
        api.inboxAction('read', unreadIds).catch(() => {});
      }
    } catch (err: any) {
      alert('Failed to load conversation: ' + err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleAction = async (action: 'unread' | 'archive' | 'trash' | 'untrash', msg: InboxDetail) => {
    setActioning(true); setActionMsg(null);
    try {
      const res = await api.inboxAction(action, msg.id);
      const updated = res.results?.find(r => r.id === msg.id);
      if (updated) {
        setEmails(prev => prev.map(e => e.id === msg.id
          ? { ...e, label_ids: updated.label_ids, is_read: updated.is_read } : e));
      }
      const verb = action === 'unread' ? 'Marked unread' : action === 'archive' ? 'Archived' : action === 'untrash' ? 'Restored' : 'Moved to Trash';
      setActionMsg(`${verb} ✓`);
      setThread(null);
      setSelectedKey(null);
    } catch (e: any) {
      setActionMsg('Action failed: ' + e.message);
    } finally {
      setActioning(false);
    }
  };

  // Toggle the follow-up flag / urgent marker on a message (optimistic).
  const toggleMark = async (id: number, field: 'flagged' | 'is_urgent', current: boolean) => {
    const next = !current;
    setEmails(prev => prev.map(e => e.id === id ? { ...e, [field]: next } : e));
    setThread(prev => prev ? prev.map(m => m.id === id ? { ...m, [field]: next } : m) : prev);
    try {
      await api.setInboxFlags(id, { [field]: next });
    } catch (e: any) {
      // Revert on failure.
      setEmails(prev => prev.map(em => em.id === id ? { ...em, [field]: current } : em));
      setThread(prev => prev ? prev.map(m => m.id === id ? { ...m, [field]: current } : m) : prev);
      alert('Could not update: ' + e.message);
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

  const paneBorder = '1px solid #e2e8f0';

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>
          📬 Inbox
          {unread > 0 && <span className="status-badge" style={{ marginLeft: 10, background: '#1a365d', color: '#fff' }}>{unread} unread</span>}
        </h2>
        <div style={{ fontSize: 12.5, color: '#64748b', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {sync?.last_run_at
            ? <span>Last synced <strong>{fmtDateTime(sync.last_run_at)}</strong></span>
            : <span style={{ color: '#b45309' }}>⚠ Never synced</span>}
          {sync?.last_error && <span style={{ color: '#b91c1c' }}>· {sync.last_error}</span>}
          {syncMsg && <span style={{ color: syncMsg.startsWith('Sync failed') ? '#b91c1c' : '#15803d' }}>· {syncMsg}</span>}
        </div>
      </div>

      {/* Outlook-style 3-pane frame */}
      <div style={{
        display: 'flex', border: paneBorder, borderRadius: 8, overflow: 'hidden',
        height: 'calc(100vh - 200px)', minHeight: 520, marginTop: 10, background: '#fff',
      }}>
        {/* ---- Left: folder sidebar ---- */}
        <div style={{ width: sidebarW, background: '#f8fafc', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: 10 }}>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={startCompose}>✏️ Compose</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px' }}>
            {FOLDERS.map(f => {
              const total = f === 'All' ? emails.length : (folderCounts[f] || 0);
              const un = f === 'All' ? unread : (folderUnread[f] || 0);
              const active = folder === f;
              return (
                <button key={f} onClick={() => setFolder(f)}
                  style={{
                    width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                    background: active ? '#1a365d' : 'transparent', color: active ? '#fff' : '#334155',
                    borderRadius: 6, padding: '8px 10px', marginBottom: 2,
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5,
                    fontWeight: un > 0 ? 700 : 500,
                  }}>
                  <span>{folderIcon[f]}</span>
                  <span style={{ flex: 1 }}>{f}</span>
                  {un > 0 && (
                    <span style={{ background: active ? '#fff' : '#1a365d', color: active ? '#1a365d' : '#fff', borderRadius: 999, fontSize: 11, padding: '0 6px', fontWeight: 700 }}>{un}</span>
                  )}
                  <span style={{ opacity: 0.6, fontSize: 11.5 }}>{total}</span>
                </button>
              );
            })}
          </div>
          <div style={{ borderTop: paneBorder, padding: 8, display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={load} disabled={loading}>{loading ? '…' : '↻'}</button>
            <button className="btn btn-secondary btn-sm" style={{ flex: 2 }} onClick={handleSync} disabled={syncing} title="Fetch new mail from info@ now">
              {syncing ? 'Syncing…' : '⟳ Sync now'}
            </button>
          </div>
        </div>

        {/* draggable divider: sidebar ↔ list */}
        <div onMouseDown={(e) => startDrag('sidebar', e)} title="Drag to resize"
          style={{ width: 6, cursor: 'col-resize', background: '#eef2f7', flexShrink: 0 }} />

        {/* ---- Middle: conversation list ---- */}
        <div style={{ width: listW, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: 8, borderBottom: paneBorder }}>
            <input type="text" className="form-input" placeholder="Search sender or subject…"
              value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 20, color: '#64748b' }}>Loading…</div>
            ) : error ? (
              <div style={{ padding: 20, color: '#b91c1c' }}>Failed to load: {error}</div>
            ) : threads.length === 0 ? (
              <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>
                {emails.length === 0 ? 'No mail yet — click “Sync now”.' : 'No messages match your search.'}
              </div>
            ) : threads.map(({ rep: e, count, unread: un }) => {
              const f = folderOf(e.label_ids);
              const isSent = f === 'Sent';
              const party = isSent
                ? (e.to_emails && e.to_emails.length ? e.to_emails.join(', ') : '—')
                : (e.from_name || e.from_email || '—');
              const key = e.gmail_thread_id || `single-${e.id}`;
              const selected = selectedKey === key;
              const hasUnread = un > 0;
              return (
                <div key={key} onClick={() => openThread(e)}
                  style={{
                    padding: '10px 12px', borderBottom: paneBorder, cursor: 'pointer',
                    background: selected ? '#eef2ff' : hasUnread ? '#fff' : '#fff',
                    borderLeft: selected ? '3px solid #1a365d' : '3px solid transparent',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: hasUnread ? 700 : 500, fontSize: 13.5, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isSent && <span style={{ color: '#94a3b8', fontWeight: 400 }}>To: </span>}{party}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); toggleMark(e.id, 'flagged', e.flagged); }}
                        title={e.flagged ? 'Remove flag' : 'Flag for follow-up'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, opacity: e.flagged ? 1 : 0.3 }}
                      >🚩</button>
                      <span style={{ fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDateTime(e.received_at)}</span>
                    </span>
                  </div>
                  <div style={{ fontWeight: hasUnread ? 700 : 500, fontSize: 13, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {e.is_urgent && <span style={{ background: '#dc2626', color: '#fff', borderRadius: 4, fontSize: 10, fontWeight: 700, padding: '1px 5px', marginRight: 6 }}>URGENT</span>}
                    {folder === 'All' && <span className="status-badge" style={{ marginRight: 6, background: '#eef1f5', color: folderColor[f], fontWeight: 600, fontSize: 10.5 }}>{f}</span>}
                    {e.subject || '(no subject)'}
                    {count > 1 && <span style={{ marginLeft: 6, color: '#64748b', fontWeight: 600 }}>({count})</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {e.has_attachments && '📎 '}{e.snippet || ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* draggable divider: list ↔ reading pane */}
        <div onMouseDown={(e) => startDrag('list', e)} title="Drag to resize"
          style={{ width: 6, cursor: 'col-resize', background: '#eef2f7', flexShrink: 0 }} />

        {/* ---- Right: reading pane ---- */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#fff' }}>
          {loadingDetail ? (
            <div style={{ padding: 24, color: '#64748b' }}>Loading conversation…</div>
          ) : !thread ? (
            <div style={{ padding: 40, color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
              <div style={{ fontSize: 40 }}>✉️</div>
              <p>Select a message to read it here.</p>
            </div>
          ) : (
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>
                  {threadSubject}
                  {thread.length > 1 && <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}> · {thread.length} messages</span>}
                </h3>
                <button className="btn btn-secondary btn-sm" onClick={() => { setThread(null); setSelectedKey(null); }}>✕</button>
              </div>
              {actionMsg && (
                <div style={{ marginBottom: 6, fontSize: 12.5, color: actionMsg.startsWith('Action failed') ? '#b91c1c' : '#15803d' }}>{actionMsg}</div>
              )}

              <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
                {thread.map(m => {
                  const f = folderOf(m.label_ids);
                  const isOpen = expandedId === m.id;
                  const recipientCount = (m.to_emails || []).length + (m.cc_emails || []).length;
                  const inInbox = (m.label_ids || []).includes('INBOX');
                  const inTrash = (m.label_ids || []).includes('TRASH');
                  return (
                    <div key={m.id} style={{ border: paneBorder, borderRadius: 6, overflow: 'hidden' }}>
                      <div onClick={() => setExpandedId(isOpen ? null : m.id)}
                        style={{ padding: 10, cursor: 'pointer', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>
                            {m.from_name || m.from_email || '—'}
                            <span className="status-badge" style={{ marginLeft: 8, background: '#eef1f5', color: folderColor[f], fontWeight: 600 }}>{f}</span>
                          </div>
                          {!isOpen && <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.snippet || ''}</div>}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDateTime(m.received_at)}</div>
                      </div>

                      {isOpen && (
                        <div style={{ padding: 12 }}>
                          <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>
                            <div><strong>From:</strong> {m.from_name ? `${m.from_name} <${m.from_email || ''}>` : (m.from_email || '—')}</div>
                            <div><strong>To:</strong> {(m.to_emails || []).join(', ')}</div>
                            {m.cc_emails && m.cc_emails.length > 0 && <div><strong>Cc:</strong> {m.cc_emails.join(', ')}</div>}
                            <div><strong>Received:</strong> {fmtDateTime(m.received_at)}</div>
                          </div>

                          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn btn-primary btn-sm" onClick={() => startReply(false, m)}>↩ Reply</button>
                            {recipientCount > 1 && (
                              <button className="btn btn-secondary btn-sm" onClick={() => startReply(true, m)}>↩↩ Reply all</button>
                            )}
                            <button className="btn btn-secondary btn-sm" onClick={() => startForward(m)}>➦ Forward</button>
                            <span style={{ flex: 1 }} />
                            <button className="btn btn-secondary btn-sm" onClick={() => toggleMark(m.id, 'flagged', m.flagged)}
                              style={{ color: m.flagged ? '#b45309' : undefined, fontWeight: m.flagged ? 700 : undefined }}
                              title="Flag for follow-up">🚩 {m.flagged ? 'Flagged' : 'Flag'}</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => toggleMark(m.id, 'is_urgent', m.is_urgent)}
                              style={{ color: m.is_urgent ? '#dc2626' : undefined, fontWeight: m.is_urgent ? 700 : undefined }}
                              title="Mark as urgent">🔴 {m.is_urgent ? 'Urgent' : 'Urgent'}</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleAction('unread', m)} disabled={actioning}>● Unread</button>
                            {inInbox && <button className="btn btn-secondary btn-sm" onClick={() => handleAction('archive', m)} disabled={actioning}>🗄 Archive</button>}
                            {inTrash
                              ? <button className="btn btn-secondary btn-sm" onClick={() => handleAction('untrash', m)} disabled={actioning}>♻ Restore</button>
                              : <button className="btn btn-secondary btn-sm" onClick={() => handleAction('trash', m)} disabled={actioning} style={{ color: '#b91c1c' }}>🗑 Trash</button>}
                          </div>

                          <div style={{ marginTop: 10, padding: 10, background: '#f1f5f9', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 13 }}>Save to client:</strong>
                            <div style={{ minWidth: 220, flex: 1 }}>
                              <SearchableSelect
                                value={assignClientId === '' ? '' : String(assignClientId)}
                                options={clientOptions}
                                onChange={(v) => setAssignClientId(v ? Number(v) : '')}
                                placeholder="Search and pick a client…"
                                allowClear
                              />
                            </div>
                            <button className="btn btn-primary btn-sm" onClick={() => handleAssign(m.id)} disabled={assigning || !assignClientId}>
                              {assigning ? 'Filing…' : 'Assign'}
                            </button>
                          </div>
                          {assignMsg && (
                            <div style={{ marginTop: 6, fontSize: 12.5, color: assignMsg.startsWith('Assign failed') ? '#b91c1c' : '#15803d' }}>{assignMsg}</div>
                          )}

                          {m.attachments && m.attachments.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <strong style={{ fontSize: 13 }}>Attachments ({m.attachments.length})</strong>
                              <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0 0' }}>
                                {m.attachments.map(att => (
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

                          <div style={{ marginTop: 12, padding: 12, border: paneBorder, borderRadius: 6, fontSize: 14, lineHeight: 1.45 }}>
                            <div dangerouslySetInnerHTML={{ __html: sanitiseBody(m) }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Compose modal (rich text) ---- */}
      {compose && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 110, padding: '32px 16px', overflowY: 'auto',
        }} onClick={() => !sending && setCompose(null)}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: composeMax ? '96vw' : '100%', maxWidth: composeMax ? 1200 : 760 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>
                {compose.mode === 'forward' ? 'Forward' : compose.mode === 'new' ? 'New email' : 'Reply'}
                <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}> — from {INFO_ADDRESS}</span>
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setComposeMax(m => !m)} title={composeMax ? 'Restore size' : 'Enlarge window'}>{composeMax ? '🗗 Restore' : '🗖 Enlarge'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setCompose(null)} disabled={sending}>✕</button>
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12.5, color: '#475569' }}>
                To <span style={{ color: '#94a3b8' }}>(comma-separated)</span>
                <input className="form-input" value={compose.to}
                  onChange={e => setCompose({ ...compose, to: e.target.value })}
                  placeholder="name@example.com" autoFocus />
              </label>
              <label style={{ fontSize: 12.5, color: '#475569' }}>
                Cc
                <input className="form-input" value={compose.cc}
                  onChange={e => setCompose({ ...compose, cc: e.target.value })}
                  placeholder="optional" />
              </label>
              <label style={{ fontSize: 12.5, color: '#475569' }}>
                Subject
                <input className="form-input" value={compose.subject}
                  onChange={e => setCompose({ ...compose, subject: e.target.value })} />
              </label>
              <div>
                <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 4 }}>Message</div>
                <RichTextEditor
                  value={compose.body}
                  onChange={(html) => setCompose(c => c ? { ...c, body: html } : c)}
                  minHeight={composeMax ? 440 : 220}
                  ariaLabel="Email message body"
                />
                {!sigHtml && (
                  <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                    Tip: set a firm signature in Settings → Firm Email so it's added automatically.
                  </div>
                )}
              </div>
              <label style={{ fontSize: 12.5, color: '#475569' }}>
                Attachments
                <input type="file" multiple className="form-input"
                  onChange={e => setCompose({ ...compose, files: Array.from(e.target.files || []) })} />
              </label>
              {compose.files.length > 0 && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {compose.files.map(f => `${f.name} (${fmtSize(f.size)})`).join(', ')}
                </div>
              )}
            </div>

            {sendErr && <div style={{ marginTop: 8, fontSize: 13, color: '#b91c1c' }}>{sendErr}</div>}

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setCompose(null)} disabled={sending}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending}>
                {sending ? 'Sending…' : '➤ Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
