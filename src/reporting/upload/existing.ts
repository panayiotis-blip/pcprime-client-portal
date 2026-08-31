// Is this feed and period already loaded, and by whom?
//
// The partner asked for exactly this: "If I upload the same month or period or
// whatever, it must give me a warning and allow me to override the old upload."
// A warning that says only "already loaded" is not much of a warning — the
// question a person actually has is *which* file, loaded *when*, by *whom*, so
// they can tell a re-export after a correction from a mistake.
//
// The folder is the record, so btms_file_checks is what is asked: it carries
// the kind and the period of every file stored, against the document row that
// holds the name, the date and the person.

import { supabase } from '../../lib/supabase';

const rep = () => supabase.schema('reporting');

export type Already = {
  documentId: number;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
  period: string | null;
};

/**
 * A journal listing covering January to August covers July as well, so a plain
 * string match would miss it. Everything else states one period and matches it.
 */
function covers(held: string | null, wanted: string | null): boolean {
  if (!wanted) return !held;
  if (held === wanted) return true;
  if (!held) return false;
  const span = (p: string) => p.split(/\s+to\s+/).map((x) => x.trim().slice(0, 7));
  const h = span(held), w = span(wanted).slice(0, 1);
  if (!h.every((x) => /^\d{4}-\d{2}$/.test(x)) || !/^\d{4}-\d{2}$/.test(w[0])) {
    // A year against a month: 2026 covers 2026-07.
    return held.length === 4 && wanted.startsWith(held);
  }
  return h[0] <= w[0] && h[h.length - 1] >= w[0];
}

export async function alreadyLoaded(
  clientId: number, kind: string, period: string | null,
): Promise<Already | null> {
  const checks = await rep().from('btms_file_checks')
    .select('document_id, period').eq('client_id', clientId).eq('kind', kind);
  if (checks.error) throw new Error(`Looking for what is already loaded: ${checks.error.message}`);

  const rows = (checks.data ?? []) as { document_id: number; period: string | null }[];
  const hits = rows.filter((r) => covers(r.period, period)).map((r) => Number(r.document_id));
  if (!hits.length) return null;

  // Only what is still standing. A file already replaced is not what a person
  // is being warned about.
  const docs = await supabase.from('documents')
    .select('id, file_name, created_at, uploaded_by')
    .in('id', hits).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(1);
  if (docs.error) throw new Error(`Reading the folder: ${docs.error.message}`);
  const doc = (docs.data ?? [])[0] as
    { id: number; file_name: string; created_at: string; uploaded_by: string | null } | undefined;
  if (!doc) return null;

  let by: string | null = null;
  if (doc.uploaded_by) {
    const who = await supabase.from('profiles').select('full_name, email').eq('id', doc.uploaded_by).maybeSingle();
    const p = who.data as { full_name: string | null; email: string | null } | null;
    by = p?.full_name || p?.email || null;
  }

  const period_ = rows.find((r) => Number(r.document_id) === Number(doc.id))?.period ?? null;
  return {
    documentId: Number(doc.id),
    fileName: doc.file_name,
    uploadedAt: doc.created_at,
    uploadedBy: by,
    period: period_,
  };
}
