import { useEffect, useState } from 'react';
import { api } from '../../services/api';

const SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;

type Props = {
  userId: string;
  userName: string;
  onClose: () => void;
};

// Per-staff override editor for the 8 service rates. Empty input = no override
// (the firm-wide default applies). Number = override.
export default function StaffServiceRatesEditor({ userId, userName, onClose }: Props) {
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [defaults, setDefaults]   = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});  // input strings

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [company, rates] = await Promise.all([
          api.getCompanySettings(),
          api.getStaffServiceRates(userId),
        ]);
        if (cancelled) return;
        setDefaults((company?.default_service_rates || {}) as Record<string, number>);
        const map: Record<string, string> = {};
        for (const s of SERVICES) map[s] = '';
        for (const r of rates) map[r.service] = String(r.rate);
        setOverrides(map);
      } catch (err: any) {
        alert('Failed to load rates: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // For each service: if the override is empty, clear; otherwise set.
      // Done sequentially so a single failure leaves a clear partial state.
      for (const s of SERVICES) {
        const raw = overrides[s];
        if (raw === '' || raw == null) {
          await api.setStaffServiceRate(userId, s, null);
        } else {
          const n = Number(raw);
          if (isNaN(n) || n < 0) {
            alert(`Invalid rate for ${s}`);
            setSaving(false);
            return;
          }
          await api.setStaffServiceRate(userId, s, n);
        }
      }
      onClose();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Service rates — {userName}</h3>
        <p style={{ fontSize: 13, color: '#475569' }}>
          Leave a field blank to use the firm-wide default. Enter a number to override
          that default for this staff member.
        </p>

        {loading ? (
          <div className="loading-screen">Loading…</div>
        ) : (
          <table className="export-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Service</th>
                <th style={{ width: 110 }}>Firm default (€/h)</th>
                <th style={{ width: 130 }}>Override (€/h)</th>
                <th style={{ width: 110 }}>Effective</th>
              </tr>
            </thead>
            <tbody>
              {SERVICES.map(s => {
                const def = defaults[s];
                const raw = overrides[s];
                const effective = raw !== '' && raw != null && !isNaN(Number(raw))
                  ? Number(raw)
                  : (def != null ? Number(def) : null);
                return (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{def != null ? `€${Number(def).toFixed(2)}` : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input"
                        style={{ width: 100 }}
                        value={overrides[s] ?? ''}
                        onChange={e => setOverrides(prev => ({ ...prev, [s]: e.target.value }))}
                        placeholder="—"
                      />
                    </td>
                    <td>
                      {effective != null
                        ? <strong>€{effective.toFixed(2)}</strong>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save rates'}
          </button>
        </div>
      </div>
    </div>
  );
}
