// Comparison columns the partner types himself (FIX-3 §3).
//
// A target, a what-if, an agreed adjustment: figures put in during a meeting so
// the arithmetic can be seen against the ledger. They are NOT from the ledger,
// nothing derives them, and nothing but the profit and loss reads them.
//
// Kept in the database rather than the browser for the reason migration 191
// moved the budget: a conversation held on one machine is worth nothing on
// another, and a storage key with no client in it shows one client's figures
// under every other client's name.
//
// The period is the two month keys the report was showing when the column was
// typed. A column keyed against January to July is offered when the profit and
// loss is showing January to July and not otherwise — a target for seven months
// is not a target for twelve.

import { supabase } from '../../../lib/supabase';

const rep = () => supabase.schema('reporting');

/** One keyed column, in the shape the template holds it. */
export type KeyedColumn = {
  id: number;
  from: string;                       // '2026-01'
  to: string;                         // '2026-07'
  name: string;
  amounts: Record<string, number>;    // report line id -> amount for the period
};

/** What the template posts when Save is pressed. */
export type KeyedMessage = {
  id?: number | null;
  from: string;
  to: string;
  name: string;
  amounts: Record<string, number | null>;
};

type Row = {
  id: number; period_from: string; period_to: string;
  name: string; amounts: Record<string, number> | null;
};

const clean = (a: Record<string, number | null> | null): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a ?? {})) {
    // A line left blank was not keyed, which is not the same as keyed at
    // nought: the column prints nothing against it and the total ignores it.
    if (v === null || v === undefined || v === '' as unknown as number) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

export async function loadKeyedColumns(clientId: number): Promise<KeyedColumn[]> {
  const { data, error } = await rep().from('keyed_columns')
    .select('id, period_from, period_to, name, amounts')
    .eq('client_id', clientId)
    .order('period_to', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw new Error(`keyed_columns: ${error.message}`);
  return (data ?? []).map((r: Row) => ({
    id: r.id,
    from: r.period_from,
    to: r.period_to,
    name: String(r.name),
    amounts: clean(r.amounts),
  }));
}

export async function saveKeyedColumn(clientId: number, msg: KeyedMessage): Promise<number> {
  const name = String(msg.name ?? '').trim();
  if (!name) throw new Error('a keyed column needs a name');
  if (!msg.from || !msg.to) throw new Error('a keyed column needs the period it was keyed against');

  const { data: me } = await supabase.auth.getUser();
  const row = {
    client_id: clientId,
    period_from: msg.from,
    period_to: msg.to,
    name,
    amounts: clean(msg.amounts),
    updated_by: me.user?.id ?? null,
    updated_at: new Date().toISOString(),
  };

  // Keying the same name against the same period twice is a correction of the
  // first, not a second column, so the unique key settles it rather than the
  // caller having to know whether this one exists.
  const { data, error } = await rep().from('keyed_columns')
    .upsert({ ...row, created_by: me.user?.id ?? null },
            { onConflict: 'client_id,period_from,period_to,name' })
    .select('id')
    .single();
  if (error) throw new Error(`keyed_columns: ${error.message}`);
  return Number((data as { id: number }).id);
}

export async function deleteKeyedColumn(
  clientId: number, from: string, to: string, name: string,
): Promise<void> {
  const n = String(name ?? '').trim();
  if (!n || !from || !to) throw new Error('a keyed column is identified by its period and its name');
  // Addressed the same way it is saved — by the unique key — so the template
  // never has to carry a row id, and a stale id cannot reach another client's
  // column. The client is in the filter as well; the policy would refuse
  // another client's row anyway, but a filter that says so fails at nothing
  // rather than at somebody else's data.
  const { error } = await rep().from('keyed_columns')
    .delete()
    .eq('client_id', clientId).eq('period_from', from).eq('period_to', to).eq('name', n);
  if (error) throw new Error(`keyed_columns: ${error.message}`);
}
