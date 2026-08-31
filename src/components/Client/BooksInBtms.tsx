// "Books kept in BTMS" — the one tick that decides whether this client appears
// in the reporting application.
//
// It lives on the client record because that is where a fact about the client
// belongs. It used to live only on the reporting application's own setup
// screen, which had a button marking every client at once; that button is how
// all 63 clients came to be marked as ours, and a client picker offering every
// client on the books is a picker nobody can use. A per-client decision takes
// a per-client action.
//
// It writes straight through rather than joining the tab's Edit / Save cycle:
// the value is not a column on public.clients, it is one row in another schema,
// and pretending otherwise would mean threading it through the whole client
// form for a single radio button.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isStaffRole } from '../../services/api';
import { useFieldCtx } from './fieldContext';
import { getBooksLocation, setBooksLocation, type BooksSource } from '../../services/reportingSettings';

/** The three states, in the partner's own words. */
const CHOICES: { key: 'off' | 'btms_local' | 'btms_client'; label: string; note: string }[] = [
  { key: 'off',         label: 'Not on BTMS',           note: 'Not offered in the reporting application.' },
  { key: 'btms_local',  label: 'On our BTMS',           note: "The books are kept on our own installation." },
  { key: 'btms_client', label: "On the client's BTMS",  note: 'The client keeps the books and sends the exports.' },
];

export default function BooksInBtms() {
  const { user } = useAuth();
  const { client } = useFieldCtx();
  const clientId: number | undefined = client?.id;

  const [source, setSource] = useState<BooksSource | null>(null);
  const [program, setProgram] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const loc = await getBooksLocation(clientId);
      setSource(loc.source);
      setProgram(loc.program);
    } catch (e: any) {
      setError(e?.message ?? 'Could not read where this client’s books are.');
      setSource('none');
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (next: BooksSource, nextProgram: string) => {
    if (!clientId) return;
    const before = { source, program };
    setSource(next);
    setProgram(nextProgram);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setBooksLocation(clientId, next, nextProgram);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      // Put the control back to what the database still says, so the screen
      // never shows a choice that was not recorded.
      setSource(before.source);
      setProgram(before.program);
      setError(e?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  // Staff only. The reporting application is staff-only by the same rule
  // (migration 214), and the row is unreadable to anyone else in any case.
  if (!isStaffRole(user) || !clientId) return null;

  const onBtms = source === 'btms_local' || source === 'btms_client';
  const selected: 'off' | 'btms_local' | 'btms_client' | null =
    source === null ? null : onBtms ? (source as 'btms_local' | 'btms_client') : 'off';

  return (
    <div className="form-section">
      <h3>Books kept in BTMS</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px', maxWidth: 720 }}>
        Whether this client's bookkeeping is on BTMS, and whose BTMS it is. Only clients marked
        as one of the two appear in the <strong>Client Reporting</strong> application — there is
        no feed for anything else. A client on another program is still recorded here, with the
        program named, so nobody has to ask again.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>{error}</div>}

      {source === null ? (
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 620 }}>
          {CHOICES.map((c) => (
            <label
              key={c.key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '9px 11px', borderRadius: 6, cursor: saving ? 'wait' : 'pointer',
                border: '1px solid ' + (selected === c.key ? '#94a3b8' : '#e2e8f0'),
                background: selected === c.key ? '#f8fafc' : '#fff',
              }}
            >
              <input
                type="radio"
                name={'books-in-btms-' + clientId}
                checked={selected === c.key}
                disabled={saving}
                style={{ marginTop: 3 }}
                onChange={() => {
                  if (c.key === 'off') {
                    // "Not on BTMS" with a program named is 'other'; without
                    // one it is plainly 'none'.
                    void save(program.trim() ? 'other' : 'none', program);
                  } else {
                    void save(c.key, '');
                  }
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, color: '#0f172a' }}>{c.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{c.note}</span>
              </span>
            </label>
          ))}

          {selected === 'off' && (
            <div style={{ padding: '8px 11px 0 34px' }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>
                If they keep their books on something else, which program? <span style={{ color: '#94a3b8' }}>(optional)</span>
              </label>
              <input
                className="form-input"
                placeholder="e.g. Sage, Xero, spreadsheets"
                defaultValue={program}
                disabled={saving}
                style={{ fontSize: 13, maxWidth: 320 }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === program.trim()) return;
                  void save(v ? 'other' : 'none', v);
                }}
              />
            </div>
          )}

          <p style={{ fontSize: 11, color: saved ? '#166534' : '#94a3b8', margin: '10px 0 0', minHeight: 16 }}>
            {saving ? 'Saving…' : saved ? 'Saved.' : onBtms
              ? 'This client is offered in Client Reporting. Its BTMS exports go in the BTMS data folder on the Documents tab.'
              : ' '}
          </p>
        </div>
      )}
    </div>
  );
}
