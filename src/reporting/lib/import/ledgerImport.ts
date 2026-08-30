// The ledger import pipeline: BUILD.md §7.
//
//   upload -> storage -> parse -> fingerprint -> stage -> commit -> checks
//
// Split in two on purpose. `prepareLedgerImport` reads and checks the file and
// writes NOTHING; `commitLedgerImport` is what touches the database. A person
// sees what a file will do — how many postings, which months, whether it looks
// like this client's at all, what it would replace — and then decides. The one
// import that destroyed a ledger did so because a file went straight in.

import { supabase } from '../../../lib/supabase';
import { parseJournalListing } from '../btms/journalListing.ts';
import { toLedgerParse } from '../btms/toLedgerParse.ts';
import { fingerprintAccounts, type Fingerprint } from '../btms/fingerprint.ts';
import type { LedgerParse } from '../btms/types.ts';
import { readSheetRows, sha256 } from './sheet.ts';

const rep = () => supabase.schema('reporting');

const STAGE_CHUNK = 1000;
const PAGE = 1000;

/**
 * Every row, not just the first page.
 *
 * PostgREST answers a select with one page and says nothing about the rest.
 * Read as a chart of accounts, that silently drops 206 of A&F's 1.206 accounts
 * — which is how the client's own 2025 ledger came to be refused at 20 of 78
 * nominal codes when 59 of them were in the chart the whole time.
 *
 * A short register makes the fingerprint read as a mismatch, and that is the
 * one direction this check must never fail in quietly: it refuses the right
 * file, and teaches people to click past a refusal that is usually wrong.
 */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export type Prepared = {
  parse: LedgerParse;
  fingerprint: Fingerprint;
  checksum: string;
  fileName: string;
  fileSize: number;
  /** A committed import of this exact file, if there is one. */
  duplicateOf: { id: number; uploaded_at: string; original_filename: string } | null;
  /** Postings already held for the months this file covers — what a commit replaces. */
  wouldReplace: number;
  /** True when the file carries fewer postings than the months it replaces. */
  wouldLose: boolean;
};

export type Committed = {
  importId: number;
  monthsReplaced: number;
  postingsRemoved: number;
  postingsAdded: number;
};

export type Progress = (step: string, done?: number, total?: number) => void;

/** Reads, parses and checks a file. Writes nothing. */
export async function prepareLedgerImport(
  clientId: number,
  file: File,
  onProgress: Progress = () => {},
): Promise<Prepared> {
  onProgress('Reading the file');
  const rows = await readSheetRows(file);

  onProgress('Parsing');
  const parse = toLedgerParse(parseJournalListing(rows));

  onProgress('Checking which client it belongs to');
  // The chart of accounts is the register to match against; before it exists,
  // the accounts already carried by this client's postings do the same job.
  const known = new Set<string>();
  const coa = await allRows<{ code: string }>((from, to) =>
    rep().from('coa_accounts').select('code').eq('client_id', clientId).range(from, to));
  for (const r of coa) known.add(String(r.code));
  if (known.size === 0) {
    const seen = await allRows<{ account_code: string }>((from, to) =>
      rep().from('balances_monthly').select('account_code').eq('client_id', clientId).range(from, to));
    for (const r of seen) known.add(String(r.account_code));
  }
  const fingerprint = fingerprintAccounts(parse.accounts.map((a) => a.code), known);

  onProgress('Fingerprinting the file');
  const checksum = await sha256(file);

  // The same file twice is nearly always a mistake, and it is cheap to say so.
  const { data: dup } = await rep()
    .from('imports')
    .select('id, uploaded_at, original_filename')
    .eq('client_id', clientId).eq('checksum', checksum).eq('status', 'committed')
    .order('uploaded_at', { ascending: false }).limit(1);

  // What a commit would replace: postings already held for these months.
  let wouldReplace = 0;
  if (parse.monthsCovered.length) {
    const { count } = await rep()
      .from('postings')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('period_month', parse.monthsCovered);
    wouldReplace = count ?? 0;
  }

  return {
    parse,
    fingerprint,
    checksum,
    fileName: file.name,
    fileSize: file.size,
    duplicateOf: (dup?.[0] as Prepared['duplicateOf']) ?? null,
    wouldReplace,
    wouldLose: parse.postings.length < wouldReplace,
  };
}

/**
 * Stores the file, stages the postings and commits them.
 *
 * `allowLoss` is passed straight to commit_ledger_import, which refuses a
 * commit carrying fewer postings than the months it replaces unless it is set.
 * That guard exists because a real import once replaced a whole ledger with
 * one month: BTMS paginates, and an export captured page one alone.
 */
export async function commitLedgerImport(
  clientId: number,
  file: File,
  prepared: Prepared,
  opts: { allowLoss?: boolean } = {},
  onProgress: Progress = () => {},
): Promise<Committed> {
  const { parse, checksum } = prepared;

  if (!parse.ok) throw new Error('This file was refused at the parsing stage; there is nothing to commit.');
  if (!prepared.fingerprint.accepted) throw new Error(prepared.fingerprint.reason);

  // ---- the evidence copy -------------------------------------------
  // The client id leads the path because the storage policy reads it from
  // there, so a file cannot be written into another client's folder.
  const ext = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'xls';
  const path = `${clientId}/ledger/${checksum}.${ext}`;
  onProgress('Storing the file');
  const up = await supabase.storage.from('reporting-imports')
    .upload(path, file, { upsert: true, contentType: file.type || 'application/vnd.ms-excel' });
  if (up.error) throw new Error(`The file could not be stored: ${up.error.message}`);

  // ---- the import record -------------------------------------------
  onProgress('Recording the import');
  const { data: me } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await rep().from('imports').insert({
    client_id: clientId,
    feed: 'ledger',
    status: 'staged',
    storage_path: path,
    original_filename: file.name,
    checksum,
    period_from: parse.monthsCovered[0] ?? null,
    period_to: parse.monthsCovered.at(-1) ?? null,
    months_covered: parse.monthsCovered,
    row_count: parse.postings.length,
    total_debit: parse.totals.debit,
    total_credit: parse.totals.credit,
    truncated: parse.notes.some((n) => n.kind === 'truncated'),
    uploaded_by: me.user?.id ?? null,
  }).select('id').single();
  if (impErr || !imp) throw new Error(`The import could not be recorded: ${impErr?.message}`);
  const importId = (imp as { id: number }).id;

  try {
    // ---- the chart of accounts the file declares --------------------
    // Upserted before the postings so that the NEXT file for this client has
    // something to be fingerprinted against. Code and name only: the journal
    // listing has no account sections, so it knows neither the alt code nor
    // the account type, and writing the nulls it would imply would blank what
    // the chart of accounts import (P2) put there. Nothing is deleted here.
    if (parse.accounts.length) {
      onProgress('Recording the accounts', 0, parse.accounts.length);
      for (let i = 0; i < parse.accounts.length; i += STAGE_CHUNK) {
        const chunk = parse.accounts.slice(i, i + STAGE_CHUNK).map((a) => ({
          client_id: clientId,
          code: a.code,
          name: a.name,
        }));
        const { error } = await rep().from('coa_accounts')
          .upsert(chunk, { onConflict: 'client_id,code' });
        if (error) throw new Error(`Accounts could not be recorded: ${error.message}`);
        onProgress('Recording the accounts', Math.min(i + STAGE_CHUNK, parse.accounts.length), parse.accounts.length);
      }
    }

    // ---- stage -------------------------------------------------------
    onProgress('Staging the postings', 0, parse.postings.length);
    for (let i = 0; i < parse.postings.length; i += STAGE_CHUNK) {
      const chunk = parse.postings.slice(i, i + STAGE_CHUNK).map((p) => ({
        client_id: clientId,
        import_id: importId,
        posted_on: p.postedOn,
        period_month: p.periodMonth,
        account_code: p.accountCode,
        account_name: p.accountName,
        reference: p.reference,
        details: p.details,
        debit: p.debit,
        credit: p.credit,
        vat_code: p.vatCode,
        vat_rate: p.vatRate,
        vat_amount: p.vatAmount,
        journal_code: p.journalCode,
        journal_no: p.journalNo,
        batch_no: p.batchNo,
        source_origin: p.sourceOrigin,
      }));
      const { error } = await rep().from('postings_staging').insert(chunk);
      if (error) throw new Error(`Staging failed at row ${i + 1}: ${error.message}`);
      onProgress('Staging the postings', Math.min(i + STAGE_CHUNK, parse.postings.length), parse.postings.length);
    }

    // Only a validated import may be committed, which is what makes the guard
    // in commit_ledger_import reachable rather than decorative.
    const { error: vErr } = await rep().from('imports').update({ status: 'validated' }).eq('id', importId);
    if (vErr) throw new Error(`The import could not be validated: ${vErr.message}`);

    // ---- commit ------------------------------------------------------
    onProgress('Committing');
    const { data: res, error: cErr } = await rep().rpc('commit_ledger_import', {
      p_import: importId,
      p_allow_loss: opts.allowLoss ?? false,
    });
    if (cErr) throw new Error(cErr.message);
    const row = (Array.isArray(res) ? res[0] : res) as
      { months_replaced: number; postings_removed: number; postings_added: number } | null;

    // feed_status is written by commit_ledger_import itself (migration 194),
    // in the same transaction as the postings. It used to be written here,
    // from the file just parsed — which answers "what did this file cover"
    // rather than "how far does the ledger reach", and the two part company
    // the moment files arrive out of order. Loading A&F's 2025 ledger after
    // its 2026 one left the screen reading "covers to Dec 2025" against a
    // ledger that ran to Aug 2026.

    return {
      importId,
      monthsReplaced: row?.months_replaced ?? 0,
      postingsRemoved: row?.postings_removed ?? 0,
      postingsAdded: row?.postings_added ?? 0,
    };
  } catch (e) {
    // A staged import that never committed is litter, and worse, it holds
    // postings that look like the client's. Clear it and mark the attempt.
    await rep().from('postings_staging').delete().eq('import_id', importId);
    await rep().from('imports')
      .update({ status: 'rejected', notes: e instanceof Error ? e.message : String(e) })
      .eq('id', importId);
    throw e;
  }
}
