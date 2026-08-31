// The built report, kept until the client's data changes.
//
// Building A&F's report reads 174.026 postings and rebuilds every statement
// from them. That was being paid on every sign-in — in truth on every TAB,
// because the result was held in a module variable that dies with the page.
// Reloading paid it again; a second tab paid it again; for data that had not
// changed by a row.
//
// Pete put it plainly: the first load is understandable, and so is a delay
// after uploading something. Repeating it for unchanged data is not.
//
// So the built block is kept in IndexedDB against the stamp from
// reporting.client_data_version (migration 210). On sign-in the stamp is
// fetched — 13ms — and if it matches what the stored copy was built from, that
// copy is used and nothing is read or rebuilt. Import anything and the stamp
// moves, the copy is ignored, and the rebuild happens once.
//
// IndexedDB rather than localStorage because these are megabytes, and
// localStorage is a synchronous string store with a quota measured in single
// figures. Failures here are never fatal: a cache that cannot be read or
// written costs the rebuild it was meant to save, which is exactly where we
// were before it existed.

const DB = 'pcp-reporting';
const STORE = 'client-blocks';
/** Bumped when the stored shape changes, so old entries are ignored. */
const SHAPE = 2;

export type CachedBlock = {
  clientId: number;
  /** The stamp the block was built from. */
  version: string;
  shape: number;
  builtAt: string;
  block: unknown;
};

/**
 * The database is shared with the folder handles (import/folder.ts), which
 * created it at version 1 with its own store. Opening at a higher version adds
 * this store without disturbing that one.
 */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      // Leave any other store alone — folder.ts owns 'client-folders'.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('the reporting store is open in another tab'));
  });
}

export async function readCachedBlock(clientId: number, version: string): Promise<unknown | null> {
  try {
    const db = await open();
    const hit = await new Promise<CachedBlock | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(String(clientId));
      req.onsuccess = () => resolve((req.result as CachedBlock) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!hit || hit.shape !== SHAPE) return null;
    // The stamp is the whole point: a stored block whose data has moved is
    // worse than no stored block, because it is wrong rather than merely slow.
    if (hit.version !== version) return null;
    return hit.block ?? null;
  } catch {
    return null;
  }
}

export async function writeCachedBlock(
  clientId: number, version: string, block: unknown,
): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const entry: CachedBlock = {
        clientId, version, shape: SHAPE, builtAt: new Date().toISOString(), block,
      };
      tx.objectStore(STORE).put(entry, String(clientId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    // Quota, private browsing, a locked database — all survivable. The report
    // is already built and about to be shown; it just will not be kept.
    console.warn('The built report was not kept for next time:', e);
  }
}

/** Forget one client's stored report, or all of them. */
export async function forgetCachedBlock(clientId?: number): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      if (clientId === undefined) s.clear(); else s.delete(String(clientId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* nothing kept is the same as nothing to forget */ }
}
