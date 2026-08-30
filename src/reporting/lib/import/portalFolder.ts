// The client's BTMS data folder, in the portal.
//
// The exports live with the client, in the portal's own documents folder, on
// the portal's own access model. Migration 204 explains why that beats a folder
// on one machine: the folder IS the client, so nothing is typed and nothing can
// be mistyped; it works from any machine; and it is backed up with everything
// else rather than living on whichever laptop did the import.
//
// documents.year and documents.month carry the two dates no BTMS export
// contains — the trial balance period and the stock count date. They are asked
// for at upload, beside the file, rather than guessed from a name afterwards.

import { supabase } from '../../../lib/supabase';
import { readSheetRows } from './sheet.ts';
import { identify, suggestedDate, type FeedKind } from './folder.ts';

const BUCKET = 'documents';

export type PortalFile = {
  id: number;
  fileName: string;
  storagePath: string;
  year: string;
  month: string;
  uploadedAt: string;
  kind: FeedKind;
  summary: string;
  /** From year/month if given at upload, else read from the name. */
  suggested: string | null;
};

/** The folder, made the first time it is wanted. */
export async function btmsFolderId(clientId: number): Promise<number> {
  const { data, error } = await supabase.rpc('btms_data_folder', { p_client: clientId });
  if (error) throw new Error(`BTMS folder: ${error.message}`);
  return Number(data);
}

/** A safe storage segment, matching what the portal does elsewhere. */
const safe = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(0, 120);

export async function uploadToBtmsFolder(
  clientId: number,
  file: File,
  when: { year: string; month: string },
): Promise<void> {
  const folderId = await btmsFolderId(clientId);
  // The client id leads the path, as everywhere else, so a file cannot be
  // written into another client's space.
  const path = `${clientId}/btms/${Date.now()}_${safe(file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file);
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase.from('documents').insert({
    client_id: clientId,
    folder_id: folderId,
    doc_type: 'btms_export',
    category: 'btms',
    year: when.year,
    month: when.month,
    file_name: file.name,
    mime_type: file.type || 'application/vnd.ms-excel',
    storage_path: path,
    storage_bucket: BUCKET,
    uploaded_by: me.user?.id ?? null,
  });
  if (error) throw new Error(`The file was stored but not recorded: ${error.message}`);
}

/** Fetch one back, as a File the importers can take. */
export async function fileFromPortal(f: PortalFile): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET).download(f.storagePath);
  if (error || !data) throw new Error(`Could not read ${f.fileName}: ${error?.message}`);
  return new File([data], f.fileName, { type: 'application/vnd.ms-excel' });
}

/**
 * What is in the folder, and what each file is.
 *
 * The kind is decided by reading the file, never by its name — the same rule as
 * everywhere else. That costs a download per file, which is why it is done once
 * on opening and not on every render.
 */
export async function listBtmsFolder(
  clientId: number,
  onProgress: (name: string, done: number, total: number) => void = () => {},
): Promise<PortalFile[]> {
  const folderId = await btmsFolderId(clientId);
  const { data, error } = await supabase
    .from('documents')
    .select('id, file_name, storage_path, year, month, created_at')
    .eq('client_id', clientId).eq('folder_id', folderId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading the folder: ${error.message}`);

  const rows = (data ?? []) as {
    id: number; file_name: string; storage_path: string;
    year: string | null; month: string | null; created_at: string;
  }[];

  const out: PortalFile[] = [];
  let done = 0;
  for (const r of rows) {
    onProgress(r.file_name, ++done, rows.length);
    const base: PortalFile = {
      id: r.id,
      fileName: r.file_name,
      storagePath: r.storage_path,
      year: r.year ?? '',
      month: r.month ?? '',
      uploadedAt: r.created_at,
      kind: 'unknown',
      summary: '',
      suggested: null,
    };
    try {
      const blob = await supabase.storage.from(BUCKET).download(r.storage_path);
      if (blob.error || !blob.data) throw new Error(blob.error?.message ?? 'not readable');
      const rows2 = await readSheetRows(blob.data);
      const { kind, summary } = identify(rows2 as unknown[][]);
      // What was said at upload wins; the file name is only a fallback.
      const stated = r.year && r.month ? `${r.year}-${String(r.month).padStart(2, '0')}`
        : r.year ? String(r.year) : null;
      out.push({ ...base, kind, summary, suggested: stated ?? suggestedDate(r.file_name) });
    } catch (e) {
      out.push({
        ...base,
        summary: e instanceof Error ? e.message : 'could not be read',
      });
    }
  }
  return out;
}
