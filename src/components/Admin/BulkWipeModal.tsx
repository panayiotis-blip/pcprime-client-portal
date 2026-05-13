import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';

interface Props {
  onClose: () => void;
  onWiped?: () => void;
}

const CONFIRM_PHRASE = 'WIPE ALL CLIENTS';

const ROW_LABELS: Record<string, string> = {
  clients:              'Clients (soft-deleted, restorable)',
  invoices:             'Invoices',
  documents:            'Documents',
  platform_credentials: 'Platform credentials',
  compliance_tasks:     'Compliance tasks',
  staff_tasks:          'Staff tasks',
  client_emails:        'Captured emails',
  email_attachments:    'Email attachments',
  appointments:         'Appointments',
  call_logs:            'Call log entries',
  user_clients:         'Client-user links',
};

export default function BulkWipeModal({ onClose, onWiped }: Props) {
  const { runWith } = useMFAStepUp();
  const [estimate, setEstimate] = useState<Record<string, number> | null>(null);
  const [confirm, setConfirm] = useState('');
  const [estimating, setEstimating] = useState(true);
  const [wiping, setWiping] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.estimateWipeTestClients();
        if (!cancelled) setEstimate(data);
      } catch (err: any) {
        if (!cancelled) setError('Could not estimate: ' + err.message);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const canSubmit = confirm === CONFIRM_PHRASE && !wiping;

  const handleWipe = async () => {
    if (!canSubmit) return;
    setWiping(true); setError(null);
    try {
      const summary = await runWith(() => api.wipeTestClients(CONFIRM_PHRASE));
      setResult(summary);
      if (onWiped) onWiped();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) setError(err.message);
    } finally {
      setWiping(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
    }}>
      <div style={{
        background: 'white', borderRadius: 8, padding: 24,
        width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
      }}>
        {result ? (
          <>
            <h3 style={{ margin: '0 0 8px 0', color: '#047857' }}>✓ Wipe complete</h3>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
              The 123 test clients have been soft-deleted (restorable from <strong>Clients → Deleted</strong>).
              All their child data has been hard-deleted.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {Object.entries(result)
                .filter(([_, n]) => Number(n) > 0)
                .map(([k, n]) => (
                  <li key={k} style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                    <strong>{n}</strong> &nbsp;{ROW_LABELS[k] || k}
                  </li>
                ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ margin: 0, color: '#b91c1c' }}>⚠️ Bulk wipe — test data cleanup</h3>
            <p style={{ fontSize: 13, color: '#475569', margin: '8px 0 16px 0' }}>
              This wipes test data ahead of go-live. The clients themselves are <strong>soft-deleted</strong> and
              restorable from <em>Clients → Deleted</em>. Their associated data (invoices, documents,
              compliance tasks, credentials, etc.) is <strong>permanently removed</strong>.
            </p>

            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>About to delete:</strong>
              {estimating ? (
                <p style={{ margin: 0, fontSize: 13 }}>Counting…</p>
              ) : estimate ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {Object.entries(estimate)
                    .filter(([_, n]) => Number(n) > 0)
                    .map(([k, n]) => (
                      <li key={k} style={{ padding: '2px 0', fontSize: 13 }}>
                        <strong>{n}</strong> &nbsp;{ROW_LABELS[k] || k}
                      </li>
                    ))}
                  {Object.values(estimate).every(n => Number(n) === 0) && (
                    <li style={{ fontSize: 13, color: '#64748b' }}>Nothing live to wipe.</li>
                  )}
                </ul>
              ) : (
                <p style={{ margin: 0, fontSize: 13 }}>(Estimate unavailable.)</p>
              )}
            </div>

            <div className="form-group">
              <label>
                Type <code style={{ background: '#fee2e2', padding: '1px 6px', borderRadius: 3, color: '#7f1d1d' }}>{CONFIRM_PHRASE}</code> below to confirm:
              </label>
              <input
                type="text"
                className="form-input"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {error && (
              <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={wiping}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={handleWipe}
                disabled={!canSubmit}
                title={confirm !== CONFIRM_PHRASE ? 'Type the confirmation phrase first' : ''}
              >
                {wiping ? 'Wiping…' : '🗑 Wipe test data'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
