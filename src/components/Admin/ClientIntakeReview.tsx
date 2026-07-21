import { useEffect, useMemo, useState } from 'react';
import { api, type IntakeAttachment } from '../../services/api';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';

// Staff review/approve queue for client onboarding submissions. Each submission
// is diffed against the live client record; staff pick which changes to apply
// (clients never silently overwrite firm data). Extra info the client gave
// (employment, KYC, lists) is shown and captured to a client note on approve.

type Sub = {
  id: number; token: string; client_id: number | null; mode: string; status: string;
  payload: any; prefill: any; notes: string | null;
  created_at: string; sent_at: string | null; submitted_at: string | null;
  attachments?: IntakeAttachment[];
};

const KIND_LABELS: Record<string, string> = {
  id: 'ID card', passport: 'Passport', proof_of_address: 'Proof of address',
  tax_doc: 'Tax document', other: 'Document',
};
// Files of these kinds belong in the restricted KYC bucket; the rest in general docs.
const kycKinds = new Set(['id', 'passport', 'proof_of_address']);

// Core payload-key -> client column mappings that approve can apply directly.
const CORE: { k: string; col: string; label: string }[] = [
  { k: 'name', col: 'name', label: 'Legal / full name' },
  { k: 'name_tax_office', col: 'name_tax_office', label: 'Name (Greek/tax office)' },
  { k: 'trading_name', col: 'trading_name', label: 'Trading name' },
  { k: 'client_category', col: 'client_category', label: 'Category' },
  { k: 'id_number', col: 'id_number', label: 'ID number' },
  { k: 'passport_number', col: 'passport_number', label: 'Passport number' },
  { k: 'date_of_birth', col: 'date_of_birth', label: 'Date of birth' },
  { k: 'nationality', col: 'nationality', label: 'Nationality' },
  { k: 'registration_number', col: 'registration_number', label: 'Registration (HE) no.' },
  { k: 'incorporation_date', col: 'incorporation_date', label: 'Incorporation date' },
  { k: 'phone', col: 'phone', label: 'Phone' },
  { k: 'mobile', col: 'mobile', label: 'Mobile' },
  { k: 'email', col: 'email', label: 'Email' },
  { k: 'website', col: 'website', label: 'Website' },
  { k: 'contact_person', col: 'contact_person', label: 'Contact person' },
  { k: 'addr_line1', col: 'address', label: 'Address' },
  { k: 'addr_city', col: 'city', label: 'City' },
  { k: 'addr_postal', col: 'postal_code', label: 'Postal code' },
  { k: 'addr_country', col: 'country', label: 'Country' },
  { k: 'tax_number', col: 'tax_number', label: 'Tax number (TIC)' },
  { k: 'vat_number', col: 'vat_number', label: 'VAT number' },
  { k: 'social_insurance_number', col: 'social_insurance_number', label: 'Social Insurance no.' },
  { k: 'employer_number', col: 'employer_number', label: 'SI employer no.' },
];
const CORE_KEYS = new Set(CORE.map((c) => c.k));
const CATEGORY_MAP: Record<string, string> = {
  Individual: 'individual', 'Self-employed': 'self_employed', Company: 'company',
  Partnership: 'partnership', Other: 'other',
};
const norm = (v: any) => (Array.isArray(v) ? v.join('; ') : String(v ?? '')).trim();

export default function ClientIntakeReview() {
  const { clients } = useApp();
  const [rows, setRows] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'submitted' | 'sent' | 'all'>('submitted');
  // Link generator
  const [linkClient, setLinkClient] = useState<string>('');
  const [newLink, setNewLink] = useState<string>('');
  const [linkBusy, setLinkBusy] = useState(false);

  // Bulk send
  const DEFAULT_SUBJECT = 'Please confirm your details are up to date';
  const DEFAULT_MSG =
    'Dear {name},\n\nAs part of keeping your records up to date, please review and confirm your details using your secure link below:\n\n{link}\n\nIt only takes a few minutes. If anything is out of date, please correct it and submit.\n\nKind regards,\nPC Prime & Calculate Consultants Ltd';
  const [bulkSel, setBulkSel] = useState<Set<number>>(new Set());
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkSubj, setBulkSubj] = useState(DEFAULT_SUBJECT);
  const [bulkMsg, setBulkMsg] = useState(DEFAULT_MSG);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkResult, setBulkResult] = useState<{ sent: number; fails: string[] } | null>(null);

  const firstEmail = (v: any) => (Array.isArray(v) ? v[0] : v) || '';
  const mailable = useMemo(() => (clients as any[]).filter((c) => firstEmail(c.email)), [clients]);
  const bulkShown = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    if (!q) return mailable;
    return mailable.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.client_code || '').toLowerCase().includes(q));
  }, [mailable, bulkSearch]);
  const toggleBulk = (id: number) => setBulkSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sendBulk = async () => {
    const recips = mailable.filter((c) => bulkSel.has(c.id));
    if (!recips.length) { alert('Select at least one client.'); return; }
    if (!bulkSubj.trim() || !bulkMsg.includes('{link}')) { alert('Subject required, and the message must include {link}.'); return; }
    if (!confirm(`Send the onboarding/refresh request to ${recips.length} client(s) from info@?`)) return;
    setBulkBusy(true); setBulkResult(null);
    let sent = 0; const fails: string[] = [];
    for (let i = 0; i < recips.length; i++) {
      const c = recips[i];
      setBulkProgress(`Sending ${i + 1} of ${recips.length}…`);
      try {
        const { token } = await api.createClientIntake({ clientId: c.id, mode: 'refresh', expiresInDays: 30 });
        const url = `${window.location.origin}/client-intake/${token}`;
        const subj = bulkSubj.replace(/\{name\}/gi, c.name);
        const text = bulkMsg.replace(/\{name\}/gi, c.name).replace(/\{link\}/gi, url);
        const html = text.split('\n').map((l) => `<p>${l || '&nbsp;'}</p>`).join('').replace(url, `<a href="${url}">${url}</a>`);
        await api.sendViaOutlook({ from_firm: true, to: firstEmail(c.email), subject: subj, body: text, html });
        api.logOutboundClientEmail(c.id, { subject: subj, html, plain: text, recipients: [firstEmail(c.email)] }).catch(() => {});
        sent++;
      } catch (e: any) { fails.push(`${c.name}: ${e.message}`); }
    }
    setBulkProgress(''); setBulkBusy(false); setBulkSel(new Set()); setBulkResult({ sent, fails }); load();
  };

  const createLink = async () => {
    setLinkBusy(true); setNewLink('');
    try {
      const clientId = linkClient ? Number(linkClient) : null;
      const { token } = await api.createClientIntake({ clientId, mode: clientId ? 'refresh' : 'new', expiresInDays: 30 });
      setNewLink(`${window.location.origin}/client-intake/${token}`);
    } catch (e: any) {
      alert('Could not create link: ' + e.message);
    } finally {
      setLinkBusy(false);
    }
  };
  const [sel, setSel] = useState<Sub | null>(null);
  const [live, setLive] = useState<any | null>(null);
  const [apply, setApply] = useState<Record<string, boolean>>({});
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.listClientIntakes().then((d) => setRows(d as Sub[])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const shown = useMemo(
    () => rows.filter((r) =>
      tab === 'submitted' ? r.status === 'submitted'
        : tab === 'sent' ? r.status === 'pending'
        : true),
    [rows, tab],
  );

  // Follow-up due: requested over a year ago and never replied, or last
  // approved over a year ago (annual refresh cycle).
  const followUpDue = (r: Sub): boolean => {
    const ref = r.submitted_at || r.created_at;
    if (!ref) return false;
    return (Date.now() - new Date(ref).getTime()) > 365 * 864e5;
  };
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');

  const openReview = async (s: Sub) => {
    setSel(s); setLive(null);
    let current: any = s.prefill || {};
    if (s.client_id) {
      try { current = await api.getClient(s.client_id); } catch { /* fall back to prefill */ }
    }
    setLive(current);
    // Pre-tick every changed core field.
    const next: Record<string, boolean> = {};
    for (const c of CORE) {
      const sub = norm(s.payload?.[c.k]);
      const cur = norm(c.k === 'addr_line1' ? current.address : current[c.col] ?? current[c.k]);
      if (sub && sub !== cur) next[c.k] = true;
    }
    setApply(next);
    // Default-on for brand-new clients (they have no login yet); off for an
    // existing client, who likely already has portal access.
    setInvite(!s.client_id);
  };

  const diffs = useMemo(() => {
    if (!sel) return [];
    return CORE.map((c) => {
      const submitted = norm(sel.payload?.[c.k]);
      const onFile = norm(c.k === 'addr_line1' ? live?.address : live?.[c.col] ?? live?.[c.k]);
      return { ...c, submitted, onFile, changed: !!submitted && submitted !== onFile };
    });
  }, [sel, live]);

  // Extra (non-core) payload entries to show + capture as a note.
  const extras = useMemo(() => {
    if (!sel?.payload) return [];
    return Object.entries(sel.payload).filter(
      ([k, v]) => !CORE_KEYS.has(k) && !k.startsWith('_') && v != null && v !== '' &&
        !(Array.isArray(v) && v.length === 0),
    );
  }, [sel]);

  const extrasNote = () =>
    extras.map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`).join('\n');

  const openAttachment = async (a: IntakeAttachment) => {
    try {
      const url = await api.intakeAttachmentUrl(a.storage_path);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      alert('Could not open the file: ' + e.message);
    }
  };

  const approve = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const patch: any = {};
      for (const d of diffs) {
        if (!d.changed || !apply[d.k]) continue;
        let val: any = sel.payload[d.k];
        if (d.col === 'client_category') val = CATEGORY_MAP[val] || String(val).toLowerCase();
        patch[d.col] = val;
      }
      let clientId = sel.client_id;
      if (clientId) {
        if (Object.keys(patch).length) await api.updateClient(clientId, patch);
      } else {
        if (!patch.name) { alert('A name is required to create a new client.'); setBusy(false); return; }
        clientId = (await api.createClient(patch)).id;
      }
      // Capture the extra info (employment / KYC / lists) so it isn't lost.
      if (clientId && extras.length) {
        try {
          await api.createClientNote(clientId, {
            body: `Onboarding submission (${new Date().toLocaleDateString('en-GB')}):\n${extrasNote()}`,
            needs_attention: true,
          });
        } catch { /* note is best-effort */ }
      }
      // File any attachments into the client's permanent Documents (KYC docs go
      // to the restricted bucket). Best-effort: a failure here doesn't block the
      // approval — the files remain in the intake bucket for manual handling.
      if (clientId && sel.attachments?.length) {
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM
        for (const a of sel.attachments) {
          try {
            const url = await api.intakeAttachmentUrl(a.storage_path);
            const blob = await (await fetch(url)).blob();
            const file = new File([blob], a.name, { type: a.mime || blob.type });
            await api.uploadDocumentsToFolder({
              clientId, docType: 'document',
              category: kycKinds.has(a.kind) ? 'kyc' : 'other',
              month, files: [file],
              notes: `From onboarding submission — ${KIND_LABELS[a.kind] || a.kind}`,
            });
          } catch { /* leave it in the intake bucket if the copy fails */ }
        }
      }

      // Optionally give the client portal access — emails a secure setup link
      // (reuses the same invite path as the Applications approve flow). This is
      // best-effort: approval still stands if the invite can't be sent.
      let inviteWarning = '';
      if (invite && clientId) {
        const email = String(
          sel.payload?.email || (Array.isArray(live?.email) ? live.email[0] : live?.email) || '',
        ).trim();
        const full_name = String(patch.name || sel.payload?.name || live?.name || '').trim() || undefined;
        if (!email) {
          inviteWarning = 'No email address was on the submission, so the portal invite was not sent.';
        } else {
          try {
            await api.inviteClient({ email, full_name, client_id: clientId });
          } catch (e: any) {
            inviteWarning = `Client approved, but the portal invite could not be sent: ${e.message}`;
          }
        }
      }
      await api.reviewClientIntake(sel.id, { status: 'approved' });
      if (inviteWarning) alert(inviteWarning);
      setSel(null); load();
    } catch (e: any) {
      alert('Approve failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!sel) return;
    const notes = prompt('Reason for rejecting (optional):') || undefined;
    setBusy(true);
    try {
      await api.reviewClientIntake(sel.id, { status: 'rejected', notes });
      setSel(null); load();
    } catch (e: any) {
      alert('Reject failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const pill = (s: string) => {
    const m: Record<string, string> = { submitted: '#9b861f', approved: '#047857', rejected: '#b91c1c', pending: '#64748b' };
    return <span style={{ fontSize: 12, fontWeight: 600, color: m[s] || '#64748b' }}>{s}</span>;
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>📝 Onboarding submissions</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Review what clients submitted and apply the changes you accept. Nothing updates a client record until you approve it.
      </p>

      {/* Create an onboarding / refresh link to send a client */}
      <div className="card" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Create link:</span>
        <SearchableSelect
          value={linkClient}
          options={toClientOptions(clients)}
          onChange={v => setLinkClient(v ? String(v) : '')}
          placeholder="New client (blank intake)"
          allowClear
        />
        <button className="btn btn-primary btn-sm" onClick={createLink} disabled={linkBusy}>
          {linkBusy ? 'Creating…' : 'Generate link'}
        </button>
        {newLink && (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flex: '1 1 100%', marginTop: 6 }}>
            <input className="form-input" readOnly value={newLink} style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
            <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(newLink)}>Copy</button>
          </span>
        )}
      </div>

      {/* Bulk send onboarding / refresh requests */}
      <details className="card" style={{ padding: 12, marginBottom: 14 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1a365d' }}>
          Send onboarding / refresh requests to many clients
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14, marginTop: 12 }}>
          <div>
            <input className="form-input" placeholder="Search clients…" value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{bulkSel.size} selected</div>
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 }}>
              {bulkShown.length === 0 ? <div style={{ padding: 10, color: '#94a3b8', fontSize: 13 }}>No clients with an email.</div> :
                bulkShown.map((c) => (
                  <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 9px', borderBottom: '1px solid #f1f5f9', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={bulkSel.has(c.id)} onChange={() => toggleBulk(c.id)} />
                    <span>{c.name}{c.client_code ? ` · ${c.client_code}` : ''}</span>
                  </label>
                ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="form-input" value={bulkSubj} onChange={(e) => setBulkSubj(e.target.value)} placeholder="Subject" />
            <textarea className="form-input" rows={9} value={bulkMsg} onChange={(e) => setBulkMsg(e.target.value)} style={{ resize: 'vertical' }} />
            <small style={{ color: '#64748b', fontSize: '0.78em' }}>Each client gets their own secure link. Use {'{name}'} and {'{link}'} (required). Sent from info@; the request date is recorded.</small>
            {bulkProgress && <div style={{ fontSize: 13, color: '#1a365d' }}>{bulkProgress}</div>}
            {bulkResult && (
              <div style={{ fontSize: 13, padding: '8px 10px', borderRadius: 4, background: bulkResult.fails.length ? '#fef9c3' : '#dcfce7', whiteSpace: 'pre-wrap' }}>
                Sent {bulkResult.sent} of {bulkResult.sent + bulkResult.fails.length}.{bulkResult.fails.length ? `\nFailed:\n${bulkResult.fails.join('\n')}` : ''}
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={sendBulk} disabled={bulkBusy || bulkSel.size === 0}>
                {bulkBusy ? 'Sending…' : `Send to ${bulkSel.size} client${bulkSel.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['submitted', 'sent', 'all'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: '1px solid ' + (tab === t ? '#1a365d' : '#cbd5e1'),
              background: tab === t ? '#1a365d' : '#fff', color: tab === t ? '#fff' : '#475569' }}>
            {t === 'submitted' ? 'Replied — to review' : t === 'sent' ? 'Awaiting client' : 'All'}
          </button>
        ))}
      </div>

      {loading ? <p>Loading…</p> : shown.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>Nothing here.</p>
      ) : (
        <table className="export-table">
          <thead><tr><th>Client</th><th>Mode</th><th>Requested</th><th>Replied</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.payload?.name || r.prefill?.name || (r.client_id ? `#${r.client_id}` : 'New')}
                  {followUpDue(r) && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#b45309', background: 'rgba(234,179,8,0.18)', padding: '1px 6px', borderRadius: 999 }}>follow-up due</span>}
                </td>
                <td>{r.mode === 'new' ? 'New client' : 'Refresh'}</td>
                <td>{fmt(r.sent_at || r.created_at)}</td>
                <td>{r.submitted_at ? <span style={{ color: '#047857', fontWeight: 600 }}>{fmt(r.submitted_at)}</span> : <span style={{ color: '#94a3b8' }}>not yet</span>}</td>
                <td>{pill(r.status)}</td>
                <td>{r.status === 'submitted' && <button className="btn btn-primary btn-sm" onClick={() => openReview(r)}>Review</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <div onClick={() => !busy && setSel(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 10, padding: 22, maxWidth: 820, width: '100%' }}>
            <h3 style={{ marginTop: 0, color: '#1a365d' }}>
              Review submission — {sel.mode === 'new' ? 'new client' : (live?.name || sel.payload?.name || `client #${sel.client_id}`)}
            </h3>

            <h4 style={{ margin: '14px 0 6px', color: '#475569' }}>Core details</h4>
            <table className="export-table" style={{ margin: 0 }}>
              <thead><tr><th style={{ width: 40 }}>Apply</th><th>Field</th><th>On file</th><th>Submitted</th></tr></thead>
              <tbody>
                {diffs.filter((d) => d.submitted || d.onFile).map((d) => (
                  <tr key={d.k} style={{ background: d.changed ? 'rgba(234,179,8,0.08)' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      {d.changed ? (
                        <input type="checkbox" checked={!!apply[d.k]} onChange={(e) => setApply((p) => ({ ...p, [d.k]: e.target.checked }))} />
                      ) : '—'}
                    </td>
                    <td>{d.label}</td>
                    <td style={{ color: '#64748b' }}>{d.onFile || '—'}</td>
                    <td style={{ fontWeight: d.changed ? 600 : 400 }}>{d.submitted || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {extras.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 6px', color: '#475569' }}>Additional info (saved to client notes on approve)</h4>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, fontSize: 13, maxHeight: 240, overflowY: 'auto' }}>
                  {extras.map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 4 }}>
                      <strong>{k}:</strong> {Array.isArray(v) ? JSON.stringify(v) : String(v)}
                    </div>
                  ))}
                </div>
              </>
            )}

            {sel.attachments && sel.attachments.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 6px', color: '#475569' }}>Attachments (filed to the client's Documents on approve)</h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 6 }}>
                  {sel.attachments.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', fontSize: 13, borderBottom: i < sel.attachments!.length - 1 ? '1px solid #f1f5f9' : undefined }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <span style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {KIND_LABELS[a.kind] || a.kind} · {(a.size / 1048576).toFixed(1)} MB
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={() => openAttachment(a)}>View</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18, fontSize: 13.5, color: '#475569' }}>
              <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
              Invite this client to the portal — emails a secure link to set up their login
              {sel.client_id ? <span style={{ color: '#94a3b8' }}> (skip if they already have one)</span> : null}
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => setSel(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-secondary" style={{ color: '#b91c1c' }} onClick={reject} disabled={busy}>Reject</button>
              <button className="btn btn-primary" onClick={approve} disabled={busy}>
                {busy ? 'Working…' : sel.client_id ? 'Approve & apply' : 'Approve & create client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
