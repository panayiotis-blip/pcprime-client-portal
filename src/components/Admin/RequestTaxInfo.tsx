import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { requestEmailTemplate } from '../shared/taxReturnChecklist';
import type { ChecklistFormType } from '../shared/taxReturnChecklist';

// Request Tax Info — pick clients and send a standardized "we need this
// information for your tax return" message from the firm account (info@).
// The document list is the same checklist used by the pre-start gate, so what
// we ask for matches what we tick off internally.

type Row = { id: number; name: string; client_code: string | null; email: string | null; category?: string | null };

const CURRENT_YEAR = new Date().getFullYear();
// Returns are filed for the prior year, so default to last year.
const DEFAULT_TAX_YEAR = CURRENT_YEAR - 1;

export default function RequestTaxInfo() {
  const { clients } = useApp();
  const [formType, setFormType] = useState<ChecklistFormType>('individuals');
  const [taxYear, setTaxYear] = useState<number>(DEFAULT_TAX_YEAR);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false); // becomes true once staff edit the text
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ sent: number; fails: string[] } | null>(null);

  // (Re)load the template when form type / year changes, unless staff have
  // hand-edited the message (don't clobber their wording).
  useEffect(() => {
    if (dirty) return;
    const t = requestEmailTemplate(formType, taxYear);
    setSubject(t.subject);
    setBody(t.body);
  }, [formType, taxYear, dirty]);

  const resetTemplate = () => {
    const t = requestEmailTemplate(formType, taxYear);
    setSubject(t.subject);
    setBody(t.body);
    setDirty(false);
  };

  const rows: Row[] = useMemo(
    () => (clients as any[])
      .map(c => ({ id: c.id, name: c.name, client_code: c.client_code || null, email: c.email || null, category: c.client_category || c.category || null }))
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
    if (!subject.trim() || !body.trim()) { alert('Subject and message are required.'); return; }
    if (!confirm(`Send the ${taxYear} information request to ${selectedRows.length} client(s) from info@?`)) return;

    setSending(true);
    setResults(null);
    let sent = 0;
    const fails: string[] = [];
    for (let i = 0; i < selectedRows.length; i++) {
      const r = selectedRows[i];
      setProgress(`Sending ${i + 1} of ${selectedRows.length}…`);
      const subj = subject.replace(/\{(name|client_name)\}/gi, r.name);
      const text = body.replace(/\{(name|client_name)\}/gi, r.name);
      const html = text.split('\n').map(l => `<p>${(l || '&nbsp;')}</p>`).join('');
      try {
        await api.sendViaOutlook({ from_firm: true, to: r.email!, subject: subj, body: text, html });
        sent++;
        api.logOutboundClientEmail(r.id, { subject: subj, html, plain: text, recipients: [r.email!] }).catch(() => {});
      } catch (err: any) {
        fails.push(`${r.name}: ${err.message}`);
      }
    }
    setProgress('');
    setSending(false);
    setResults({ sent, fails });
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    border: '1px solid ' + (active ? '#1a365d' : '#cbd5e1'),
    background: active ? '#1a365d' : '#fff', color: active ? '#fff' : '#475569',
  });

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>🧾 Request Tax Info</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Send clients a standardized request for the documents needed to prepare their tax return, from{' '}
        <strong>info@primeandcalculate.com</strong>. The list matches the pre-start checklist. Use{' '}
        <code>{'{name}'}</code> to insert each client's name. Replies come back to the shared Inbox.
      </p>

      {/* Form type + year controls */}
      <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Return type:</span>
          <button style={tabBtn(formType === 'individuals')} onClick={() => setFormType('individuals')}>Individual (employee)</button>
          <button style={tabBtn(formType === 'self_employed')} onClick={() => setFormType('self_employed')}>Self-employed</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Tax year:</span>
          <input type="number" className="form-input" style={{ width: 100 }} value={taxYear}
            onChange={e => setTaxYear(Number(e.target.value) || DEFAULT_TAX_YEAR)} />
        </div>
        <button className="btn btn-link btn-sm" onClick={resetTemplate} style={{ marginLeft: 'auto' }}>
          Reset message to template
        </button>
      </div>

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
            <input type="text" className="form-input" value={subject}
              onChange={e => { setSubject(e.target.value); setDirty(true); }} />
          </div>
          <div className="form-group full-width">
            <label>Message *</label>
            <textarea className="form-input" rows={16} value={body}
              onChange={e => { setBody(e.target.value); setDirty(true); }} style={{ width: '100%' }} />
            <small style={{ color: '#64748b', fontSize: '0.78em' }}>
              Plain text; line breaks become paragraphs. The firm signature is appended automatically.
              Switching return type/year refreshes the list unless you’ve edited the message.
            </small>
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
              {sending ? 'Sending…' : `Send request to ${selected.size} client${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
