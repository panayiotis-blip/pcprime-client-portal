// Which charts the overview shows, as somebody decided (FIX-3 §4a).
//
// The prototype drew three charts for every client because three charts were
// what it drew. A haulier wants cash and bank and the debtor ageing on the front
// page; a shop wants sales by month and where the money went. So it is a choice,
// made per client, beside the Client setup switches.
//
// Stored the same way the sections are, and for the same reason: a key absent
// means nobody has decided and the default stands, a key present is a decision.
// See sectionStore.ts, which this deliberately mirrors — two stores that behave
// differently for the same kind of choice is how a screen starts lying.

import { supabase } from '../../../lib/supabase';

const rep = () => supabase.schema('reporting');

/**
 * The charts the overview can draw. Anything else is not a chart.
 *
 * The three the prototype already drew are on by default; the rest are off
 * until somebody asks for them, so no client's overview changes on the day
 * this ships.
 */
export const CHARTS = {
  sales:    { on: true,  name: 'Sales by month' },
  margin:   { on: true,  name: 'Gross margin' },
  money:    { on: true,  name: 'Where the money went' },
  overhead: { on: false, name: 'Overheads by month' },
  cash:     { on: false, name: 'Cash and bank' },
  ageing:   { on: false, name: 'Debtors and creditors ageing' },
  customer: { on: false, name: 'Sales by customer' },
  budget:   { on: false, name: 'Expenses against budget' },
} as const;

export type ChartKey = keyof typeof CHARTS;

export const isChart = (k: string): k is ChartKey =>
  Object.prototype.hasOwnProperty.call(CHARTS, k);

/** The defaults, as the template reads them: 1 on, 0 off. */
export function defaultCharts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(CHARTS)) out[k] = v.on ? 1 : 0;
  return out;
}

/** A decision overrides the default; anything absent leaves it standing. */
export function applyChartChoices(
  charts: Record<string, number>,
  held: Record<string, boolean> | null | undefined,
): void {
  for (const [k, on] of Object.entries(held ?? {})) {
    if (!isChart(k)) continue;                  // not a chart this app draws
    charts[k] = on ? 1 : 0;
  }
}

/**
 * Record one decision.
 *
 * Read-modify-write on a jsonb object, which is a race if two people set two
 * switches on the same client in the same second. Two people configuring one
 * client at the same moment is not a thing that happens; if it ever does, this
 * is the place to make it a jsonb_set in the database rather than here. The
 * same note stands over setSection, and for the same reason.
 */
export async function setChart(clientId: number, chart: string, on: boolean): Promise<void> {
  if (!isChart(chart)) throw new Error(`${chart} is not a chart the overview draws.`);

  const held = await rep().from('client_settings')
    .select('chart_choices').eq('client_id', clientId).maybeSingle();
  if (held.error) throw new Error(`Reading the charts: ${held.error.message}`);

  const current = ((held.data as { chart_choices: Record<string, boolean> | null } | null)
    ?.chart_choices) ?? {};
  const next = { ...current, [chart]: on };

  const { data: me } = await supabase.auth.getUser();
  const { error } = await rep().from('client_settings').upsert(
    {
      client_id: clientId,
      chart_choices: next,
      updated_by: me.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' });
  if (error) throw new Error(`Saving the charts: ${error.message}`);
}
