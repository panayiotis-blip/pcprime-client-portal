import { useEffect, useState } from 'react';
import { api } from '../../services/api';

// Walks v_pending_service_emails, renders the template with merge fields
// substituted, and sends each via the staff member's own SMTP (any provider).
// Per-row result
// shown so partial failures are visible. service_runs.email_sent is
// stamped true (or with email_error) per row by markServiceEmailSent.

type Pending = {
  run_id: number;
  scheduled_date: string;
  client_id: number;
  client_name: string;
  client_email: any;        // string OR text[]
  service_key: string;
  service_label: string;
  stage_key: string;
  stage_label: string;
  subject: string | null;
  body: string | null;
  email_error: string | null;
};

type RowStatus = 'pending' | 'sending' | 'sent' | 'no_email' | 'no_template' | 'failed';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthLabelFor(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return ''; }
}
function periodLabelFor(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    const m = d.getMonth() + 1;
    const q = Math.ceil(m / 3);
    return `Q${q} ${d.getFullYear()}`;
  } catch { return ''; }
}

function firstEmail(v: any): string {
  if (!v) return '';
  if (Array.isArray(v)) return v[0] || '';
  return String(v);
}

function applyMerge(text: string | null, vars: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? `{{${k}}}`);
}

export default function SendPendingEmailsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void; }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [firm, setFirm] = useState<any>({});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Record<number, RowStatus>>({});
  const [error, setError] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rows, settings] = await Promise.all([
        api.getPendingServiceEmails(),
        api.getCompanySettings().catch(() => null),
      ]);
      const arr = rows as Pending[];
      setPending(arr);
      setFirm(settings || {});
      // Default-select everything that has both a recipient and a template
      const selectable = arr
        .filter(r => firstEmail(r.client_email) && r.subject && r.body)
        .map(r => r.run_id);
      setPicked(new Set(selectable));
      // Status flags so the user sees why a row is unselectable
      const st: Record<number, RowStatus> = {};
      for (const r of arr) {
        if (!firstEmail(r.client_email)) st[r.run_id] = 'no_email';
        else if (!r.subject || !r.body)  st[r.run_id] = 'no_template';
        else st[r.run_id] = 'pending';
      }
      setStatus(st);
    } catch (err: any) {
      alert('Failed to load: ' + (err?.message || String(err)));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const togglePick = (id: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (picked.size === 0) { alert('Nothing selected.'); return; }
    setSending(true);
    let sentCount = 0, failedCount = 0;
    // Process sequentially so per-row status updates render and the SMTP
    // doesn't get hammered with parallel sends.
    for (const r of pending) {
      if (!picked.has(r.run_id)) continue;
      if (status[r.run_id] === 'no_email' || status[r.run_id] === 'no_template') continue;
      setStatus(prev => ({ ...prev, [r.run_id]: 'sending' }));
      try {
        const mergeVars = {
          client_name: r.client_name || '',
          month_name:  monthLabelFor(r.scheduled_date),
          period_label: periodLabelFor(r.scheduled_date),
          firm_name:   firm?.name || firm?.legal_name || '',
          firm_email:  firm?.email || '',
        };
        const to = firstEmail(r.client_email);
        const subject = applyMerge(r.subject, mergeVars);
        const body    = applyMerge(r.body, mergeVars);
        await api.sendViaOutlook({
          to,
          subject,
          // Plain-text fallback (denomailer needs body even when html is set).
          body: subject + '\n\n' + body.replace(/<[^>]+>/g, ''),
          html: body,
        });
        await api.markServiceEmailSent(r.run_id);
        setStatus(prev => ({ ...prev, [r.run_id]: 'sent' }));
        sentCount++;
      } catch (err: any) {
        const msg = err?.message || String(err);
        await api.markServiceEmailSent(r.run_id, msg).catch(() => {});
        setStatus(prev => ({ ...prev, [r.run_id]: 'failed' }));
        setError(prev => ({ ...prev, [r.run_id]: msg }));
        failedCount++;
      }
    }
    setSending(false);
    alert(`Done. ${sentCount} sent · ${failedCount} failed.`);
    onDone();
  };

  const statusChip = (s: RowStatus, err?: string) => {
    const styles: Record<RowStatus, { bg: string; fg: string; label: string }> = {
      pending:     { bg: '#f1f5f9', fg: '#475569', label: 'ready' },
      sending:     { bg: '#dbeafe', fg: '#1e40af', label: '⏳ sending…' },
      sent:        { bg: '#dcfce7', fg: '#166534', label: '✓ sent' },
      no_email:    { bg: '#fee2e2', fg: '#b91c1c', label: '⚠ no email' },
      no_template: { bg: '#fef3c7', fg: '#92400e', label: '⚠ no template' },
      failed:      { bg: '#fee2e2', fg: '#b91c1c', label: '✕ failed' },
    };
    const v = styles[s];
    return (
      <span style={{ background: v.bg, color: v.fg, padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600 }} title={err || ''}>
        {v.label}
      </span>
    );
  };

  const canSend = pending.some(r => picked.has(r.run_id) && (status[r.run_id] === 'pending' || status[r.run_id] === 'failed'));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 880, maxHeight: '92vh', overflowY: 'auto',
      }}>
        <h3 style={{ marginTop: 0, color: '#1a365d' }}>Send pending automated emails</h3>
        <p style={{ color: '#5a6478', fontSize: 13, marginTop: 0 }}>
          Sends via your SMTP credentials (configure in <strong>Settings → Email</strong> — supports Outlook / Gmail / custom).
          Each row stamps <code>service_runs.email_sent=true</code> when successful, or stores the
          error message for follow-up.
        </p>

        {loading ? <p>Loading…</p> : pending.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: '#f8fafc', borderRadius: 6 }}>
            <p style={{ color: '#64748b' }}>No pending automated emails. Run the scheduler first.</p>
          </div>
        ) : (
          <>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'auto', maxHeight: '52vh' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f1f5f9', position: 'sticky', top: 0 }}>
                  <tr style={{ color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px', fontWeight: 500, width: 30 }}>
                      <input
                        type="checkbox"
                        checked={picked.size > 0 && picked.size === pending.filter(r => status[r.run_id] === 'pending' || status[r.run_id] === 'failed').length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setPicked(new Set(pending.filter(r => status[r.run_id] === 'pending' || status[r.run_id] === 'failed').map(r => r.run_id)));
                          } else {
                            setPicked(new Set());
                          }
                        }}
                      />
                    </th>
                    <th style={{ padding: '6px 10px', fontWeight: 500 }}>Client</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500 }}>Service · Stage</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500, width: 110 }}>Scheduled</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500, width: 200 }}>To</th>
                    <th style={{ padding: '6px 10px', fontWeight: 500, width: 110 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(r => {
                    const s = status[r.run_id] || 'pending';
                    const to = firstEmail(r.client_email);
                    const disabled = s === 'no_email' || s === 'no_template' || s === 'sending' || s === 'sent' || sending;
                    return (
                      <tr key={r.run_id} style={{ borderTop: '1px solid #f1f5f9', opacity: (s === 'no_email' || s === 'no_template') ? 0.5 : 1 }}>
                        <td style={{ padding: '6px 10px' }}>
                          <input type="checkbox" checked={picked.has(r.run_id)} onChange={() => togglePick(r.run_id)} disabled={disabled} />
                        </td>
                        <td style={{ padding: '6px 10px', color: '#1a365d' }}>{r.client_name}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ color: '#64748b' }}>{r.service_label} · </span>{r.stage_label}
                        </td>
                        <td style={{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums', color: '#64748b' }}>{r.scheduled_date}</td>
                        <td style={{ padding: '6px 10px', color: to ? '#1a365d' : '#b91c1c', fontSize: 12 }}>{to || '(none on file)'}</td>
                        <td style={{ padding: '6px 10px' }}>{statusChip(s, error[r.run_id])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#5a6478' }}>
                {picked.size} of {pending.length} selected
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={onClose} disabled={sending}>Close</button>
                <button className="btn btn-primary" onClick={handleSend} disabled={sending || !canSend}>
                  {sending ? 'Sending…' : `Send ${picked.size} email(s)`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
