import { useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

// Bulk email composer. Compose once, pick many clients, send through the firm
// account (info@). Sends sequentially so one bad address doesn't abort the run;
// per-recipient {name} is merged from the client record.

type Row = { id: number; name: string; client_code: string | null; email: string | null };

// Read a File into a base64 string (no data: prefix) for the attachment payload.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      resolve(res.includes(',') ? res.split(',')[1] : res);
    };
    reader.onerror = () => reject(new Error('Could not read the attachment.'));
    reader.readAsDataURL(file);
  });
}

export default function BulkEmail() {
  const { clients } = useApp();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ sent: number; fails: string[] } | null>(null);

  // Only clients with an email address are mailable.
  const rows: Row[] = useMemo(
    () => (clients as any[])
      .map(c => ({ id: c.id, name: c.name, client_code: c.client_code || null, email: c.email || null }))
      .filter(r => r.email),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.client_code || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q));
  }, [rows, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAllFiltered = () => setSelected(prev => {
    const next = new Set(prev);
    if (allFilteredSelected) filtered.forEach(r => next.delete(r.id));
    else filtered.forEach(r => next.add(r.id));
    return next;
  });

  const selectedRows = useMemo(() => rows.filter(r => selected.has(r.id)), [rows, selected]);

  const handleSend = async () => {
    if (selectedRows.length === 0) { alert('Select at least one client.'); return; }
    if (!subject.trim()) { alert('Enter a subject.'); return; }
    if (!body.trim()) { alert('Enter a message body.'); return; }
    if (!confirm(`Send this email to ${selectedRows.length} client(s) from info@?`)) return;

    setSending(true);
    setResults(null);

    let attachment: { filename: string; contentBase64: string; contentType?: string } | undefined;
    if (file) {
      try {
        attachment = { filename: file.name, contentBase64: await fileToBase64(file), contentType: file.type || 'application/octet-stream' };
      } catch (e: any) {
        setSending(false); alert(e.message); return;
      }
    }

    let sent = 0;
    const fails: string[] = [];
    for (let i = 0; i < selectedRows.length; i++) {
      const r = selectedRows[i];
      setProgress(`Sending ${i + 1} of ${selectedRows.length}…`);
      // Per-recipient personalisation: {name} / {client_name} → the client's name.
      const subj = subject.replace(/\{(name|client_name)\}/gi, r.name);
      const text = body.replace(/\{(name|client_name)\}/gi, r.name);
      const html = text.split('\n').map(l => `<p>${(l || '&nbsp;')}</p>`).join('');
      try {
        await api.sendViaOutlook({
          from_firm: true,
          to: r.email!,
          subject: subj,
          body: text,
          html,
          attachments: attachment ? [attachment] : undefined,
        });
        sent++;
      } catch (err: any) {
        fails.push(`${r.name}: ${err.message}`);
      }
    }
    setProgress('');
    setSending(false);
    setResults({ sent, fails });
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>📨 Bulk Email</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Compose once and send to many clients from <strong>info@primeandcalculate.com</strong>.
        Use <code>{'{name}'}</code> in the subject or body to insert each client's name. Replies come back to the shared Inbox.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Recipients */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Recipients ({selected.size})</strong>
            <button className="btn btn-link btn-sm" onClick={toggleAllFiltered} style={{ padding: 0 }}>
              {allFilteredSelected ? 'Clear shown' : 'Select shown'}
            </button>
          </div>
          <input type="text" className="form-input" placeholder="Search clients…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>No clients with an email address.</div>
            ) : filtered.map(r => (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  {r.client_code && <span style={{ color: '#94a3b8' }}> · {r.client_code}</span>}
                  <br /><span style={{ color: '#64748b', fontSize: 12 }}>{r.email}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Compose */}
        <div className="card" style={{ padding: 16 }}>
          <div className="form-group full-width">
            <label>Subject *</label>
            <input type="text" className="form-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Reminder: {name}, your VAT return is due" />
          </div>
          <div className="form-group full-width">
            <label>Message *</label>
            <textarea className="form-input" rows={12} value={body} onChange={e => setBody(e.target.value)}
              placeholder={'Dear {name},\n\n…\n\nKind regards,\nPC Prime & Calculate Consultants Ltd'} style={{ width: '100%' }} />
            <small style={{ color: '#64748b', fontSize: '0.78em' }}>Plain text; line breaks become paragraphs. The firm signature is appended automatically.</small>
          </div>
          <div className="form-group full-width">
            <label>Attachment (optional)</label>
            <input type="file" className="form-input" onChange={e => setFile(e.target.files?.[0] || null)} />
            {file && <small style={{ color: '#64748b' }}>{file.name} — sent to all {selected.size} recipient(s).</small>}
          </div>

          {progress && <div style={{ marginTop: 8, fontSize: 13, color: '#1a365d' }}>{progress}</div>}
          {results && (
            <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 4, fontSize: 13,
              background: results.fails.length ? '#fef9c3' : '#dcfce7',
              border: `1px solid ${results.fails.length ? '#fde047' : '#86efac'}`, whiteSpace: 'pre-wrap' }}>
              Sent {results.sent} of {results.sent + results.fails.length}.
              {results.fails.length > 0 && `\n\nFailed:\n${results.fails.join('\n')}`}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending || selected.size === 0}>
              {sending ? 'Sending…' : `Send to ${selected.size} client${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
