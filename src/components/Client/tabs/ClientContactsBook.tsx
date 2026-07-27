import { useEffect, useState } from 'react';
import { api } from '../../../services/api';

// The client's own customers and suppliers, held so the firm can bulk-email
// them ON THE CLIENT'S BEHALF (e.g. supplier statements). Customers reuse the
// existing `customer` table; suppliers use `supplier` (migration 154).

type Contact = {
  id: number; owner_client_id: number; name: string; code: string | null;
  contact_person: string | null; email: string | null; phone: string | null;
  vat_number: string | null; address: string | null; notes: string | null; active: boolean;
};
type Kind = 'customer' | 'supplier';
const blank = (clientId: number): Partial<Contact> => ({ owner_client_id: clientId, name: '', active: true });

export default function ClientContactsBook({ clientId, clientName }: { clientId: number; clientName: string }) {
  return (
    <div className="client-tab-content">
      <ContactSection kind="customer" title="Customers" clientId={clientId} clientName={clientName} />
      <ContactSection kind="supplier" title="Suppliers" clientId={clientId} clientName={clientName} />
    </div>
  );
}

function ContactSection({ kind, title, clientId, clientName }: { kind: Kind; title: string; clientId: number; clientName: string }) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Partial<Contact> | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [compose, setCompose] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  const list = () => (kind === 'customer' ? api.getCustomers(clientId) : api.getSuppliers(clientId));
  const save = (row: any) => (kind === 'customer' ? api.saveCustomer(row) : api.saveSupplier(row));
  const del = (id: number) => (kind === 'customer' ? api.deleteCustomer(id) : api.deleteSupplier(id));

  const load = () => { setLoading(true); list().then(r => setRows(r as Contact[])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const commit = async () => {
    if (!draft?.name?.trim()) { alert('Name is required.'); return; }
    try { await save({ ...draft, name: draft.name.trim(), owner_client_id: clientId }); setDraft(null); load(); }
    catch (e: any) { alert('Save failed: ' + (e?.message || e)); }
  };
  const remove = async (c: Contact) => {
    if (!confirm(`Delete ${kind} "${c.name}"?`)) return;
    try { await del(c.id); setSel(p => { const n = new Set(p); n.delete(c.id); return n; }); load(); }
    catch (e: any) { alert('Delete failed: ' + (e?.message || e)); }
  };
  const toggle = (id: number) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const doImport = async () => {
    const lines = importText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) { alert('Paste some rows first.'); return; }
    setImportBusy(true);
    let added = 0, skipped = 0;
    for (const line of lines) {
      const parts = line.split(/[,\t;]/).map(p => p.trim());
      const [code = '', name = '', email = '', phone = ''] = parts;
      if (!name) { skipped++; continue; }
      // Skip a header row (e.g. "Code, Name, Email, Telephone").
      if (/^name$/i.test(name) || /^code$/i.test(code)) { skipped++; continue; }
      try {
        await save({ owner_client_id: clientId, code: code || null, name, email: email || null, phone: phone || null });
        added++;
      } catch { skipped++; }
    }
    setImportBusy(false); setImportOpen(false); setImportText(''); load();
    alert(`Imported ${added} ${kind}${added === 1 ? '' : 's'}.` + (skipped ? ` ${skipped} row(s) skipped.` : ''));
  };

  const withEmail = rows.filter(r => r.email && r.email.trim());
  const selectedWithEmail = rows.filter(r => sel.has(r.id) && r.email && r.email.trim());

  return (
    <div className="form-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{title} <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 14 }}>({rows.length})</span></h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setDraft(blank(clientId))}>+ Add {kind}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>⭱ Import</button>
          <button className="btn btn-primary btn-sm" disabled={withEmail.length === 0}
            title={withEmail.length === 0 ? 'No email addresses to send to' : `Email ${kind}s on behalf of ${clientName}`}
            onClick={() => { if (!sel.size) setSel(new Set(withEmail.map(r => r.id))); setCompose(true); }}>
            ✉ Bulk email{sel.size ? ` (${selectedWithEmail.length})` : ''}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 0' }}>No {kind}s yet.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="export-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox"
                    checked={selectedWithEmail.length > 0 && selectedWithEmail.length === withEmail.length}
                    onChange={e => setSel(e.target.checked ? new Set(withEmail.map(r => r.id)) : new Set())}
                    title="Select all with an email" />
                </th>
                <th style={{ whiteSpace: 'nowrap' }}>Code</th><th>Name</th><th>Email</th><th>Telephone</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td><input type="checkbox" checked={sel.has(c.id)} disabled={!c.email} onChange={() => toggle(c.id)} /></td>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{c.code || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.email || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td>{c.phone || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDraft(c)}>Edit</button>{' '}
                    <button className="btn btn-secondary btn-sm" onClick={() => remove(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal title={draft.id ? `Edit ${kind}` : `New ${kind}`} onClose={() => setDraft(null)}>
          <div className="form-grid">
            {([['code', 'Code'], ['name', 'Name *'], ['email', 'Email'], ['phone', 'Telephone'], ['contact_person', 'Contact person'], ['vat_number', 'VAT number'], ['address', 'Address']] as const).map(([k, label]) => (
              <div className="form-group" key={k} style={k === 'address' ? { gridColumn: '1 / -1' } : undefined}>
                <label>{label}</label>
                <input className="form-input" value={(draft as any)[k] || ''} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} />
              </div>
            ))}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <textarea className="form-input" rows={2} value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={commit}>Save</button>
          </div>
        </Modal>
      )}

      {compose && (
        <BulkEmail
          kind={kind} clientName={clientName}
          recipients={selectedWithEmail.length ? selectedWithEmail : withEmail}
          onClose={() => setCompose(false)}
        />
      )}

      {importOpen && (
        <Modal title={`Import ${kind}s`} onClose={() => setImportOpen(false)}>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
            Four columns per line — <code>Code, Name, Email, Telephone</code> (only Name is required).
            Commas, tabs or semicolons all work — paste straight from a spreadsheet.
          </p>
          <textarea
            className="form-input" rows={10} value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={'SUP001, ACME Ltd, accounts@acme.com, 99123456\nSUP002, Beta Trading, info@beta.com, 99765432'}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => setImportOpen(false)} disabled={importBusy}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={importBusy || !importText.trim()}>
              {importBusy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 22, width: 'min(640px,100%)', marginTop: 40, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function BulkEmail({ kind, clientName, recipients, onClose }: { kind: Kind; clientName: string; recipients: Contact[]; onClose: () => void }) {
  const [subject, setSubject] = useState(kind === 'supplier' ? `Statement of account from ${clientName}` : `A message from ${clientName}`);
  const [body, setBody] = useState(`Dear {contact},\n\nOn behalf of ${clientName}, please find our message below.\n\n\n\nKind regards,\n${clientName}`);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<{ sent: number; fails: string[] } | null>(null);

  const send = async () => {
    setSending(true); setResult(null);
    let sent = 0; const fails: string[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      setProgress(`Sending ${i + 1} of ${recipients.length}…`);
      const person = (r.contact_person || r.name || '').trim();
      const text = body.replace(/\{contact\}/gi, person).replace(/\{name\}/gi, r.name || '').replace(/\{client\}/gi, clientName);
      // Convert the plain text to HTML with real line breaks — email clients
      // strip white-space:pre-wrap, so newlines must become <br> to render.
      const escaped = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${escaped.replace(/\r?\n/g, '<br>')}</div>`;
      try {
        await api.sendViaOutlook({ from_firm: true, to: r.email!, subject: subject.replace(/\{client\}/gi, clientName), body: text, html });
        sent++;
      } catch (e: any) { fails.push(`${r.name}: ${e?.message || e}`); }
    }
    setProgress(''); setSending(false); setResult({ sent, fails });
  };

  return (
    <Modal title={`Email ${recipients.length} ${kind}${recipients.length === 1 ? '' : 's'} — on behalf of ${clientName}`} onClose={onClose}>
      {result ? (
        <div>
          <p style={{ color: '#047857', fontWeight: 600 }}>Sent {result.sent} of {recipients.length}.</p>
          {result.fails.length > 0 && (
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              <p style={{ fontWeight: 600 }}>Failed:</p>
              {result.fails.map((f, i) => <div key={i}>{f}</div>)}
            </div>
          )}
          <div style={{ textAlign: 'right', marginTop: 12 }}><button className="btn btn-primary" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            Sent from the firm's mailbox on {clientName}'s behalf, to {recipients.length} {kind}{recipients.length === 1 ? '' : 's'} with an email address.
            Merge fields: <code>{'{contact}'}</code>, <code>{'{name}'}</code>, <code>{'{client}'}</code>.
          </p>
          <div className="form-group"><label>Subject</label>
            <input className="form-input" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="form-group"><label>Message</label>
            <textarea className="form-input" rows={9} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>{progress}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
              <button className="btn btn-primary" onClick={send} disabled={sending || !subject.trim()}>{sending ? 'Sending…' : `Send to ${recipients.length}`}</button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
