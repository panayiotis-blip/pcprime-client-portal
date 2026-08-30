// The trial balance import: BUILD.md §6.2 and §7.
//
//   upload -> storage -> parse -> fingerprint -> diff -> commit
//
// Split like every other feed: prepare reads and checks and writes nothing.
//
// Two things make this feed different from the ledger.
//
// The file does not say which period it is. A journal listing carries a date
// on every posting; a trial balance carries none anywhere — "a&f tb 07 2026"
// is a file name, and BUILD.md is emphatic that a file name proves nothing.
// So the period is chosen by the person importing it and stated back to them
// before anything is written. Guessing it from the name is exactly the class
// of mistake that puts one client's figures under another's heading.
//
// A trial balance is also not a replacement in the way a ledger is. It is a
// statement of position at one date, so a commit replaces that period's rows
// and nothing else — and the same month can hold both a control-total version
// and a detailed one, which is why `detailed` is part of the key.

import { supabase } from '../../../lib/supabase';
import { parseTrialBalance } from '../btms/trialBalance.ts';
import type { TrialBalanceParse } from '../btms/types.ts';
import { fingerprintAccounts, type Fingerprint } from '../btms/fingerprint.ts';
import { readSheetRows, sha256 } from './sheet.ts';
import { allRows } from './pages.ts';
import type { Progress } from './ledgerImport.ts';

const rep = () => supabase.schema('reporting');

const CHUNK = 1000;

export type TbPrepared = {
  parse: TrialBalanceParse;
  fingerprint: Fingerprint;
  checksum: string;
  fileName: string;
  fileSize: number;
  duplicateOf: { id: number; uploaded_at: string; original_filename: string } | null;
  /** Sums of the parsed rows, to show beside the file's own Report Total. */
  totals: { debit: number; credit: number; closing: number };
  /** True when the parse agrees with the file's own footer. */
  agreesWithReportTotal: boolean;
};

export type TbCommitted = {
  importId: number;
  rows: number;
  replaced: number;
  periodMonth: string;
  isAnnual: boolean;
  detailed: boolean;
};

export async function prepareTrialBalanceImport(
  clientId: number,
  file: File,
  onProgress: Progress = () => {},
): Promise<TbPrepared> {
  onProgress('Reading the file');
  const rows = await readSheetRows(file);

  onProgress('Parsing');
  const parse = parseTrialBalance(rows);

  onProgress('Checking which client it belongs to');
  const known = new Set<string>();
  const coa = await allRows<{ code: string }>((from, to) =>
    rep().from('coa_accounts').select('code').eq('client_id', clientId).range(from, to));
  for (const r of coa) known.add(String(r.code));
  // A trial balance lists the accounts that carry a balance, so it is judged
  // the ledger's way: are these accounts ones this client has?
  const fingerprint = fingerprintAccounts(parse.rows.map((r) => r.accountCode), known);

  const totals = parse.rows.reduce(
    (a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit, closing: a.closing + r.closing }),
    { debit: 0, credit: 0, closing: 0 },
  );

  // The file states what it should contain. Checking the parse against it is
  // free and catches a short read before it becomes an opening balance.
  const rt = parse.reportTotal;
  const agreesWithReportTotal = !rt
    || (Math.abs(rt.debit - totals.debit) < 0.005
      && Math.abs(rt.credit - totals.credit) < 0.005
      && Math.abs(rt.closing - totals.closing) < 0.005
      && rt.records === parse.rows.length);

  const checksum = await sha256(file);
  const { data: dup } = await rep()
    .from('imports')
    .select('id, uploaded_at, original_filename')
    .eq('client_id', clientId).eq('checksum', checksum).eq('status', 'committed')
    .order('uploaded_at', { ascending: false }).limit(1);

  return {
    parse,
    fingerprint,
    checksum,
    fileName: file.name,
    fileSize: file.size,
    duplicateOf: (dup?.[0] as TbPrepared['duplicateOf']) ?? null,
    totals,
    agreesWithReportTotal,
  };
}

export async function commitTrialBalanceImport(
  clientId: number,
  file: File,
  prepared: TbPrepared,
  period: { periodMonth: string; isAnnual: boolean },
  onProgress: Progress = () => {},
): Promise<TbCommitted> {
  const { parse, checksum } = prepared;

  if (!parse.ok) throw new Error('This file was refused at the parsing stage; there is nothing to commit.');
  if (!prepared.fingerprint.accepted) throw new Error(prepared.fingerprint.reason);
  if (!prepared.agreesWithReportTotal) {
    throw new Error('The parse does not agree with the file\'s own Report Total; it will not be committed.');
  }

  const ext = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'xls';
  const path = `${clientId}/trial-balance/${checksum}.${ext}`;
  onProgress('Storing the file');
  const up = await supabase.storage.from('reporting-imports')
    .upload(path, file, { upsert: true, contentType: file.type || 'application/vnd.ms-excel' });
  if (up.error) throw new Error(`The file could not be stored: ${up.error.message}`);

  onProgress('Recording the import');
  const { data: me } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await rep().from('imports').insert({
    client_id: clientId,
    feed: 'trial_balance',
    status: 'staged',
    storage_path: path,
    original_filename: file.name,
    checksum,
    period_from: period.periodMonth,
    period_to: period.periodMonth,
    months_covered: [period.periodMonth],
    row_count: parse.rows.length,
    total_debit: prepared.totals.debit,
    total_credit: prepared.totals.credit,
    truncated: false,
    uploaded_by: me.user?.id ?? null,
  }).select('id').single();
  if (impErr || !imp) throw new Error(`The import could not be recorded: ${impErr?.message}`);
  const importId = (imp as { id: number }).id;

  try {
    // A trial balance is a position at a date. Committing one replaces that
    // same period, in the same shape, and touches no other period.
    onProgress('Replacing this period');
    const { count: had } = await rep().from('trial_balance')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('period_month', period.periodMonth)
      .eq('is_annual', period.isAnnual)
      .eq('detailed', parse.detailed);
    const { error: delErr } = await rep().from('trial_balance').delete()
      .eq('client_id', clientId)
      .eq('period_month', period.periodMonth)
      .eq('is_annual', period.isAnnual)
      .eq('detailed', parse.detailed);
    if (delErr) throw new Error(`The previous trial balance could not be replaced: ${delErr.message}`);

    onProgress('Writing the balances', 0, parse.rows.length);
    for (let i = 0; i < parse.rows.length; i += CHUNK) {
      const chunk = parse.rows.slice(i, i + CHUNK).map((r) => ({
        client_id: clientId,
        import_id: importId,
        period_month: period.periodMonth,
        is_annual: period.isAnnual,
        detailed: parse.detailed,
        account_code: r.accountCode,
        account_name: r.accountName,
        account_type: r.accountType,
        opening: r.opening,
        debit: r.debit,
        credit: r.credit,
        closing: r.closing,
      }));
      const { error } = await rep().from('trial_balance').insert(chunk);
      if (error) throw new Error(`The balances could not be written: ${error.message}`);
      onProgress('Writing the balances', Math.min(i + CHUNK, parse.rows.length), parse.rows.length);
    }

    const { error: cErr } = await rep().from('imports')
      .update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: me.user?.id ?? null })
      .eq('id', importId);
    if (cErr) throw new Error(`The import could not be committed: ${cErr.message}`);

    await rep().from('feed_status').upsert({
      client_id: clientId,
      feed: period.isAnnual ? 'trial_balance_annual' : 'trial_balance_monthly',
      last_import: importId,
      last_file: file.name,
      uploaded_at: new Date().toISOString(),
      uploaded_by: me.user?.id ?? null,
      covers_to: period.periodMonth,
    }, { onConflict: 'client_id,feed' });

    return {
      importId,
      rows: parse.rows.length,
      replaced: had ?? 0,
      periodMonth: period.periodMonth,
      isAnnual: period.isAnnual,
      detailed: parse.detailed,
    };
  } catch (e) {
    await rep().from('trial_balance').delete().eq('import_id', importId);
    await rep().from('imports')
      .update({ status: 'rejected', notes: e instanceof Error ? e.message : String(e) })
      .eq('id', importId);
    throw e;
  }
}
