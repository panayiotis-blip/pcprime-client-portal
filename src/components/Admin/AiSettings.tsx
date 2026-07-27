import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Firm control for the AI document-extract feature (migration 148) — the
// portal's only EU→US transfer (document images → Anthropic, US). Off =
// scanning falls back to on-device OCR; nothing leaves EU infrastructure.
// Enforcement is server-side in the extract-document edge function; this is
// the switch that sets the flag.
export default function AiSettings() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getCompanySettings()
      .then((cs: any) => setEnabled(cs?.ai_extract_enabled !== false))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await api.updateCompanySettings({ ai_extract_enabled: next });
      setEnabled(next);
    } catch (e: any) {
      alert('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="form-section"><h3>AI &amp; data transfers</h3><p style={{ color: '#94a3b8' }}>Loading…</p></div>;

  return (
    <div className="form-section">
      <h3>AI &amp; data transfers</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        The AI document-extract feature (used when scanning invoices and receipts) sends the document
        images to Anthropic in the United States — the portal's only transfer of data outside the EU.
        Turn it off to keep all processing within EU infrastructure; scanning then uses on-device OCR instead.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!canEdit || saving}
          onChange={e => toggle(e.target.checked)}
        />
        <span>Allow AI document extraction (Anthropic, US){saving ? ' — saving…' : ''}</span>
      </label>
      {!enabled && (
        <p style={{ fontSize: 12, color: '#9b861f', margin: '8px 0 0' }}>
          AI extraction is OFF — scans use on-device OCR and no document data is sent to Anthropic.
        </p>
      )}
    </div>
  );
}
