// Where a client's books are kept -- read and written from the client's own
// record in the portal.
//
// The fact lives in reporting.client_settings.data_source, which is what
// clients_for_reporting() filters on (migration 206): only 'btms_local' and
// 'btms_client' are offered by the reporting application, because there is no
// feed for anything else. What the something else IS gets recorded in
// other_program, so nobody has to ask again.
//
// The portal writes it because the fact belongs to the client, not to the
// reporting application. A person changing one client should not have to open
// a second application to say where that client's books are.
//
// Who may: client_settings carries the client_scoped policy, which defers to
// reporting.staff_can_access() -- owner, supervisor, admin, staff (migration
// 214). A client or app_user account reads nothing and writes nothing, and
// needs no check here to be told so.

import { supabase } from '../lib/supabase';

export type BooksSource = 'none' | 'btms_local' | 'btms_client' | 'other';

export interface BooksLocation {
  source: BooksSource;
  /** The program named when the books are on something other than BTMS. */
  program: string;
  /** A settings row exists at all — what the reporting setup screen calls "reported". */
  recorded: boolean;
}

const rep = () => supabase.schema('reporting');

export async function getBooksLocation(clientId: number): Promise<BooksLocation> {
  const { data, error } = await rep()
    .from('client_settings')
    .select('data_source, other_program')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { source: 'none', program: '', recorded: false };
  return {
    source: ((data as any).data_source ?? 'none') as BooksSource,
    program: (data as any).other_program ?? '',
    recorded: true,
  };
}

/**
 * Records where this client's books are. Creates the settings row the first
 * time, and leaves every other setting on it alone thereafter: PostgREST's
 * upsert updates only the columns in the payload, so year_end_month, the VAT
 * scheme, has_stock and the rest survive a change of mind about BTMS.
 */
export async function setBooksLocation(
  clientId: number,
  source: BooksSource,
  program: string,
): Promise<void> {
  const { error } = await rep()
    .from('client_settings')
    .upsert(
      {
        client_id: clientId,
        data_source: source,
        // The program name belongs to 'other' and to nothing else. Clearing it
        // on the way past stops a stale "Sage" sitting behind a client who has
        // since moved onto BTMS.
        other_program: source === 'other' ? (program.trim() || null) : null,
      },
      { onConflict: 'client_id' },
    );
  if (error) throw new Error(error.message);
}
