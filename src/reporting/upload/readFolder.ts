// Reading the new and changed files in one action.
//
// The comparison is `folderDiff.ts`; this is what the button on the Data import
// screen does with it. Nothing is imported without being asked for — a file
// appearing in the folder is not consent to read it. Somebody filed it, and
// somebody decides it goes into the ledger.
//
// The order is not the order the files happen to be in. The chart of accounts
// goes first because it names every other file's accounts and seeds the mapping,
// then the ledger, then the positions that are read against it. Loading a trial
// balance before the ledger it is meant to prove would compare it against
// nothing.

import { listBtmsFolder, fileFromPortal, sourceOf, type PortalFile } from '../lib/import/portalFolder.ts';
import { buildFolderDiff } from '../lib/reports/folderDiff.ts';
import { feedForKind } from './feeds.ts';
import { runImport } from './runImport.ts';

/** Chart first, then the ledger, then what is read against it. */
const ORDER = ['chart', 'ledger', 'trial_balance', 'stock', 'payroll_cost', 'payroll_sheet'];

export type ReadResult = {
  done: { fileName: string; said: string }[];
  failed: { fileName: string; why: string }[];
  skipped: number;
};

export async function readFolder(
  clientId: number,
  step: (s: string) => void = () => {},
): Promise<ReadResult> {
  step('Comparing the folder with what has been read');
  const [diff, files] = await Promise.all([
    buildFolderDiff(clientId),
    listBtmsFolder(clientId),
  ]);

  const byId = new Map<number, PortalFile>(files.map((f) => [f.id, f]));
  const pending = diff.items
    .filter((i) => i.state !== 'loaded')
    .map((i) => ({ item: i, file: byId.get(i.documentId) }))
    .filter((x): x is { item: typeof x.item; file: PortalFile } => !!x.file)
    // A file the gate refused is not read, whatever its state. It was stored
    // before the gate existed, or stored with a warning; either way the reason
    // is on it and a person should look rather than have this decide.
    .filter((x) => x.file.verdict !== 'blocked');

  pending.sort((a, b) => {
    const ra = ORDER.indexOf(a.item.kind), rb = ORDER.indexOf(b.item.kind);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });

  const done: ReadResult['done'] = [];
  const failed: ReadResult['failed'] = [];
  let skipped = 0;
  let payrollRun = false;

  for (const { item, file } of pending) {
    const feed = feedForKind(item.kind, item.period);
    if (!feed || !feed.imported) { skipped++; continue; }

    // Payroll takes both reports at once — each is the other's check — so the
    // first of a pair imports both and the second would only repeat it.
    const isPayroll = item.kind === 'payroll_cost' || item.kind === 'payroll_sheet';
    if (isPayroll && payrollRun) { skipped++; continue; }

    try {
      step(`Reading ${file.fileName}`);
      const f = await fileFromPortal(file);
      const said = await runImport(
        clientId, feed, f, sourceOf(file), item.period,
        (s) => step(`${file.fileName} — ${s}`),
      );
      done.push({ fileName: file.fileName, said });
      if (isPayroll) payrollRun = true;
    } catch (e) {
      // One bad file does not stop the rest. A journal listing that will not
      // parse should not prevent the chart of accounts beside it being read.
      failed.push({ fileName: file.fileName, why: e instanceof Error ? e.message : String(e) });
    }
  }

  return { done, failed, skipped };
}
