// Reporting setup: which clients this platform reports on, and the key that
// ties each one to BTMS.
//
// It lives OUTSIDE the client session, reached from the chooser before a client
// is picked. That is deliberate: it is the one screen that is about many
// clients at once, and §12 forbids a client dropdown inside a session. Nothing
// here shows a client's figures — only whether we report them, and under which
// BTMS company.
//
// Why the code matters more than it looks. Some clients share a chart of
// accounts, so account-code fingerprinting cannot tell those clients apart:
// their nominal accounts are identical. The BTMS company code is therefore the
// identifier, recorded once, and the file name is what carries it in from an
// export that names no client anywhere inside it. The database enforces that no
// two clients share a code (client_settings_btms_code_uniq, migration 193) — a
// shared code would mean one set of books reported under two names.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type Client = { id: number; name: string; code: string | null };
type Setting = {
  client_id: number;
  btms_company_code: string | null;
  btms_company_name: string | null;
  data_source: string | null;
  other_program: string | null;
};

/**
 * Where a client's books are kept. Only the two BTMS kinds are offered by the
 * reporting application — there is no feed for anything else — but what the
 * something else IS gets recorded, so nobody has to ask again.
 */
const SOURCES: { value: string; label: string }[] = [
  { value: 'none', label: 'Not reported' },
  { value: 'btms_local', label: 'BTMS — ours' },
  { value: 'btms_client', label: "BTMS — client's" },
  { value: 'other', label: 'Another program' },
];

type Row = Client & {
  reported: boolean;
  btmsCode: string;
  btmsName: string;
  source: string;
  program: string;
  /** A committed import exists for this client — unticking would orphan it. */
  hasData: boolean;
  saving: boolean;
  error: string | null;
};

const rep = () => supabase.schema('reporting');

export default function ReportingSetup() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'reported' | 'unreported'>('reported');

  const load = useCallback(async () => {
    const [clients, settings, imports] = await Promise.all([
      supabase.from('clients').select('id, name, client_code').is('deleted_at', null).order('name'),
      rep().from('client_settings').select('client_id, btms_company_code, btms_company_name, data_source, other_program'),
      rep().from('imports').select('client_id').eq('status', 'committed'),
    ]);
    if (clients.error) { setError(clients.error.message); return; }
    if (settings.error) { setError(settings.error.message); return; }

    const byId = new Map<number, Setting>();
    for (const s of (settings.data ?? []) as Setting[]) byId.set(s.client_id, s);
    const withData = new Set<number>();
    for (const i of (imports.data ?? []) as { client_id: number }[]) withData.add(i.client_id);

    const src = (clients.data ?? []) as { id: number; name: string | null; client_code: string | null }[];
    setRows(src.map((c) => {
      const s = byId.get(c.id);
      return {
        id: c.id,
        name: c.name ?? 'Client ' + c.id,
        code: c.client_code,
        reported: !!s,
        btmsCode: s?.btms_company_code ?? '',
        btmsName: s?.btms_company_name ?? '',
        source: s?.data_source ?? 'none',
        program: s?.other_program ?? '',
        hasData: withData.has(c.id),
        saving: false,
        error: null,
      };
    }));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (id: number, p: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...p } : r)));

  /** Tick: the client becomes one we report on. Untick: it stops being one. */
  const toggle = async (row: Row, on: boolean) => {
    if (!on && row.hasData) {
      patch(row.id, {
        error: 'This client has a committed import. Remove its data before it stops being reported.',
      });
      return;
    }
    patch(row.id, { saving: true, error: null });
    const res = on
      ? await rep().from('client_settings').insert({ client_id: row.id })
      : await rep().from('client_settings').delete().eq('client_id', row.id);
    if (res.error) { patch(row.id, { saving: false, error: res.error.message }); return; }
    patch(row.id, {
      saving: false,
      reported: on,
      btmsCode: on ? row.btmsCode : '',
      btmsName: on ? row.btmsName : '',
    });
  };

  /** Saved on blur, not per keystroke: one write per edit rather than per letter. */
  const saveField = async (
    row: Row,
    field: 'btms_company_code' | 'btms_company_name' | 'data_source' | 'other_program',
    value: string,
  ) => {
    const trimmed = value.trim();
    patch(row.id, { saving: true, error: null });
    const { error: e } = await rep().from('client_settings')
      .update({ [field]: trimmed || null }).eq('client_id', row.id);
    if (e) {
      // The unique index is the one that fires in practice: the same BTMS
      // company cannot belong to two clients, and saying so plainly is more
      // use than the constraint's name.
      const dup = e.message.includes('client_settings_btms_code_uniq');
      patch(row.id, {
        saving: false,
        error: dup
          ? 'Another client is already recorded under BTMS code "' + trimmed + '".'
          : e.message,
      });
      return;
    }
    patch(row.id, {
      saving: false,
      btmsCode: field === 'btms_company_code' ? trimmed : row.btmsCode,
      btmsName: field === 'btms_company_name' ? trimmed : row.btmsName,
      source: field === 'data_source' ? trimmed : row.source,
      program: field === 'other_program' ? trimmed : row.program,
    });
  };

  /**
   * Where the books are is a statement of fact about a client, and 62 of them
   * have had no such statement made. Rather than guess one each — a list of
   * claims nobody made — this sets them all at once, deliberately, by somebody
   * who knows. It only touches clients that have been ticked as reported and
   * have not already been told where their books are.
   */
  const markAll = async (value: string) => {
    const targets = (rows ?? []).filter((r) => r.reported && r.source === 'none');
    if (!targets.length) return;
    setError(null);
    const { error: e } = await rep().from('client_settings')
      .update({ data_source: value })
      .in('client_id', targets.map((r) => r.id))
      .eq('data_source', 'none');
    if (e) { setError(e.message); return; }
    setRows((rs) => (rs ?? []).map((r) =>
      r.reported && r.source === 'none' ? { ...r, source: value } : r));
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => (show === 'all' ? true : show === 'reported' ? r.reported : !r.reported))
      .filter((r) => !needle
        || r.name.toLowerCase().includes(needle)
        || (r.code ?? '').toLowerCase().includes(needle)
        || r.btmsCode.toLowerCase().includes(needle)
        || r.btmsName.toLowerCase().includes(needle));
  }, [rows, q, show]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      reported: all.filter((r) => r.reported).length,
      keyed: all.filter((r) => r.reported && r.btmsCode).length,
      offered: all.filter((r) => r.source === 'btms_local' || r.source === 'btms_client').length,
    };
  }, [rows]);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 20px 60px' }}>
      <Link to="/reporting" style={{ fontSize: 12, color: '#64748b' }}>← Back to choosing a client</Link>
      <h1 style={{ fontSize: 22, margin: '10px 0 4px' }}>Reporting setup</h1>
      <p style={{ color: '#64748b', margin: '0 0 6px', fontSize: 13, maxWidth: 760 }}>
        Which clients this platform reports on, and the BTMS company each one's books are kept
        under. Not every client is on BTMS — tick only the ones that are.
      </p>
      <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 13, maxWidth: 760 }}>
        The <b>BTMS code</b> is the identifier. A BTMS export names no client anywhere inside it,
        and some clients share a chart of accounts, so the account codes cannot always tell one
        client from another — the code can. No two clients may hold the same one.
      </p>
      <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 13, maxWidth: 760 }}>
        <b>Where the books are</b> decides what the reporting application offers. Only the two BTMS
        kinds appear in its client list — there is no feed for anything else — but a client on
        another program is still recorded, with the program named, so nobody has to ask again.
        A client left on <i>Not reported</i> stays out of the list until somebody says where its
        books are.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          className="form-input" placeholder="Search name, client code or BTMS company…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 260 }}
        />
        {(['reported', 'unreported', 'all'] as const).map((k) => (
          <button
            key={k}
            className={'btn btn-sm ' + (show === k ? 'btn-primary' : 'btn-secondary')}
            onClick={() => setShow(k)}
          >
            {k === 'reported' ? 'Reported' : k === 'unreported' ? 'Not reported' : 'All'}
          </button>
        ))}
      </div>

      {counts.reported > counts.offered && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          padding: '8px 10px', marginBottom: 12, borderRadius: 5,
          border: '1px solid #fde68a', background: '#fffbeb',
        }}>
          <span style={{ fontSize: 12, color: '#92400e' }}>
            {counts.reported - counts.offered} reported {counts.reported - counts.offered === 1 ? 'client has' : 'clients have'}
            {' '}not been told where their books are, so the reporting app does not offer them.
          </span>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => void markAll('btms_local')}>
            All on our BTMS
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => void markAll('btms_client')}>
            All on the client's BTMS
          </button>
        </div>
      )}

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>
        {counts.reported} of {counts.total} clients reported · {counts.keyed} with a BTMS code
        {' · '}<b>{counts.offered}</b> offered in the reporting app
        {counts.reported > counts.keyed && ' · ' + (counts.reported - counts.keyed) + ' still to key'}
      </p>

      {rows === null && <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
        {shown.map((r, i) => (
          <div
            key={r.id}
            style={{
              display: 'grid',
              gridTemplateColumns:
                '30px 78px minmax(150px,1fr) 108px minmax(130px,190px) 122px minmax(120px,180px)',
              gap: 10,
              alignItems: 'center',
              padding: '9px 12px',
              borderTop: i ? '1px solid #f1f5f9' : 'none',
              background: r.reported ? '#fff' : '#fcfcfd',
            }}
          >
            <input
              type="checkbox" checked={r.reported} disabled={r.saving}
              onChange={(e) => void toggle(r, e.target.checked)}
              title={r.hasData ? 'This client has imported data' : 'Report on this client'}
            />
            <span style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#334155',
              background: '#f1f5f9', padding: '2px 6px', borderRadius: 3, textAlign: 'center',
            }}>{r.code ?? '—'}</span>

            <span style={{ fontSize: 13, color: r.reported ? '#0f172a' : '#94a3b8', minWidth: 0 }}>
              {r.name}
              {r.hasData && <span style={{ fontSize: 10, color: '#166534', marginLeft: 6 }}>· has data</span>}
              {r.error && (
                <span style={{ display: 'block', fontSize: 11, color: '#b91c1c', marginTop: 2 }}>{r.error}</span>
              )}
            </span>

            {r.reported ? (
              <>
                <input
                  className="form-input" placeholder="BTMS code" defaultValue={r.btmsCode}
                  disabled={r.saving}
                  style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== r.btmsCode) void saveField(r, 'btms_company_code', e.target.value);
                  }}
                />
                <input
                  className="form-input" placeholder="Company name as BTMS prints it" defaultValue={r.btmsName}
                  disabled={r.saving} style={{ fontSize: 12 }}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== r.btmsName) void saveField(r, 'btms_company_name', e.target.value);
                  }}
                />
                <select
                  className="form-input" value={r.source} disabled={r.saving} style={{ fontSize: 12 }}
                  title="Where this client's books are kept"
                  onChange={(e) => void saveField(r, 'data_source', e.target.value)}
                >
                  {SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {r.source === 'other' ? (
                  <input
                    className="form-input" placeholder="Which program?" defaultValue={r.program}
                    disabled={r.saving} style={{ fontSize: 12 }}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== r.program) void saveField(r, 'other_program', e.target.value);
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: r.source === 'none' ? '#b45309' : '#94a3b8' }}>
                    {r.source === 'none' ? 'not offered yet' : 'in the app'}
                  </span>
                )}
              </>
            ) : (
              <span style={{ gridColumn: 'span 4', fontSize: 12, color: '#cbd5e1' }}>not reported</span>
            )}
          </div>
        ))}
        {rows !== null && shown.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: '#94a3b8' }}>No client matches.</div>
        )}
      </div>
    </div>
  );
}
