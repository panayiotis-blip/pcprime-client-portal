import { useEffect, useState } from 'react';
import { api } from '../../../services/api';
import { getClientApp } from '../../../services/clientApps';

// How one app is set up for ONE client (client_app_config, migration 187).
//
// This is the firm's half of the app. The client's half — their tenants, their
// receipts — is client_app_data and is never touched here. Keeping them apart
// is what stops a client edit from overwriting an accountant's decision.
//
// Everything is optional. A blank field means "behave as the app always has",
// so an unconfigured client is bit-for-bit unchanged. Where a value IS set, the
// app uses it AND hides its own control, because an editable box that silently
// has no effect is worse than no box at all.
//
// Deliberately NOT here: editing the app itself. That is forking, and a forked
// client stops receiving fixes — including the one that had been destroying
// their uploaded contracts. Decided 2026-08-24; see docs/APP_ALLOCATION_DESIGN.md.
export default function AppConfigPanel({
  clientId, appKey, canManage, onBack,
}: { clientId: number; appKey: string; canManage: boolean; onBack: () => void }) {
  const app = getClientApp(appKey);
  const manifest = app?.config;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const [vatOn, setVatOn] = useState(false);          // is VAT configured at all
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState('19');
  const [vatOnRent, setVatOnRent] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getClientAppConfig(clientId, appKey)
      .then(c => {
        if (!alive) return;
        setTitle(typeof c.title === 'string' ? c.title : '');
        setHidden(Array.isArray(c.hiddenTabs) ? c.hiddenTabs : []);
        const v = c.vat && typeof c.vat === 'object' ? c.vat : null;
        setVatOn(!!v);
        if (v) {
          setVatEnabled(v.enabled !== false);
          setVatRate(v.rate == null ? '19' : String(v.rate));
          setVatOnRent(!!v.onRent);
        }
      })
      .catch(e => setNote('Could not load: ' + (e?.message || e)))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clientId, appKey]);

  const save = async () => {
    setBusy(true); setNote('');
    try {
      // Only what is actually set is stored. Writing every key with a default
      // would make "unconfigured" indistinguishable from "deliberately set to
      // the default", and the app treats those differently.
      const cfg: Record<string, any> = {};
      if (title.trim()) cfg.title = title.trim();
      if (hidden.length) cfg.hiddenTabs = hidden;
      if (vatOn) {
        cfg.vat = vatEnabled
          ? { enabled: true, rate: vatRate.trim() === '' ? 19 : Number(vatRate), onRent: vatOnRent }
          : { enabled: false };
      }
      await api.saveClientAppConfig(clientId, appKey, cfg);
      setNote('Saved. Reopen the app to see it.');
    } catch (e: any) { setNote(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const toggleTab = (key: string) =>
    setHidden(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  if (loading) return <p style={{ color: '#64748b' }}>Loading configuration…</p>;

  const disabled = !canManage || busy;

  return (
    <div>
      <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to apps</button>
      <h3 style={{ color: '#1a365d', margin: '14px 0 4px' }}>Configure {app?.label || appKey}</h3>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
        How this app is set up <strong>for this client only</strong>. Anything left blank keeps
        the app's normal behaviour. What you set here overrides the client's own settings and
        removes the matching control from their screen.
      </p>

      <div className="form-section" style={{ maxWidth: 640 }}>
        <div className="form-group">
          <label>App name shown to this client</label>
          <input className="form-input" value={title} disabled={disabled}
            placeholder="Leave blank for the default"
            onChange={e => setTitle(e.target.value)} />
        </div>

        {manifest?.tabs?.length ? (
          <div className="form-group" style={{ marginTop: 14 }}>
            <label>Screens this client sees</label>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 8px' }}>
              Untick to hide. Hidden screens are not rendered at all — this is not a permission,
              so anything already recorded on a hidden screen stays in their data untouched.
            </p>
            {manifest.tabs.map(t => (
              <label key={t.key} style={{ display: 'block', fontWeight: 400, marginBottom: 4 }}>
                <input type="checkbox" disabled={disabled}
                  checked={!hidden.includes(t.key)}
                  onChange={() => toggleTab(t.key)} />{' '}
                {t.label}
              </label>
            ))}
          </div>
        ) : null}

        {manifest?.vat ? (
          <div className="form-group" style={{ marginTop: 14 }}>
            <label>VAT</label>
            <label style={{ display: 'block', fontWeight: 400, margin: '4px 0' }}>
              <input type="checkbox" checked={vatOn} disabled={disabled}
                onChange={e => setVatOn(e.target.checked)} />{' '}
              Set VAT for this client
            </label>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 8px' }}>
              Leave unticked and the client sets their own rate in the app. Tick it and the rate
              becomes yours — their VAT boxes turn into a note saying to contact you.
            </p>
            {vatOn && (
              <div style={{ paddingLeft: 18, borderLeft: '2px solid #e2e8f0' }}>
                <label style={{ display: 'block', fontWeight: 400, marginBottom: 6 }}>
                  <input type="checkbox" checked={vatEnabled} disabled={disabled}
                    onChange={e => setVatEnabled(e.target.checked)} />{' '}
                  VAT applies to this client
                </label>
                {vatEnabled ? (
                  <>
                    <div className="form-group" style={{ maxWidth: 160 }}>
                      <label>Rate (%)</label>
                      <input className="form-input" type="number" step="0.01" min="0"
                        value={vatRate} disabled={disabled}
                        onChange={e => setVatRate(e.target.value)} />
                    </div>
                    <label style={{ display: 'block', fontWeight: 400, marginTop: 6 }}>
                      <input type="checkbox" checked={vatOnRent} disabled={disabled}
                        onChange={e => setVatOnRent(e.target.checked)} />{' '}
                      Charge VAT on rent
                    </label>
                    <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 0' }}>
                      Individual charge types (common fees, electricity…) keep their own VAT
                      setting inside the app, and a tenant is still only charged VAT if they are
                      marked VAT registered.
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px' }}>
                    No VAT is added anywhere for this client, whatever their tenants are marked.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {!manifest && (
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
            This app doesn't declare what can be configured, so only its name can be set here.
            Built-in apps declare theirs in the registry.
          </p>
        )}

        {note && <div style={{ marginTop: 12, fontSize: 13, color: note.startsWith('Saved') ? '#065f46' : '#b91c1c' }}>{note}</div>}
        {canManage && (
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save configuration'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
