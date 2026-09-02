// What the standard pack looks like, per client (FIX-3 §5a).
//
// Not a preference of whoever is looking. The management summary with its
// percentages off is a different pack from the one with them on, and which one
// a client gets is a decision taken once and kept with the client — the same
// kind of decision as which sections they get and which charts.
//
// Stored the way those two are, and for the same reason: a key absent means
// nobody has decided and the default stands, a key present is a decision. See
// sectionStore.ts and chartStore.ts, which this deliberately mirrors.

import { supabase } from '../../../lib/supabase';

const rep = () => supabase.schema('reporting');

/** Every option the pack has, and what it is when nobody has said. */
export const PACK_OPTIONS = {
  // The summary has always printed a value and a percentage for each month, so
  // this is on until somebody turns it off and no client's pack changes today.
  summaryPercent: { on: true, name: 'Percentages on the management summary' },
} as const;

export type PackOption = keyof typeof PACK_OPTIONS;

export const isPackOption = (k: string): k is PackOption =>
  Object.prototype.hasOwnProperty.call(PACK_OPTIONS, k);

/** The defaults, as the template reads them: 1 on, 0 off. */
export function defaultPack(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(PACK_OPTIONS)) out[k] = v.on ? 1 : 0;
  return out;
}

/** A decision overrides the default; anything absent leaves it standing. */
export function applyPackOptions(
  pack: Record<string, number>,
  held: Record<string, boolean> | null | undefined,
): void {
  for (const [k, on] of Object.entries(held ?? {})) {
    if (!isPackOption(k)) continue;             // not an option this app has
    pack[k] = on ? 1 : 0;
  }
}

/**
 * Record one decision.
 *
 * Read-modify-write on a jsonb object, which is a race if two people set two
 * switches on the same client in the same second. Two people configuring one
 * client at the same moment is not a thing that happens; if it ever does, this
 * is the place to make it a jsonb_set in the database rather than here. The
 * same note stands over setSection and setChart.
 */
export async function setPackOption(clientId: number, option: string, on: boolean): Promise<void> {
  if (!isPackOption(option)) throw new Error(`${option} is not an option of the pack.`);

  const held = await rep().from('client_settings')
    .select('pack_options').eq('client_id', clientId).maybeSingle();
  if (held.error) throw new Error(`Reading the pack options: ${held.error.message}`);

  const current = ((held.data as { pack_options: Record<string, boolean> | null } | null)
    ?.pack_options) ?? {};
  const next = { ...current, [option]: on };

  const { data: me } = await supabase.auth.getUser();
  const { error } = await rep().from('client_settings').upsert(
    {
      client_id: clientId,
      pack_options: next,
      updated_by: me.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' });
  if (error) throw new Error(`Saving the pack options: ${error.message}`);
}
