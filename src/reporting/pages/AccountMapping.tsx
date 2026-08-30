// Configure → Account mapping. BUILD.md §8.
//
// Each account against the master report lines, overridable, with a
// changed-from-default count and a reset, and every change audit-logged
// against the person who made it.
//
// Two tables, two jobs. reporting.mapping_defaults is what the account SHOULD
// map to, as drafted from the chart. reporting.mappings holds ONLY what a
// person decided instead. That is what makes "changed from default" a count
// rather than a guess, and "reset" a deletion rather than a second opinion:
// remove the override and the default is simply there again.
//
// A default of null is deliberate and says so on screen. Headings and control
// accounts are not reported anywhere, which is a different thing from an
// account nobody has got to yet — and the difference is the whole value of
// the unmapped count.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useReportingSession } from '../session';
import { allRows } from '../lib/import/pages.ts';

type Line = {
  line_id: string;
  statement: 'pl' | 'bs';
  section: string;
  line_name: string;
  sort_order: number;
  is_subtotal: boolean;
  is_derived: boolean;
};

type Row = {
  code: string;
  name: string;
  accountType: string | null;
  category: string | null;
  isHeader: boolean;
  /** What it should map to. Null means deliberately not reported. */
  defaultLine: string | null;
  hasDefault: boolean;
  /** What a person chose instead, if they did. */
  override: string | null;
  saving: boolean;
  error: string | null;
};

const rep = () => supabase.schema('reporting');

/** The line actually in force: the override if there is one, else the default. */
const effective = (r: Row) => (r.override !== null ? r.override : r.defaultLine);

export default function AccountMapping() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const [lines, setLines] = useState<Line[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'unmapped' | 'changed' | 'notreported'>('all');

  const load = useCallback(async () => {
    // The master template's lines. A client copy would be found the same way
    // with client_id = clientId; there is only the master today.
    const { data: tpl, error: e0 } = await rep()
      .from('templates').select('id')
      .eq('kind', 'report_lines').is('client_id', null).limit(1).maybeSingle();
    if (e0) { setError(e0.message); return; }
    if (!tpl) { setError('The master report lines have not been loaded (migration 197).'); return; }

    const [ln, accounts, defs, over] = await Promise.all([
      rep().from('report_lines')
        .select('line_id, statement, section, line_name, sort_order, is_subtotal, is_derived')
        .eq('template_id', (tpl as { id: number }).id).order('sort_order'),
      allRows<{ code: string; name: string; account_type: string | null; btms_category: string | null; is_header: boolean }>(
        (from, to) => rep().from('coa_accounts')
          .select('code, name, account_type, btms_category, is_header')
          .eq('client_id', clientId).range(from, to)),
      allRows<{ account_code: string; line_id: string | null }>(
        (from, to) => rep().from('mapping_defaults')
          .select('account_code, line_id').eq('client_id', clientId).range(from, to)),
      allRows<{ account_code: string; line_id: string }>(
        (from, to) => rep().from('mappings')
          .select('account_code, line_id').eq('client_id', clientId).range(from, to)),
    ]);
    if (ln.error) { setError(ln.error.message); return; }
    setLines((ln.data ?? []) as Line[]);

    const defByCode = new Map(defs.map((d) => [String(d.account_code), d.line_id]));
    const ovByCode = new Map(over.map((o) => [String(o.account_code), o.line_id]));

    // Everything that needs a decision: the nominal accounts, plus anything a
    // default exists for. The two extras are the debtor and creditor controls,
    // which carry no postings themselves — the sub-accounts roll up to them.
    const byCode = new Map<string, Row>();
    for (const a of accounts) {
      if (a.account_type === 'Debtor' || a.account_type === 'Creditor') continue;
      byCode.set(String(a.code), {
        code: String(a.code),
        name: a.name ?? '',
        accountType: a.account_type,
        category: a.btms_category,
        isHeader: !!a.is_header,
        defaultLine: defByCode.get(String(a.code)) ?? null,
        hasDefault: defByCode.has(String(a.code)),
        override: ovByCode.get(String(a.code)) ?? null,
        saving: false, error: null,
      });
    }
    for (const [code, line] of defByCode) {
      if (byCode.has(code)) continue;
      byCode.set(code, {
        code, name: '(control account — sub-accounts roll up here)',
        accountType: null, category: null, isHeader: false,
        defaultLine: line, hasDefault: true,
        override: ovByCode.get(code) ?? null,
        saving: false, error: null,
      });
    }
    setRows([...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const patch = (code: string, p: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.code === code ? { ...r, ...p } : r)));

  /** Every change is recorded against the person who made it. §8. */
  const logChange = async (code: string, action: string, detail: Record<string, unknown>) => {
    const { data: me } = await supabase.auth.getUser();
    if (!me.user) return;
    await rep().from('audit_log').insert({
      client_id: clientId, entity: 'mapping', entity_id: code,
      action, detail, acted_by: me.user.id,
    });
  };

  const setLine = async (row: Row, lineId: string) => {
    patch(row.code, { saving: true, error: null });
    const { data: me } = await supabase.auth.getUser();

    // Choosing the default again is a reset, not an override. Storing it would
    // make the changed-from-default count wrong from that moment on.
    if (lineId === (row.defaultLine ?? '')) {
      const { error: e } = await rep().from('mappings')
        .delete().eq('client_id', clientId).eq('account_code', row.code);
      if (e) { patch(row.code, { saving: false, error: e.message }); return; }
      await logChange(row.code, 'mapping.reset', { from: row.override, back_to_default: row.defaultLine });
      patch(row.code, { saving: false, override: null });
      return;
    }

    const { error: e } = await rep().from('mappings').upsert({
      client_id: clientId,
      account_code: row.code,
      line_id: lineId,
      created_by: me.user?.id ?? null,
    }, { onConflict: 'client_id,account_code,effective_from' });
    if (e) { patch(row.code, { saving: false, error: e.message }); return; }
    await logChange(row.code, 'mapping.override', {
      from: effective(row), to: lineId, default: row.defaultLine,
    });
    patch(row.code, { saving: false, override: lineId });
  };

  const reset = async (row: Row) => {
    patch(row.code, { saving: true, error: null });
    const { error: e } = await rep().from('mappings')
      .delete().eq('client_id', clientId).eq('account_code', row.code);
    if (e) { patch(row.code, { saving: false, error: e.message }); return; }
    await logChange(row.code, 'mapping.reset', { from: row.override, back_to_default: row.defaultLine });
    patch(row.code, { saving: false, override: null });
  };

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      changed: all.filter((r) => r.override !== null).length,
      unmapped: all.filter((r) => effective(r) === null && r.hasDefault === false).length,
      notReported: all.filter((r) => r.hasDefault && effective(r) === null).length,
    };
  }, [rows]);

  const byLineId = useMemo(() => new Map(lines.map((l) => [l.line_id, l])), [lines]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => {
        if (show === 'changed') return r.override !== null;
        if (show === 'unmapped') return effective(r) === null && !r.hasDefault;
        if (show === 'notreported') return r.hasDefault && effective(r) === null;
        return true;
      })
      .filter((r) => !needle
        || r.code.toLowerCase().includes(needle)
        || r.name.toLowerCase().includes(needle)
        || (byLineId.get(effective(r) ?? '')?.line_name ?? '').toLowerCase().includes(needle));
  }, [rows, q, show, byLineId]);

  return (
    <div style={{ padding: 24, maxWidth: 1080 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Account mapping</h1>
      <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px', maxWidth: 760 }}>
        Every account against a line of the master report. The default is drafted from the chart;
        change it here and the change is recorded against you. Debtors and creditors are not listed
        individually — they roll up to their control account, which is.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="form-input" placeholder="Search code, account or report line…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 240 }}
        />
        {([
          ['all', `All ${counts.total}`],
          ['changed', `Changed ${counts.changed}`],
          ['unmapped', `Unmapped ${counts.unmapped}`],
          ['notreported', `Not reported ${counts.notReported}`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            className={'btn btn-sm ' + (show === k ? 'btn-primary' : 'btn-secondary')}
            onClick={() => setShow(k)}
          >{label}</button>
        ))}
      </div>

      <p style={{ fontSize: 12, color: counts.unmapped ? '#b91c1c' : '#166534', margin: '0 0 10px' }}>
        {counts.unmapped === 0
          ? `Every account maps. ${counts.changed} changed from the default, ${counts.notReported} deliberately not reported.`
          : `${counts.unmapped} account${counts.unmapped === 1 ? '' : 's'} still have no line.`}
      </p>

      {rows === null && <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
        {shown.map((r, i) => {
          const eff = effective(r);
          const changed = r.override !== null;
          return (
            <div key={r.code} style={{
              display: 'grid', gridTemplateColumns: '90px minmax(160px,1fr) 120px 260px 70px',
              gap: 10, alignItems: 'center', padding: '7px 12px',
              borderTop: i ? '1px solid #f1f5f9' : 'none',
              background: changed ? '#fffbeb' : '#fff',
            }}>
              <span style={{
                fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#334155',
                background: '#f1f5f9', padding: '2px 6px', borderRadius: 3, textAlign: 'center',
              }}>{r.code}</span>

              <span style={{ fontSize: 12.5, minWidth: 0 }}>
                {r.name}
                {r.isHeader && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>heading</span>}
                {r.error && <span style={{ display: 'block', fontSize: 11, color: '#b91c1c' }}>{r.error}</span>}
              </span>

              <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.category ?? r.accountType ?? '—'}</span>

              <select
                className="form-input" value={eff ?? ''} disabled={r.saving}
                style={{ fontSize: 12, padding: '3px 6px' }}
                onChange={(e) => void setLine(r, e.target.value)}
              >
                <option value="">
                  {r.hasDefault ? '— not reported —' : '— no line chosen —'}
                </option>
                {lines.filter((l) => !l.is_subtotal && !l.is_derived).map((l) => (
                  <option key={l.line_id} value={l.line_id}>
                    {l.statement === 'pl' ? 'P&L' : 'BS'} · {l.section} · {l.line_name}
                  </option>
                ))}
              </select>

              {changed ? (
                <button className="btn btn-secondary btn-sm" disabled={r.saving}
                  title={`Default is ${r.defaultLine ?? 'not reported'}`}
                  onClick={() => void reset(r)}>Reset</button>
              ) : <span />}
            </div>
          );
        })}
        {rows !== null && shown.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: '#94a3b8' }}>Nothing matches.</div>
        )}
      </div>
    </div>
  );
}
