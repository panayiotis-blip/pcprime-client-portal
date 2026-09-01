// Correcting what a file in the BTMS folder is.
//
// The type and the period are the only two things a person types about a BTMS
// export, and until now a typo in either could not be undone: the file was in
// the wrong subfolder under the wrong name, and the only way back was to delete
// it and upload it again. That destroys the upload date, which is the record of
// when the client actually sent it.
//
// So this corrects the row instead. Changing the type moves the file to the
// matching subfolder and changes the feed the reporting app treats it as;
// changing the period changes what it is filed under; and the derived name
// follows both, because the name is made from them.
//
// The bytes never move. The storage path is just a path — what puts a file in a
// folder is documents.folder_id, and what makes it a journal listing is the kind
// on its check row.

import { supabase } from '../../../lib/supabase';
import { derivedFileName, KIND_NAME, periodLabel } from './naming.ts';

const rep = () => supabase.schema('reporting');

export type BtmsTag = {
  documentId: number;
  kind: string;
  period: string | null;
  /** What BTMS called it, kept on the row as a note. */
  original: string;
  /** "Trial balance", from the kind. */
  kindName: string;
  /** "January 2026", from the period. */
  when: string;
};

const AS_EXPORTED = 'As exported:';

const originalOf = (notes: string | null, fileName: string) =>
  (notes ?? '').startsWith(AS_EXPORTED)
    ? (notes ?? '').slice(AS_EXPORTED.length).trim()
    : fileName;

/**
 * What each of these documents is, for the cards to print.
 *
 * A card used to read "Btms Export" with a bare number badge — the month, with
 * nothing to say that is what it was. This is where "Trial balance · January
 * 2026" comes from.
 */
export async function tagsFor(documents: { id: number; file_name: string; notes: string | null }[]):
Promise<Map<number, BtmsTag>> {
  const out = new Map<number, BtmsTag>();
  if (!documents.length) return out;

  const { data, error } = await rep().from('btms_file_checks')
    .select('document_id, kind, period')
    .in('document_id', documents.map((d) => d.id));
  // A card that cannot say what a file is falls back to its name, which since
  // migration 218 is the same words anyway. Not worth failing the screen over.
  if (error) { console.warn('btms_file_checks:', error.message); return out; }

  const byId = new Map(documents.map((d) => [d.id, d]));
  for (const r of (data ?? []) as { document_id: number; kind: string; period: string | null }[]) {
    const doc = byId.get(Number(r.document_id));
    if (!doc) continue;
    out.set(Number(r.document_id), {
      documentId: Number(r.document_id),
      kind: r.kind,
      period: r.period,
      original: originalOf(doc.notes, doc.file_name),
      kindName: KIND_NAME[r.kind] ?? 'BTMS export',
      when: periodLabel(r.period, r.kind),
    });
  }
  return out;
}

/**
 * Re-file a document as a different report, a different period, or both.
 *
 * Everything that follows from the type and the period is rewritten together —
 * the folder, the name, the year and month it is filed under, the count date —
 * because leaving any of them behind is how a file comes to be a trial balance
 * in the Payroll folder called something else entirely.
 */
export async function retagDocument(
  clientId: number,
  documentId: number,
  kind: string,
  period: string | null,
): Promise<void> {
  const doc = await supabase.from('documents')
    .select('id, file_name, notes').eq('id', documentId).single();
  if (doc.error) throw new Error(`Reading the document: ${doc.error.message}`);
  const row = doc.data as { id: number; file_name: string; notes: string | null };

  // One mapping from a report's kind to its folder, and it is in the database
  // so that both ways in agree (migration 215).
  const folder = await supabase.rpc('btms_folder_for', { p_client: clientId, p_kind: kind });
  if (folder.error) throw new Error(`Finding the folder: ${folder.error.message}`);

  const original = originalOf(row.notes, row.file_name);
  const update: Record<string, unknown> = {
    folder_id: Number(folder.data),
    file_name: derivedFileName(kind, period, original),
    year: period ? period.slice(0, 4) : null,
    month: period && period.length >= 7 ? period.slice(5, 7) : null,
    period_end: kind === 'stock' && period && /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : null,
  };

  const moved = await supabase.from('documents').update(update).eq('id', documentId);
  if (moved.error) throw new Error(`Re-filing the document: ${moved.error.message}`);

  // The check row is what the reporting app reads to decide what this file is,
  // so a document moved without it would sit in Trial balances and still be
  // imported as payroll.
  const tagged = await rep().from('btms_file_checks')
    .update({ kind, period }).eq('document_id', documentId);
  if (tagged.error) {
    throw new Error(
      `The file was re-filed but the reporting app still reads it as it was: ${tagged.error.message}`,
    );
  }
}
