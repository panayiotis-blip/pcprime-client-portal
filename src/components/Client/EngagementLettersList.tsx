import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import EngagementLetterBuilder from './EngagementLetterBuilder';
import { generateEngagementLetterPdf } from '../../services/engagementLetterPdf';

// Drops into the Engagement section. Lists every version (newest first)
// with status badges + per-row actions. Handles "Mark accepted" inline
// since that's a one-click action (no extra form needed).

type Letter = {
  id: number;
  version: number;
  status: 'draft' | 'sent' | 'accepted' | 'expired' | 'superseded';
  effective_from: string | null;
  effective_to: string | null;
  total_annual_fee: number;
  currency: string;
  sent_at: string | null;
  sent_to_email: string | null;
  accepted_at: string | null;
  accepted_method: string | null;
  services: any[];
  intro_text: string | null;
  terms_text: string | null;
};

const fmtMoney = (n: number, ccy = 'EUR') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy }).format(Number(n) || 0);
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB') : '—';

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft:      { bg: '#f1f5f9', fg: '#475569', label: 'Draft' },
  sent:       { bg: '#dbeafe', fg: '#1e40af', label: 'Sent' },
  accepted:   { bg: '#dcfce7', fg: '#166534', label: 'Accepted' },
  expired:    { bg: '#fee2e2', fg: '#b91c1c', label: 'Expired' },
  superseded: { bg: '#fef3c7', fg: '#92400e', label: 'Superseded' },
};

export default function EngagementLettersList({ clientId, client }: { clientId: number; client: any }) {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [firm, setFirm] = useState<any>({});
  const [editingId, setEditingId] = useState<number | null | undefined>(undefined); // undefined = closed, null = new, number = edit

  const load = async () => {
    setLoading(true);
    try {
      const [rows, settings] = await Promise.all([
        api.getEngagementLetters(clientId),
        api.getCompanySettings().catch(() => null),
      ]);
      setLetters(rows as Letter[]);
      setFirm(settings || {});
    } catch (err: any) {
      // Don't alert — the section is non-critical; just show empty.
      console.error('Engagement letters load failed:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [clientId]);

  const reopenAsPdf = (l: Letter) => {
    generateEngagementLetterPdf({
      client: {
        name: client?.name || '',
        legal_name: client?.legal_name || null,
        address: client?.address || null,
        city: client?.city || null,
        country: client?.country || null,
        tax_number: client?.tax_number || null,
        vat_number: client?.vat_number || null,
        registration_number: client?.registration_number || null,
        id_number: client?.id_number || null,
      },
      firm,
      version: l.version,
      effective_from: l.effective_from,
      effective_to: l.effective_to,
      services: Array.isArray(l.services) ? l.services : [],
      total_annual_fee: l.total_annual_fee,
      currency: l.currency,
      intro_text: l.intro_text,
      terms_text: l.terms_text,
    }, 'save');
  };

  const handleMarkAccepted = async (l: Letter) => {
    const sig = prompt('Optional: who signed (typed name)? Leave blank to just stamp accepted today.', '');
    if (sig == null) return; // cancelled
    try {
      await api.markEngagementLetterAccepted(l.id, {
        method: 'email_reply',
        signature: sig || undefined,
        notes: 'Marked accepted by staff (email reply).',
      });
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const handleDelete = async (l: Letter) => {
    if (l.status !== 'draft') return;
    if (!confirm(`Delete draft v${l.version}? This cannot be undone.`)) return;
    try {
      await api.deleteEngagementLetter(l.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || String(err)));
    }
  };

  const handleReissue = (_l: Letter) => {
    // Open the builder in 'new' mode — it auto-increments the version.
    setEditingId(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ color: '#1a365d', fontSize: 14 }}>Engagement letters</strong>
        <button className="btn btn-primary btn-sm" onClick={() => setEditingId(null)}>
          + New engagement letter
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading…</p>
      ) : letters.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13, padding: '12px 0' }}>
          No engagement letter on file. Draft one with the button above — pick the services this engagement covers, set the annual fee per service, and the system generates a PDF you can email for acceptance.
        </p>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '6px 10px', fontWeight: 500, width: 60 }}>Version</th>
                <th style={{ padding: '6px 10px', fontWeight: 500, width: 110 }}>Status</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>Effective</th>
                <th style={{ padding: '6px 10px', fontWeight: 500, width: 130, textAlign: 'right' }}>Annual fee</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>Sent / Accepted</th>
                <th style={{ padding: '6px 10px', fontWeight: 500, width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {letters.map(l => {
                const st = STATUS_STYLE[l.status] || STATUS_STYLE.draft;
                return (
                  <tr key={l.id} style={{ borderTop: '1px solid #f1f5f9', opacity: l.status === 'superseded' ? 0.6 : 1 }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1a365d' }}>v{l.version}</td>
                    <td style={{ padding: '6px 10px' }}>
                      <span style={{ background: st.bg, color: st.fg, padding: '1px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600 }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '6px 10px', color: '#64748b' }}>
                      {fmtDate(l.effective_from)} — {fmtDate(l.effective_to)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(l.total_annual_fee, l.currency)}
                    </td>
                    <td style={{ padding: '6px 10px', color: '#64748b', fontSize: 12 }}>
                      {l.sent_at && <>Sent {fmtDate(l.sent_at.slice(0, 10))}{l.sent_to_email ? ` → ${l.sent_to_email}` : ''}<br /></>}
                      {l.accepted_at && <>Accepted {fmtDate(l.accepted_at.slice(0, 10))} ({l.accepted_method || 'email'})</>}
                    </td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-link btn-sm" onClick={() => reopenAsPdf(l)} title="Download PDF">📄 PDF</button>
                      <button className="btn btn-link btn-sm" onClick={() => setEditingId(l.id)} title={l.status === 'draft' ? 'Edit draft' : 'View (read-only)'}>
                        {l.status === 'draft' ? '✎ Edit' : '👁 View'}
                      </button>
                      {l.status === 'sent' && (
                        <button className="btn btn-link btn-sm" onClick={() => handleMarkAccepted(l)} title="Mark as accepted by the client">✓ Mark accepted</button>
                      )}
                      {l.status === 'draft' && (
                        <button className="btn btn-link btn-sm" onClick={() => handleDelete(l)} title="Delete this draft" style={{ color: '#b91c1c' }}>✕ Delete</button>
                      )}
                      {(l.status === 'accepted' || l.status === 'expired') && (
                        <button className="btn btn-link btn-sm" onClick={() => handleReissue(l)} title="Create a new version (annual refresh / amendment)">↻ Re-issue</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingId !== undefined && (
        <EngagementLetterBuilder
          clientId={clientId}
          client={client}
          letterId={editingId == null ? undefined : editingId}
          onClose={() => setEditingId(undefined)}
          onSaved={load}
        />
      )}
    </div>
  );
}
