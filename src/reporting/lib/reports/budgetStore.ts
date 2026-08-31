// The budget, saved where the practice can see it.
//
// The template keeps the budget as BUD[lineId][monthIndex] in browser storage,
// under one key for every client. That is the second of the two prototype-isms
// BUILD.md §4 names, and it is the more serious of them: a budget keyed against
// one client showed under every other client's name, and it lived and died with
// one browser profile.
//
// The template still writes local storage first, so typing stays instant and a
// failed save loses nothing. This writes the record.
//
// Rows are upserted BEFORE the stale ones are deleted. The other order leaves a
// window in which the client has no budget at all, and a failure inside that
// window loses a budget that took a meeting to agree.

import { supabase } from '../../../lib/supabase';

const rep = () => supabase.schema('reporting');

/** What the template posts: its month spine and BUD[lineId][monthIndex]. */
export type BudgetMessage = {
  months: string[];
  budget: Record<string, Record<string, number | null>>;
};

type Row = { client_id: number; fin_year: number; line_id: string; month: number; amount: number };

function rowsFrom(clientId: number, msg: BudgetMessage): Row[] {
  const out: Row[] = [];
  for (const [lineId, byMonth] of Object.entries(msg.budget ?? {})) {
    for (const [mi, amount] of Object.entries(byMonth ?? {})) {
      const month = msg.months?.[Number(mi)];
      // A figure against a month this client does not hold cannot be filed
      // under a year, and inventing one would put it in the wrong year.
      if (!month || amount === null || amount === undefined) continue;
      const n = Number(amount);
      if (!Number.isFinite(n)) continue;
      out.push({
        client_id: clientId,
        fin_year: Number(month.slice(0, 4)),
        line_id: lineId,
        month: Number(month.slice(5, 7)),
        amount: n,
      });
    }
  }
  return out;
}

const keyOf = (r: { fin_year: number; line_id: string; month: number }) =>
  `${r.fin_year}|${r.line_id}|${r.month}`;

export async function saveBudget(clientId: number, msg: BudgetMessage): Promise<void> {
  const rows = rowsFrom(clientId, msg);
  const { data: me } = await supabase.auth.getUser();
  const stamped = rows.map((r) => ({ ...r, updated_by: me.user?.id ?? null, updated_at: new Date().toISOString() }));

  if (stamped.length) {
    const { error } = await rep().from('budgets')
      .upsert(stamped, { onConflict: 'client_id,fin_year,line_id,month' });
    if (error) throw new Error(`The budget was not saved: ${error.message}`);
  }

  // Whatever the template no longer holds has been cleared, and clearing is a
  // thing a person does on purpose — "Clear the whole budget" is a button.
  const held = await rep().from('budgets')
    .select('fin_year, line_id, month').eq('client_id', clientId);
  if (held.error) throw new Error(`The budget was saved but not tidied: ${held.error.message}`);

  const wanted = new Set(rows.map(keyOf));
  const stale = ((held.data ?? []) as { fin_year: number; line_id: string; month: number }[])
    .filter((r) => !wanted.has(keyOf(r)));
  if (!stale.length) return;

  // One call per line rather than one per figure: a cleared year is twelve
  // months on one line, and the filter takes a list of months.
  const byLine = new Map<string, { years: Set<number>; months: Set<number> }>();
  for (const r of stale) {
    let g = byLine.get(r.line_id);
    if (!g) { g = { years: new Set(), months: new Set() }; byLine.set(r.line_id, g); }
    g.years.add(r.fin_year);
    g.months.add(r.month);
  }
  for (const [lineId, g] of byLine) {
    // Narrowed to the exact keys again afterwards is not possible in one call,
    // so anything inside the year/month box that IS wanted is put back.
    const { error } = await rep().from('budgets').delete()
      .eq('client_id', clientId).eq('line_id', lineId)
      .in('fin_year', [...g.years]).in('month', [...g.months]);
    if (error) throw new Error(`A cleared budget figure was not removed: ${error.message}`);
  }
  const putBack = rows.filter((r) => byLine.has(r.line_id)
    && byLine.get(r.line_id)!.years.has(r.fin_year)
    && byLine.get(r.line_id)!.months.has(r.month));
  if (putBack.length) {
    const { error } = await rep().from('budgets').upsert(
      putBack.map((r) => ({ ...r, updated_by: me.user?.id ?? null, updated_at: new Date().toISOString() })),
      { onConflict: 'client_id,fin_year,line_id,month' },
    );
    if (error) throw new Error(`The budget was not fully restored after clearing: ${error.message}`);
  }
}
