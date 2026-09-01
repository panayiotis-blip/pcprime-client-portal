// What is in the client's folder that the report has not read.
//
// The partner asked for this in his own words: the reporting app "looks in that
// folder for changes or updates". The folder is the record of what was received;
// the ledger is what has been read. This is the difference between the two, and
// it is the thing that makes the folder the way in rather than merely the place
// files end up.
//
// The comparison is by sha256, because that is the only thing that answers the
// question honestly. A file's name can change, its period can be retyped, and it
// can be re-exported after a correction with everything about it the same except
// the bytes. Only the digest says whether THIS file has been read.
//
//   loaded    its digest is the checksum of a committed import
//   changed   no digest match, but this feed and period HAVE been imported --
//             so the folder holds a newer export of something already read
//   new       neither: nothing of this feed and period has been imported
//
// Evidence — bank statements, VAT returns, supporting documents — is not in the
// comparison at all. There is no importer for it and never will be; it is kept
// with the client for the review, and calling it "new" for ever would be a
// count that never goes down.

import { allRows } from '../import/pages.ts';
import { supabase } from '../../../lib/supabase';
import { listBtmsFolder, type PortalFile } from '../import/portalFolder.ts';
import { FEEDS as GATE_FEEDS, type DocKind } from '../import/checkFile.ts';

const rep = () => supabase.schema('reporting');

export type FolderState = 'new' | 'changed' | 'loaded';

export type FolderItem = {
  documentId: number;
  fileName: string;
  kind: DocKind;
  /** As the gate recorded it: 'YYYY', 'YYYY-MM', a date, or a range. */
  period: string | null;
  state: FolderState;
};

export type FolderDiff = {
  items: FolderItem[];
  fresh: number;
  changed: number;
  loaded: number;
  /** Kept for the review and not read. Counted, never offered for import. */
  evidence: number;
};

/** reporting.imports.feed → the gate's name for the same thing. */
const KIND_OF_FEED: Record<string, DocKind> = {
  ledger: 'ledger',
  chart_of_accounts: 'chart',
  trial_balance: 'trial_balance',
  stock: 'stock',
  payroll_calc: 'payroll_cost',
};

type ImportRow = {
  feed: string; checksum: string | null;
  period_from: string | null; period_to: string | null; months_covered: string[] | null;
};

/** The period an import covers, in the same words the gate uses for a file. */
function importPeriod(r: ImportRow): string | null {
  const months = r.months_covered ?? [];
  if (months.length > 1) return `${months[0]} to ${months[months.length - 1]}`;
  if (months.length === 1) return months[0];
  const one = r.period_to ?? r.period_from;
  return one ? String(one) : null;
}

/**
 * Does what was imported cover the period of the file in the folder?
 *
 * A journal listing covering January to August covers July as well, and a year
 * covers a month inside it, so this is not a string comparison. Everything else
 * states one period and matches it exactly.
 */
function covers(imported: string | null, file: string | null): boolean {
  if (!file) return !imported;
  if (!imported) return false;
  if (imported === file) return true;
  const month = (p: string) => p.trim().slice(0, 7);
  const span = (p: string) => p.split(/\s+to\s+/).map(month);
  if (imported.length === 4) return file.startsWith(imported);      // a year
  const a = span(imported), b = month(file);
  if (!a.every((x) => /^\d{4}-\d{2}$/.test(x)) || !/^\d{4}-\d{2}$/.test(b)) return false;
  return a[0] <= b && a[a.length - 1] >= b;
}

export async function buildFolderDiff(clientId: number): Promise<FolderDiff> {
  const [files, imports] = await Promise.all([
    listBtmsFolder(clientId),
    allRows<ImportRow>((f, t) => rep().from('imports')
      .select('feed, checksum, period_from, period_to, months_covered')
      .eq('client_id', clientId).eq('status', 'committed').range(f, t)),
  ]);

  const readDigests = new Set(imports.map((i) => i.checksum).filter(Boolean) as string[]);
  const readPeriods = new Map<DocKind, string[]>();
  for (const i of imports) {
    const kind = KIND_OF_FEED[i.feed];
    if (!kind) continue;
    const list = readPeriods.get(kind) ?? [];
    list.push(importPeriod(i) ?? '');
    readPeriods.set(kind, list);
  }

  const items: FolderItem[] = [];
  let evidence = 0;

  for (const f of files as PortalFile[]) {
    if (!GATE_FEEDS.includes(f.kind)) { evidence++; continue; }

    // The paysheet is stored beside the cost analysis but the import record
    // carries only the cost analysis's checksum, so a paysheet would read as
    // unread for ever. Both are settled by the period the pair was committed
    // for, which is what payroll is imported by.
    const kind: DocKind = f.kind === 'payroll_sheet' ? 'payroll_cost' : f.kind;
    const period = f.suggested;

    let state: FolderState;
    if (f.digest && readDigests.has(f.digest)) {
      state = 'loaded';
    } else if ((readPeriods.get(kind) ?? []).some((p) => covers(p || null, period))) {
      // Something of this feed and period has been read, and this is not it.
      state = f.kind === 'payroll_sheet' && !f.digest ? 'loaded' : 'changed';
    } else {
      state = 'new';
    }

    items.push({
      documentId: f.id, fileName: f.fileName, kind: f.kind, period, state,
    });
  }

  // New first, then changed, then what is already in: the order a person reads
  // it in is the order they would act on it.
  const rank: Record<FolderState, number> = { new: 0, changed: 1, loaded: 2 };
  items.sort((a, b) => rank[a.state] - rank[b.state] || a.fileName.localeCompare(b.fileName));

  return {
    items,
    fresh: items.filter((i) => i.state === 'new').length,
    changed: items.filter((i) => i.state === 'changed').length,
    loaded: items.filter((i) => i.state === 'loaded').length,
    evidence,
  };
}
