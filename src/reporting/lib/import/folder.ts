// A folder per client, linked once.
//
// BTMS exports carry no company code anywhere inside them — not the ledger,
// not the chart, not the trial balance. So the only way a file could name its
// client is for somebody to type a code into the file name, every file, every
// month, and a typo there puts one client's ledger under another's name. That
// is the failure the code existed to prevent, so it cannot be the mechanism.
//
// The folder is a better key. It is chosen once, deliberately, by a person, and
// after that every file inside it is unambiguous without anybody typing
// anything. Chrome's directory picker hands back a handle; the handle is kept
// in IndexedDB against the client id, so "link the folder" survives closing the
// tab. Permission has to be re-granted after a restart, which is the browser
// being careful and is worth the one click.
//
// What a file IS, though, is never taken from its name. It is read: a journal
// listing has `Journal:` rows, a chart of accounts has the offset `Phone`
// header, a trial balance has `Code / Name / Type`, a stock valuation ends with
// `Number of Records / GrandTotals`, a payroll cost analysis has `DEPARTMENT`,
// a paysheet has `Employee :`. The name is used only to SUGGEST a date, and a
// person confirms that.

import { readSheetRows } from './sheet.ts';

const DB = 'pcp-reporting';
const STORE = 'client-folders';

export type FeedKind =
  | 'ledger' | 'chart' | 'trial_balance' | 'trial_balance_wide' | 'stock'
  | 'payroll_cost' | 'payroll_sheet' | 'vat_summary' | 'unknown';

export type FoundFile = {
  name: string;
  size: number;
  handle: FileSystemFileHandle;
  kind: FeedKind;
  /** What the parse saw, for the operator to recognise it by. */
  summary: string;
  /** A date or period read from the NAME, to be confirmed — never trusted. */
  suggested: string | null;
};

export function folderPickingSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

// ---- remembering the folder ------------------------------------------

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(clientId: number, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, String(clientId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function linkedFolder(clientId: number): Promise<FileSystemDirectoryHandle | null> {
  const db = await open();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(String(clientId));
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}

export async function linkFolder(clientId: number): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as {
    showDirectoryPicker: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: 'read' });
  await put(clientId, handle);
  return handle;
}

/** Chrome forgets the grant between sessions; asking again is one click. */
export async function ensureReadable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  if (!h.queryPermission) return true;
  if (await h.queryPermission({ mode: 'read' }) === 'granted') return true;
  if (!h.requestPermission) return false;
  return await h.requestPermission({ mode: 'read' }) === 'granted';
}

// ---- what is this file? ----------------------------------------------

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Decided by reading the file, never by its name. Only the first rows are
 * examined, which is enough: every BTMS export declares itself at the top.
 */
export function identify(rows: unknown[][]): { kind: FeedKind; summary: string } {
  const head = rows.slice(0, 40);
  const first = (r: unknown[]) => cell(r?.[0]);

  if (head.some((r) => first(r).startsWith('Journal:') || first(r).startsWith('Journal No'))) {
    return { kind: 'ledger', summary: 'Analytical journal listing — postings by journal' };
  }
  if (head.some((r) => first(r) === 'Phone' && cell(r?.[1]) === 'Type')) {
    return { kind: 'chart', summary: 'Chart of accounts — the account list' };
  }
  if (head.some((r) => first(r) === 'Code' && cell(r?.[1]) === 'Name' && cell(r?.[2]) === 'Type')) {
    return { kind: 'trial_balance', summary: 'Trial balance — a position at a date' };
  }
  // BTMS prints a second trial balance, "Trial Balance(S)", in a wider layout:
  // opening, movement and closing each split into a debit and a credit column,
  // with a blank leading column. It reads as a trial balance to a person and as
  // nothing at all to the parser above, which is the dangerous combination —
  // hence naming it rather than letting it fall through to "not recognised".
  if (head.some((r) => r.some((c) => cell(c) === 'Opening Balance'))
      && head.some((r) => r.some((c) => cell(c) === 'Closing Balance'))
      && head.some((r) => r.some((c) => cell(c) === 'Movement'))) {
    return {
      kind: 'trial_balance_wide',
      summary: 'Trial balance, wide layout — opening, movement and closing',
    };
  }
  if (head.some((r) => first(r) === 'DEPARTMENT')) {
    return { kind: 'payroll_cost', summary: 'Payroll cost analysis — by department' };
  }
  if (head.some((r) => /^employee\s*:/i.test(first(r)))) {
    return { kind: 'payroll_sheet', summary: 'Paysheet listing — by employee' };
  }
  if (head.some((r) => /vat\s*(period|outputs|inputs)/i.test(first(r)))) {
    return { kind: 'vat_summary', summary: 'VAT figures summary — a filed period' };
  }
  // Stock declares itself at the END, so look there as well.
  const tail = rows.slice(-6);
  if (tail.some((r) => /^number of records/i.test(first(r)) && /grandtotals/i.test(cell(r?.[2])))) {
    return { kind: 'stock', summary: 'Stock valuation — items, quantities and values' };
  }
  return { kind: 'unknown', summary: 'Not recognised as a BTMS export' };
}

/**
 * A date the NAME hints at, for the two feeds that carry none inside them.
 * Offered as a suggestion for a person to confirm; never applied on its own.
 */
export function suggestedDate(name: string): string | null {
  const n = name.toLowerCase();
  const dmy = n.match(/(\d{2})[-.](\d{2})[-.](\d{4})/);           // 31-07-2026
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const my = n.match(/\b(\d{2})[ _-](\d{4})\b/);                  // tb 07 2026
  if (my) return `${my[2]}-${my[1]}`;
  const y = n.match(/\b(20\d{2})\b/);                             // tb 2024
  if (y) return y[1];
  return null;
}

/** Everything in the folder that reads like a BTMS export. */
export async function scanFolder(
  handle: FileSystemDirectoryHandle,
  onProgress: (name: string, done: number) => void = () => {},
): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  let done = 0;
  const dir = handle as unknown as { values: () => AsyncIterable<FileSystemHandle> };
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue;
    if (!/\.xlsx?$/i.test(entry.name)) continue;
    const fh = entry as FileSystemFileHandle;
    const file = await fh.getFile();
    onProgress(entry.name, ++done);
    try {
      const rows = await readSheetRows(file);
      const { kind, summary } = identify(rows as unknown[][]);
      out.push({
        name: entry.name, size: file.size, handle: fh, kind, summary,
        suggested: suggestedDate(entry.name),
      });
    } catch {
      out.push({
        name: entry.name, size: file.size, handle: fh, kind: 'unknown',
        summary: 'Could not be read as a spreadsheet', suggested: null,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
