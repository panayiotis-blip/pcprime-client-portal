// Which client does this file belong to?
//
// BUILD.md §7.2: the ledger, trial balance, stock valuation and chart of
// accounts carry no client name anywhere in the file. The only thing that
// identifies them is the chart of accounts they are posted against, so a file
// is matched by comparing its account codes with the ones already held for the
// session's client — and refused if the overlap is too thin.
//
// This is the last line of defence behind "never mix up client data": the
// client is already fixed at sign-in and a file can only land against that
// client, so a mismatch here means the wrong file was picked, and the honest
// answer is to refuse it rather than to post one client's ledger into another.
//
// In practice the test is decisive rather than marginal: two real clients of
// this firm share zero codes out of 3.109 and 154.

export type Fingerprint = {
  /** Share of the file's codes that the client already holds, 0 to 1. */
  overlap: number;
  matched: number;
  total: number;
  /** Codes in the file that the client has never had — shown when refusing. */
  unknownSample: string[];
  accepted: boolean;
  reason: string;
};

/**
 * A new client has no chart of accounts yet, so the first import cannot be
 * fingerprinted against anything. That case is allowed through deliberately,
 * and is the ONLY case where it is: `known` being empty is the caller's signal
 * that this is client's first file, which the import screen states plainly
 * before it is committed.
 */
export function fingerprintAccounts(
  fileCodes: Iterable<string>,
  known: Set<string>,
  threshold = 0.6,
): Fingerprint {
  const codes = new Set<string>();
  for (const c of fileCodes) {
    const s = String(c ?? '').trim();
    if (s) codes.add(s);
  }
  const total = codes.size;

  if (total === 0) {
    return { overlap: 0, matched: 0, total: 0, unknownSample: [], accepted: false,
      reason: 'The file carries no account codes at all.' };
  }

  if (known.size === 0) {
    return { overlap: 1, matched: 0, total, unknownSample: [], accepted: true,
      reason: 'First import for this client — there is no chart of accounts to check it against yet.' };
  }

  let matched = 0;
  const unknown: string[] = [];
  for (const c of codes) {
    if (known.has(c)) matched++;
    else if (unknown.length < 12) unknown.push(c);
  }
  const overlap = matched / total;

  return {
    overlap,
    matched,
    total,
    unknownSample: unknown,
    accepted: overlap >= threshold,
    reason:
      overlap >= threshold
        ? `${matched} of ${total} account codes match this client.`
        : `Only ${matched} of ${total} account codes match this client ` +
          `(${Math.round(overlap * 100)}%). This file looks like it belongs to someone else.`,
  };
}
