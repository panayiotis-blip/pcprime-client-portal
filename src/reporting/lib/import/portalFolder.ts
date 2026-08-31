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
import { checkBtmsFile, FEEDS, type DocKind, type FileCheck, type Verdict } from './checkFile.ts';

const BUCKET = 'documents';

export type PortalFile = {
  id: number;
  fileName: string;
  storagePath: string;
  year: string;
  month: string;
  uploadedAt: string;
  kind: DocKind;
  summary: string;
  /** From year/month if given at upload, else read from the name. */
  suggested: string | null;
  /** The verdict recorded when the file was saved, if it was gated. */
  verdict: Verdict | null;
  problems: string[];
  warnings: string[];
  /** The file's own control figures, as they were at the time of saving. */
  facts: Record<string, string>;
};

/** The folder, made the first time it is wanted. */
export async function btmsFolderId(clientId: number): Promise<number> {
  const { data, error } = await supabase.rpc('btms_data_folder', { p_client: clientId });
  if (error) throw new Error(`BTMS folder: ${error.message}`);
  return Number(data);
}

/** A safe storage segment, matching what the portal does elsewhere. */
const safe = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(0, 120);

/**
 * Store a file in the client's BTMS folder — but only if it passed the gate.
 *
 * The check is not repeated here. It was run on the file the operator was
 * looking at, and its verdict is what they acted on; re-running it silently
 * could store something different from what they approved. What IS enforced
 * here is that a blocked file never reaches storage, whatever the caller
 * intended, because this function is the only way in.
 */
export async function uploadToBtmsFolder(
  clientId: number,
  file: File,
  when: { year: string; month: string },
  check: FileCheck,
  /**
   * Keep the earlier file of the same feed and period standing beside this one.
   *
   * The default is to supersede, because a journal listing is re-saved at the
   * end of every posting session and a folder that kept every copy would be
   * mostly copies. But a person told plainly that July is already loaded may
   * answer “Keep both” — two exports of the same month are sometimes two
   * different things, and that is their call to make, not this function’s.
   */
  keepPrior = false,
): Promise<{ documentId: number; storagePath: string; superseded: number }> {
  if (check.verdict === 'blocked') {
    throw new Error(
      'This file was not stored. ' + (check.problems[0] ?? 'It did not pass its checks.'),
    );
  }

  const folderId = await btmsFolderId(clientId);
  // The client id leads the path, as everywhere else, so a file cannot be
  // written into another client's space.
  const path = `${clientId}/btms/${Date.now()}_${safe(file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file);
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

  // The period the file states about itself beats the one typed beside it: a
  // paysheet knows its own month, and a person retyping it can be wrong.
  const period = check.period ?? periodFrom(when);

  const { data: me } = await supabase.auth.getUser();
  const ins = await supabase.from('documents').insert({
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
  }).select('id').single();
  if (ins.error) throw new Error(`The file was stored but not recorded: ${ins.error.message}`);
  const documentId = Number((ins.data as { id: number }).id);

  // What the gate found, kept against the document. If this fails the file is
  // still there and still usable — the review loses a row, which is worth
  // saying but not worth throwing the upload away over.
  const rec = await supabase.schema('reporting').from('btms_file_checks').insert({
    document_id: documentId,
    client_id: clientId,
    kind: check.kind,
    period,
    verdict: check.verdict,
    problems: check.problems,
    warnings: check.warnings,
    facts: Object.fromEntries(check.facts.map((f) => [f.label, f.value])),
    digest: check.digest,
  });
  if (rec.error) console.warn('The check was not recorded:', rec.error.message);

  const superseded = keepPrior ? 0 : await supersede(clientId, documentId, check.kind, period);
  return { documentId, storagePath: path, superseded };
}

/**
 * Where a file already in the client's folder is.
 *
 * An importer records this rather than storing anything itself: there is one
 * copy of a BTMS export, in the client's folder, and an import points at it.
 * The second copy the importers used to make -- in a bucket of their own -- is
 * what let a file exist for the reporting application that nobody could find
 * from the client.
 */
export type ImportSource = { storagePath: string; documentId: number | null };

export const sourceOf = (f: { id: number; storagePath: string }): ImportSource =>
  ({ storagePath: f.storagePath, documentId: f.id });

/**
 * Check a file and put it in the client's folder: the only way a BTMS file is
 * stored anywhere.
 *
 * Every route that used to upload for itself comes through here, so a file
 * loaded from any screen lands in the same place, under the same gate, with the
 * same record of what the gate found. A blocked file does not reach storage --
 * uploadToBtmsFolder refuses it -- and the caller gets the reason.
 */
export async function storeInBtmsFolder(
  clientId: number,
  file: File,
  when: { year: string; month: string },
  declared?: DocKind,
  keepPrior = false,
): Promise<ImportSource & { superseded: number; check: FileCheck }> {
  const check = await checkBtmsFile(file, declared);
  const r = await uploadToBtmsFolder(clientId, file, when, check, keepPrior);
  return {
    storagePath: r.storagePath,
    documentId: r.documentId,
    superseded: r.superseded,
    check,
  };
}

/**
 * The year and month a document is filed under, from whatever period the caller
 * knows: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. documents.year and documents.month
 * are how a person finds the file again in the portal, so a file with a period
 * gets filed under it rather than under nothing.
 */
export const filedUnder = (period: string | null | undefined) => ({
  year: period ? period.slice(0, 4) : '',
  month: period && period.length >= 7 ? period.slice(5, 7) : '',
});

const periodFrom = (w: { year: string; month: string }) =>
  w.year && w.month ? `${w.year}-${String(w.month).padStart(2, '0')}` : w.year || null;

/**
 * A feed replaces the previous file of the same kind and period rather than
 * sitting beside it. The journal listing is re-saved at the end of every
 * posting session, and a folder that kept every copy would be mostly copies.
 *
 * Evidence is never superseded. Two bank statements for the same month are two
 * statements, and deciding otherwise would quietly throw one away.
 */
async function supersede(
  clientId: number, keepId: number, kind: DocKind, period: string | null,
): Promise<number> {
  if (!FEEDS.includes(kind)) return 0;

  const prior = await supabase.schema('reporting').from('btms_file_checks')
    .select('document_id, period')
    .eq('client_id', clientId).eq('kind', kind).neq('document_id', keepId);
  if (prior.error || !prior.data?.length) return 0;

  const rows = prior.data as { document_id: number; period: string | null }[];
  const ids = rows.filter((r) => covers(period, r.period)).map((r) => r.document_id);
  if (!ids.length) return 0;
  // Count what was actually replaced, not what was considered. A file already
  // superseded by an earlier save is skipped by the filter, and reporting it
  // again would tell the operator something untrue about their own folder.
  const { data, error } = await supabase.from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ids).is('deleted_at', null)
    .select('id');
  if (error) { console.warn('The previous copy was not superseded:', error.message); return 0; }
  return (data ?? []).length;
}

/**
 * Does the period just saved cover the one already there?
 *
 * The journal listing is why this is not a string comparison. It is re-saved at
 * the end of every posting session and its span grows as the year does: a
 * listing covering January to August replaces the one covering January to July,
 * because it contains it. It must NOT touch last year's, which it does not.
 *
 * Everything else states a single period — a trial balance at a date, a
 * paysheet for a month, a chart with no period at all — and matches exactly.
 */
function covers(saved: string | null, existing: string | null): boolean {
  if (saved === existing) return true;
  const a = span(saved), b = span(existing);
  if (!a || !b) return false;
  return a.from <= b.from && a.to >= b.to;
}

/** 'YYYY-MM', 'YYYY-MM-DD' or 'YYYY-MM to YYYY-MM' as a pair of months. */
function span(period: string | null): { from: string; to: string } | null {
  if (!period) return null;
  const parts = period.split(/\s+to\s+/).map((p) => p.trim().slice(0, 7));
  const ok = parts.every((p) => /^\d{4}-\d{2}$/.test(p));
  if (!ok || !parts.length) return null;
  return { from: parts[0], to: parts[parts.length - 1] };
}

/** Fetch one back, as a File the importers can take. */
export async function fileFromPortal(f: PortalFile): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET).download(f.storagePath);
  if (error || !data) throw new Error(`Could not read ${f.fileName}: ${error?.message}`);
  return new File([data], f.fileName, { type: 'application/vnd.ms-excel' });
}

/**
 * What is in the folder.
 *
 * The kind and the verdict come from what the gate recorded when the file was
 * saved, not from opening it again. That is deliberate on two counts: it is one
 * query rather than a download per file, and a review should show what was
 * found AT THE TIME, not what today's code makes of the same bytes.
 *
 * Files saved before the gate existed have no record, so those — and only
 * those — are opened and identified the old way.
 *
 * Superseded files are left out. They are still in the folder and still in the
 * review; they are simply not offered for import, because a replaced journal
 * listing is not a thing anybody wants to import by accident.
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
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading the folder: ${error.message}`);

  const rows = (data ?? []) as {
    id: number; file_name: string; storage_path: string;
    year: string | null; month: string | null; created_at: string;
  }[];
  if (!rows.length) return [];

  type CheckRow = {
    document_id: number;
    kind: DocKind;
    period: string | null;
    verdict: Verdict;
    problems: string[] | null;
    warnings: string[] | null;
    facts: Record<string, string> | null;
  };
  const checks = await supabase.schema('reporting').from('btms_file_checks')
    .select('document_id, kind, period, verdict, problems, warnings, facts')
    .in('document_id', rows.map((r) => r.id));
  // A failure here costs speed, not correctness: every file falls back to being
  // opened, which is what this used to do for all of them.
  if (checks.error) console.warn('Recorded checks unavailable:', checks.error.message);

  const byDoc = new Map<number, CheckRow>();
  for (const k of (checks.data ?? []) as CheckRow[]) byDoc.set(Number(k.document_id), k);

  const out: PortalFile[] = [];
  let done = 0;
  for (const r of rows) {
    const stated = r.year && r.month ? `${r.year}-${String(r.month).padStart(2, '0')}`
      : r.year ? String(r.year) : null;
    const base: PortalFile = {
      id: r.id,
      fileName: r.file_name,
      storagePath: r.storage_path,
      year: r.year ?? '',
      month: r.month ?? '',
      uploadedAt: r.created_at,
      kind: 'unknown',
      summary: '',
      suggested: stated ?? suggestedDate(r.file_name),
      verdict: null,
      problems: [],
      warnings: [],
      facts: {},
    };

    const k = byDoc.get(r.id);
    if (k) {
      onProgress(r.file_name, ++done, rows.length);
      out.push({
        ...base,
        kind: k.kind,
        summary: KIND_SUMMARY[k.kind] ?? '',
        suggested: k.period ?? base.suggested,
        verdict: k.verdict,
        problems: k.problems ?? [],
        warnings: k.warnings ?? [],
        facts: k.facts ?? {},
      });
      continue;
    }

    // Saved before the gate. Open it, as we used to.
    onProgress(r.file_name, ++done, rows.length);
    try {
      const blob = await supabase.storage.from(BUCKET).download(r.storage_path);
      if (blob.error || !blob.data) throw new Error(blob.error?.message ?? 'not readable');
      const sheet = await readSheetRows(blob.data);
      const { kind, summary } = identify(sheet as unknown[][]);
      out.push({ ...base, kind, summary });
    } catch (e) {
      out.push({ ...base, summary: e instanceof Error ? e.message : 'could not be read' });
    }
  }
  return out;
}

/** One line per kind, so a listed file reads the same as a checked one. */
const KIND_SUMMARY: Record<string, string> = {
  ledger: 'Analytical journal listing — postings by journal',
  chart: 'Chart of accounts — the account list',
  trial_balance: 'Trial balance — a position at a date',
  stock: 'Stock valuation — items, quantities and values',
  payroll_cost: 'Payroll cost analysis — by department',
  payroll_sheet: 'Paysheet listing — by employee',
  vat_summary: 'VAT figures summary — a filed period',
  detailed_ledger: 'Detailed ledger — kept for the review',
  bank_statement: 'Bank statement — kept for the review',
  other: 'Kept with the client for the review',
  unknown: 'Not recognised as a BTMS export',
};

/** The folder as a reviewer reads it: every file, superseded ones included. */
export type ReviewRow = {
  documentId: number;
  fileName: string;
  kind: DocKind;
  period: string | null;
  verdict: Verdict;
  problems: string[];
  warnings: string[];
  facts: Record<string, string>;
  uploadedAt: string;
  uploadedBy: string | null;
  superseded: boolean;
};

export async function folderReview(clientId: number): Promise<ReviewRow[]> {
  const { data, error } = await supabase.schema('reporting')
    .rpc('btms_folder_review', { p_client: clientId });
  if (error) throw new Error(`Reading the folder review: ${error.message}`);

  type Raw = {
    document_id: number; file_name: string; kind: string | null; period: string | null;
    verdict: string | null; problems: string[] | null; warnings: string[] | null;
    facts: Record<string, string> | null; uploaded_at: string; uploaded_by: string | null;
    superseded: boolean;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    documentId: Number(r.document_id),
    fileName: r.file_name,
    kind: (r.kind ?? 'unknown') as DocKind,
    period: r.period,
    verdict: (r.verdict ?? 'warning') as Verdict,
    problems: r.problems ?? [],
    warnings: r.warnings ?? [],
    facts: r.facts ?? {},
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
    superseded: Boolean(r.superseded),
  }));
}
