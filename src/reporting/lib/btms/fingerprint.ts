// Which client does this file belong to?
//
// BUILD.md §7.2: the ledger, trial balance, stock valuation and chart of
// accounts carry no client name anywhere in the file. The only thing that
// identifies them is the chart of accounts they are posted against, so a file
// is matched by comparing its account codes with the client's own chart — and
// refused if the overlap is too thin.
//
// This is the last line of defence behind "never mix up client data": the
// client is already fixed at sign-in and a file can only land against that
// client, so a mismatch here means the wrong file was picked, and the honest
// answer is to refuse it rather than to post one client's ledger into another.
//
// ---------------------------------------------------------------------------
// Debtors and creditors are not evidence of anything
//
// A first version of this counted every distinct account code, and refused
// A&F's own 2021, 2024 and 2025 ledgers at 22%, 29% and 30%. The reason is
// that 94% of the codes in a BTMS journal listing are the SUB-LEDGER: one
// account per customer and per supplier. A&F traded with 1.086 customers in
// 2025 who had not appeared by August 2026. Counting those measures customer
// churn, not identity — and refusing a client's own history is not a safe
// failure, it is the refusal people learn to click past.
//
// So the sub-ledger is set aside before the comparison. What identifies a
// chart of accounts is its NOMINAL accounts, which barely move: sales,
// purchases, wages, the bank. The sub-ledger accounts are still returned, and
// the import adds the new ones to the chart, which is the behaviour asked for
// — the client's chart grows as it trades.
//
// A sub-ledger family is found in the data rather than assumed from a numbering
// scheme, so this holds for a client whose chart is numbered differently: a
// group of codes sharing a leading control, all longer than a nominal code, and
// too numerous to be anything but detail.
//
// In practice the test remains decisive rather than marginal: two real clients
// of this firm share zero codes out of 3.109 and 154, so a foreign file scores
// zero on the nominal accounts too.

/** Codes shorter than this are the chart proper, never sub-ledger detail. */
const NOMINAL_MAX_LEN = 4;
/** Below this many members, a group of long codes is not a sub-ledger family. */
const FAMILY_MIN = 10;
/** How many leading characters make up the control a sub-account rolls up to. */
const CONTROL_LEN = 3;

export type Fingerprint = {
  /** Share of the file's NOMINAL codes the client already holds, 0 to 1. */
  overlap: number;
  matched: number;
  /** Nominal codes in the file — the denominator of `overlap`. */
  total: number;
  /** Sub-ledger codes in the file, set aside rather than counted. */
  subLedger: number;
  /** Of those, the ones the client does not hold yet: new customers/suppliers. */
  newSubLedger: number;
  /** Nominal codes the client has never had — shown when refusing. */
  unknownSample: string[];
  accepted: boolean;
  reason: string;
};

/**
 * The control codes whose sub-accounts are debtor/creditor detail, found from
 * the codes themselves: many members, all longer than a nominal account.
 * Exported because the import uses it to record what each sub-account rolls
 * up to.
 */
export function subLedgerControls(...codeSets: Iterable<string>[]): Set<string> {
  const families = new Map<string, string[]>();
  for (const set of codeSets) {
    for (const raw of set) {
      const c = String(raw ?? '').trim();
      if (c.length <= NOMINAL_MAX_LEN) continue;
      const control = c.slice(0, CONTROL_LEN);
      const members = families.get(control);
      if (members) members.push(c); else families.set(control, [c]);
    }
  }
  const controls = new Set<string>();
  for (const [control, members] of families) {
    if (new Set(members).size >= FAMILY_MIN) controls.add(control);
  }
  return controls;
}

/** Does this code belong to one of those families? */
export function isSubLedger(code: string, controls: Set<string>): boolean {
  return code.length > NOMINAL_MAX_LEN && controls.has(code.slice(0, CONTROL_LEN));
}

/**
 * A new client has no chart of accounts yet, so the first import cannot be
 * fingerprinted against anything. That case is allowed through deliberately,
 * and is the ONLY case where it is: `known` being empty is the caller's signal
 * that this is the client's first file, which the import screen states plainly
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

  const empty = {
    overlap: 0, matched: 0, total: 0, subLedger: 0, newSubLedger: 0,
    unknownSample: [] as string[],
  };

  if (codes.size === 0) {
    return { ...empty, accepted: false, reason: 'The file carries no account codes at all.' };
  }

  // Both sides inform which families are detail: the client's chart knows the
  // customers it already has, the file knows the ones it brings.
  const controls = subLedgerControls(codes, known);

  const nominal: string[] = [];
  let subLedger = 0;
  let newSubLedger = 0;
  for (const c of codes) {
    if (isSubLedger(c, controls)) {
      subLedger++;
      if (!known.has(c)) newSubLedger++;
    } else {
      nominal.push(c);
    }
  }

  if (known.size === 0) {
    return {
      ...empty, total: nominal.length, subLedger, newSubLedger, overlap: 1, accepted: true,
      reason: 'First import for this client — there is no chart of accounts to check it against yet.',
    };
  }

  // A file that is nothing but sub-ledger has no nominal accounts to judge it
  // by. Rather than accept it on no evidence, judge it on everything.
  const testing = nominal.length ? nominal : [...codes];

  let matched = 0;
  const unknown: string[] = [];
  for (const c of testing) {
    if (known.has(c)) matched++;
    else if (unknown.length < 12) unknown.push(c);
  }
  const total = testing.length;
  const overlap = matched / total;
  const accepted = overlap >= threshold;

  const detail = subLedger
    ? ` ${subLedger.toLocaleString('en-GB')} debtor and creditor accounts were not counted` +
      (newSubLedger ? `, of which ${newSubLedger.toLocaleString('en-GB')} are new and will be added to the chart.` : '.')
    : '';

  return {
    overlap,
    matched,
    total,
    subLedger,
    newSubLedger,
    unknownSample: unknown,
    accepted,
    reason: accepted
      ? `${matched} of ${total} nominal account codes match this client.${detail}`
      : `Only ${matched} of ${total} nominal account codes match this client ` +
        `(${Math.round(overlap * 100)}%). This file looks like it belongs to someone else.${detail}`,
  };
}
