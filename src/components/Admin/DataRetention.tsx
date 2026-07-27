import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// GDPR data-retention schedule (migration 146). Owner sets how long each
// operational/log data category is kept; a daily pg_cron job purges older
// rows. Accounting/business records are never listed here — they're kept for
// the legal period and handled by the erasure workflow.

type Cat = { key: string; label: string; help: string };

const CATEGORIES: Cat[] = [
  { key: 'ocr_text',            label: 'OCR scratch text',        help: 'Raw scanned text on invoices. The invoice itself is always kept.' },
  { key: 'service_runs',        label: 'Automation run log',      help: 'History of the service scheduler firing.' },
  { key: 'ai_usage',            label: 'AI-usage log',            help: 'Metering of the AI document-extract feature.' },
  { key: 'audit_alerts',        label: 'Security alerts',         help: 'Audit alert records.' },
  { key: 'portal_applications', label: 'Actioned access requests',help: 'Approved/rejected portal applications. Pending ones are never purged.' },
  { key: 'audit_log',           label: 'Audit trail',             help: 'Full activity audit log. Consider keeping for security.' },
  { key: 'call_logs',           label: 'Phone / call logs',       help: 'Logged client calls.' },
  { key: 'inbox_emails',        label: 'Shared inbox emails',     help: 'Emails in the firm shared inbox (and their attachments).' },
  { key: 'client_emails',       label: 'Per-client emails',       help: 'Emails logged against a client (and their attachments).' },
];

export default function DataRetention() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const [days, setDays] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = () => {
    setLoading(true);
    api.getCompanySettings()
      .then((cs: any) => setDays((cs?.retention_days as any) || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const setCat = (key: string, raw: string) => {
    const n = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)));
    setDays(prev => ({ ...prev, [key]: isNaN(n as any) ? null : n }));
  };

  const save = async () => {
    setSaving(true);
    try {
      // Normalise: 0/empty → null (keep).
      const clean: Record<string, number | null> = {};
      for (const c of CATEGORIES) {
        const v = days[c.key];
        clean[c.key] = v && v > 0 ? v : null;
      }
      await api.updateCompanySettings({ retention_days: clean });
      setDays(clean);
      alert('Retention schedule saved.');
    } catch (e: any) {
      alert('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!confirm('Run the cleanup now? This permanently deletes data older than the periods below.')) return;
    setRunning(true);
    try {
      const summary = await api.runRetentionPurge();
      const lines = Object.entries(summary).map(([k, v]) => `${k}: ${v}`);
      alert(lines.length ? 'Purged:\n' + lines.join('\n') : 'Nothing to purge — no data older than the configured periods.');
    } catch (e: any) {
      alert('Cleanup failed: ' + e.message);
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="form-section"><h3>Data retention</h3><p style={{ color: '#94a3b8' }}>Loading…</p></div>;

  return (
    <div className="form-section">
      <h3>Data retention (GDPR)</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 4px' }}>
        How long each operational/log data type is kept before it's automatically deleted (daily).
        Leave a field blank to keep indefinitely.
      </p>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px' }}>
        Accounting and client records (invoices, documents, tax filings, engagement letters, timesheets)
        are <strong>not</strong> listed here — they're kept for the legal period (~6–7 years in Cyprus)
        and removed via the client-erasure workflow at end of relationship.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
        {CATEGORIES.map(c => {
          const v = days[c.key];
          return (
            <div key={c.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#f8fafc',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#1a365d' }}>{c.label}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{c.help}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <input
                  type="number" min={0} className="form-input"
                  style={{ width: 90, padding: '4px 8px' }}
                  value={v == null ? '' : v}
                  placeholder="Keep"
                  onChange={e => setCat(c.key, e.target.value)}
                  disabled={!canEdit}
                />
                <span style={{ fontSize: 12, color: '#64748b', width: 66 }}>
                  {v == null || v === 0 ? 'keep' : 'days'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
          <button className="btn btn-secondary" onClick={runNow} disabled={running} title="Apply the schedule immediately">
            {running ? 'Running…' : 'Run cleanup now'}
          </button>
        </div>
      )}
    </div>
  );
}
