import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import { Modal, Button, Input } from '../ui';

// Company Settings → Maintenance (UI Polish v2, Part 5F).
// Occasional admin clean-up tools. Currently the orphan tax-filing remover,
// relocated here from the Tax Filings page — it's an admin action, not a
// daily one. Leadership-only; the RPC also enforces role + MFA server-side.
export default function Maintenance() {
  const { user } = useAuth();
  const { runWith } = useMFAStepUp();
  const canRun = isSupervisorOrHigher(user);

  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCount = async () => {
    try { setOrphanCount(await api.countOrphanTaxFilings()); }
    catch { setOrphanCount(0); }
  };
  useEffect(() => { if (canRun) loadCount(); }, [canRun]);

  const handleRemove = async () => {
    setBusy(true);
    try {
      const n = await runWith(() => api.cleanupOrphanTaxFilings());
      setConfirmOpen(false);
      setConfirmText('');
      await loadCount();
      alert(`Removed ${n} orphan filing${n === 1 ? '' : 's'}.`);
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  // Maintenance tools are leadership-only.
  if (!canRun) return null;

  const n = orphanCount ?? 0;

  return (
    <div className="form-section">
      <h3>Maintenance</h3>
      <p style={{ fontSize: 13, color: 'var(--pc-text-2)', marginTop: 0 }}>
        Admin tools for loading and tidying client data.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>Smart Import</strong>
          <div style={{ fontSize: 13, color: 'var(--pc-text-2)' }}>
            Load client data from any Excel file — map its columns to client fields, then import.
          </div>
        </div>
        <Link to="/clients/smart-import" className="btn btn-primary">Open Smart Import</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>Orphan tax filings</strong>
          <div style={{ fontSize: 13, color: 'var(--pc-text-2)' }}>
            {orphanCount == null
              ? 'Checking…'
              : n === 0
                ? 'None found — nothing to clean up.'
                : `${n} filing${n === 1 ? '' : 's'} point to a client that no longer exists.`}
          </div>
        </div>
        <Button
          variant="destructive"
          disabled={n === 0}
          title="Permanently delete tax filings whose linked client no longer exists. This action is irreversible."
          onClick={() => { setConfirmText(''); setConfirmOpen(true); }}
        >
          Remove {n} orphan filing{n === 1 ? '' : 's'}
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Remove orphan tax filings"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || confirmText.trim().toUpperCase() !== 'REMOVE'}
              onClick={handleRemove}
            >
              {busy ? 'Removing…' : 'Remove filings'}
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This permanently deletes <strong>{n}</strong> tax filing{n === 1 ? '' : 's'} whose linked
          client no longer exists. It <strong>cannot be undone</strong>.
        </p>
        <p style={{ fontSize: 13, color: 'var(--pc-text-2)' }}>
          Type <strong>REMOVE</strong> to confirm:
        </p>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="REMOVE"
          autoFocus
        />
      </Modal>
    </div>
  );
}
