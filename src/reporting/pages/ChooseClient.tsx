// The reporting sign-in: pick the client whose books you are working on.
// Only clients registered for reporting (reporting.client_settings) appear —
// that table is the list of who this platform is switched on for.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useReportingSession, type ReportingClient } from '../session';

/**
 * What the chooser shows. The BTMS name rides alongside for display only and
 * is deliberately NOT carried into the session: the session holds the register's
 * identity, and the BTMS name is read fresh wherever it is needed, so a name
 * corrected in one place is never contradicted by a stale copy in another.
 */
type Choice = ReportingClient & { btmsName: string | null };

/** True when BTMS calls the company something other than the register does. */
function differs(registerName: string, btmsName: string | null): btmsName is string {
  if (!btmsName) return false;
  return btmsName.trim().toLowerCase() !== registerName.trim().toLowerCase();
}

export default function ChooseClient() {
  const { choose } = useReportingSession();
  const [clients, setClients] = useState<Choice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      // client_settings is in the reporting schema; the names come from the
      // portal's own register, which is the only place client names live.
      const { data: reg, error: e1 } = await supabase.schema('reporting')
        .from('client_settings').select('client_id, btms_company_name');
      if (e1) { setError(e1.message); return; }
      const rows = (reg ?? []) as { client_id: number; btms_company_name: string | null }[];
      const ids = rows.map((r) => r.client_id);
      const btms = new Map(rows.map((r) => [r.client_id, r.btms_company_name]));
      if (!ids.length) { setClients([]); return; }

      const { data, error: e2 } = await supabase
        .from('clients').select('id, name, client_code')
        .in('id', ids).is('deleted_at', null).order('name');
      if (e2) { setError(e2.message); return; }
      setClients((data ?? []).map((c) => {
        const r = c as { id: number; name: string | null; client_code: string | null };
        return {
          id: r.id,
          name: r.name ?? `Client ${r.id}`,
          code: r.client_code,
          btmsName: btms.get(r.id) ?? null,
        };
      }));
    })();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients ?? [];
    return (clients ?? []).filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.code ?? '').toLowerCase().includes(needle) ||
        (c.btmsName ?? '').toLowerCase().includes(needle),
    );
  }, [clients, q]);

  return (
    <div style={{ maxWidth: 560, margin: '10vh auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Client reporting</h1>
      <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 13 }}>
        Choose the client to work on. It is fixed for the whole session — every figure,
        every import and every report belongs to it until you leave.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <input
        className="form-input" autoFocus placeholder="Search by name or code…"
        value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 12 }}
      />

      {clients === null && <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>}

      {clients?.length === 0 && (
        <div className="empty-state">
          <p>No client is registered for reporting yet.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
        {shown.map((c) => (
          <button
            key={c.id} className="btn btn-secondary"
            style={{ justifyContent: 'flex-start', textAlign: 'left', gap: 10, alignItems: 'flex-start' }}
            onClick={() => choose({ id: c.id, name: c.name, code: c.code })}
          >
            {c.code && (
              <span style={{
                fontFamily: 'ui-monospace, monospace', fontSize: 11, background: '#0f172a',
                color: '#fff', padding: '2px 6px', borderRadius: 3, marginTop: 1, flex: 'none',
              }}>{c.code}</span>
            )}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span>{c.name}</span>
              {/* Two clients here differ only after their first two words, and the
                  register and BTMS spell the same company differently. Showing the
                  BTMS name when it differs is what makes the right row pickable. */}
              {differs(c.name, c.btmsName) && (
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>
                  BTMS: {c.btmsName}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
