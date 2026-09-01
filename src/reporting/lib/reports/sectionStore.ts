// Which sections a client gets, as somebody decided.
//
// The Client setup screen used to read back what the payload builder had worked
// out from the data. This is what makes it a choice: the switch writes here, and
// the builder applies what is here over anything the data implies.
//
// It is stored as one object rather than twenty columns — a key absent means
// nobody has decided and the default stands, a key present is a decision. That
// distinction is the whole point, and a boolean column with a default cannot
// express it.

import { supabase } from '../../../lib/supabase';

const rep = () => supabase.schema('reporting');

/** The twenty sections the template knows. Anything else is not a section. */
export const SECTIONS = [
  'pl', 'bs', 'summary', 'budget', 'cash', 'cashmove', 'expenses', 'sales',
  'stock', 'ledgers', 'accounts', 'vat', 'payroll', 'projects', 'review',
  'audit', 'stmt', 'trans', 'mapping', 'data',
] as const;

export type Section = (typeof SECTIONS)[number];

export const isSection = (k: string): k is Section =>
  (SECTIONS as readonly string[]).includes(k);

/**
 * Record one decision.
 *
 * Read-modify-write on a jsonb object, which is a race if two people set two
 * switches on the same client in the same second — the later write wins the
 * whole object and the earlier switch reverts. Two people configuring one
 * client at the same moment is not a thing that happens, and the alternative is
 * a column per section; if it ever does happen, this is the place to make it a
 * jsonb_set in the database rather than here.
 */
export async function setSection(clientId: number, section: string, on: boolean): Promise<void> {
  if (!isSection(section)) throw new Error(`${section} is not a section of the report.`);

  const held = await rep().from('client_settings')
    .select('section_overrides').eq('client_id', clientId).maybeSingle();
  if (held.error) throw new Error(`Reading the sections: ${held.error.message}`);

  const current = ((held.data as { section_overrides: Record<string, boolean> | null } | null)
    ?.section_overrides) ?? {};
  const next = { ...current, [section]: on };

  const { data: me } = await supabase.auth.getUser();
  const { error } = await rep().from('client_settings').upsert(
    {
      client_id: clientId,
      section_overrides: next,
      updated_by: me.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  );
  if (error) throw new Error(`The section was not saved: ${error.message}`);
}
