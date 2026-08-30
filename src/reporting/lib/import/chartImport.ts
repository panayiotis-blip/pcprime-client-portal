// The chart of accounts import: BUILD.md §6.5 and §7.
//
//   upload -> storage -> parse -> fingerprint -> diff -> commit
//
// Split the same way the ledger is, and for the same reason: nothing about a
// file is taken on trust. `prepareChartImport` reads, checks and works out
// exactly what would change, and writes NOTHING. `commitChartImport` is what
// touches the database.
//
// The difference from the ledger is what a commit means. A ledger import
// REPLACES the months it covers; a chart import never deletes an account.
// Postings reference account codes as text, so an account removed here would
// leave six years of postings pointing at nothing, and BTMS's own chart keeps
// customers long after they stop trading. Accounts absent from the file are
// reported and left alone.

import { supabase } from '../../../lib/supabase';
import { parseChartOfAccounts, type ChartAccount, type ChartParse } from '../btms/chartOfAccounts.ts';
import { fingerprintChart, type Fingerprint } from '../btms/fingerprint.ts';
import { readSheetRows, sha256 } from './sheet.ts';
import { allRows } from './pages.ts';
import type { Progress } from './ledgerImport.ts';

const rep = () => supabase.schema('reporting');

const CHUNK = 1000;

/** What the client already holds, for the diff. */
type Existing = {
  code: string;
  name: string | null;
  account_type: string | null;
  btms_category: string | null;
  is_header: boolean | null;
  control_code: string | null;
};

export type ChartPrepared = {
  parse: ChartParse;
  fingerprint: Fingerprint;
  checksum: string;
  fileName: string;
  fileSize: number;
  duplicateOf: { id: number; uploaded_at: string; original_filename: string } | null;
  /** Accounts in the file the client does not hold yet. */
  added: number;
  /** Accounts whose name, type, category, header flag or control would change. */
  changed: number;
  /** Accounts held that this file does not mention. Never deleted; reported. */
  absent: number;
  /** Held before this file is applied. */
  heldBefore: number;
};

export type ChartCommitted = {
  importId: number;
  written: number;
  added: number;
  changed: number;
  /** Defaults copied from the practice master, migration 203. */
  mapping: { seeded: number; alreadyHad: number; unmapped: number };
};

/** Reads, parses and checks a chart of accounts. Writes nothing. */
export async function prepareChartImport(
  clientId: number,
  file: File,
  onProgress: Progress = () => {},
): Promise<ChartPrepared> {
  onProgress('Reading the file');
  const rows = await readSheetRows(file);

  onProgress('Parsing');
  const parse = parseChartOfAccounts(rows);

  onProgress('Checking which client it belongs to');
  const held = await allRows<Existing>((from, to) =>
    rep().from('coa_accounts')
      .select('code, name, account_type, btms_category, is_header, control_code')
      .eq('client_id', clientId).range(from, to));
  const byCode = new Map(held.map((h) => [String(h.code), h]));

  // Not the ledger's test. A ledger is judged by whether the accounts it posts
  // to are known; a chart is the register itself and contains accounts nobody
  // has ever posted to — 95 of A&F's 204 nominal accounts have never carried a
  // transaction in six years. Judging it the ledger's way refused A&F's own
  // chart at 53% for the crime of being complete. The question here is whether
  // this chart CONTAINS what the client has posted to.
  const fingerprint = fingerprintChart(
    parse.accounts.map((a) => a.code),
    new Set(byCode.keys()),
  );

  onProgress('Working out what would change');
  let added = 0, changed = 0;
  for (const a of parse.accounts) {
    const h = byCode.get(a.code);
    if (!h) { added++; continue; }
    if (
      (h.name ?? '') !== a.name ||
      (h.account_type ?? null) !== a.accountType ||
      (h.btms_category ?? null) !== a.btmsCategory ||
      Boolean(h.is_header) !== a.isHeader ||
      (h.control_code ?? null) !== a.controlCode
    ) changed++;
  }
  const inFile = new Set(parse.accounts.map((a) => a.code));
  const absent = held.filter((h) => !inFile.has(String(h.code))).length;

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
    duplicateOf: (dup?.[0] as ChartPrepared['duplicateOf']) ?? null,
    added,
    changed,
    absent,
    heldBefore: held.length,
  };
}

/** Stores the file, records the import and writes the accounts. */
export async function commitChartImport(
  clientId: number,
  file: File,
  prepared: ChartPrepared,
  onProgress: Progress = () => {},
): Promise<ChartCommitted> {
  const { parse, checksum } = prepared;

  if (!parse.ok) throw new Error('This file was refused at the parsing stage; there is nothing to commit.');
  if (!prepared.fingerprint.accepted) throw new Error(prepared.fingerprint.reason);

  // The client id leads the path because the storage policy reads it from
  // there, so a file cannot be written into another client's folder.
  const ext = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'xls';
  const path = `${clientId}/chart/${checksum}.${ext}`;
  onProgress('Storing the file');
  const up = await supabase.storage.from('reporting-imports')
    .upload(path, file, { upsert: true, contentType: file.type || 'application/vnd.ms-excel' });
  if (up.error) throw new Error(`The file could not be stored: ${up.error.message}`);

  onProgress('Recording the import');
  const { data: me } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await rep().from('imports').insert({
    client_id: clientId,
    feed: 'chart_of_accounts',
    status: 'staged',
    storage_path: path,
    original_filename: file.name,
    checksum,
    row_count: parse.accounts.length,
    truncated: parse.notes.some((n) => n.kind === 'truncated'),
    uploaded_by: me.user?.id ?? null,
  }).select('id').single();
  if (impErr || !imp) throw new Error(`The import could not be recorded: ${impErr?.message}`);
  const importId = (imp as { id: number }).id;

  try {
    onProgress('Writing the accounts', 0, parse.accounts.length);
    for (let i = 0; i < parse.accounts.length; i += CHUNK) {
      const chunk = parse.accounts.slice(i, i + CHUNK).map((a: ChartAccount) => ({
        client_id: clientId,
        code: a.code,
        name: a.name,
        account_type: a.accountType,
        btms_category: a.btmsCategory,
        is_header: a.isHeader,
        control_code: a.controlCode,
        active: a.active,
      }));
      const { error } = await rep().from('coa_accounts')
        .upsert(chunk, { onConflict: 'client_id,code' });
      if (error) throw new Error(`Accounts could not be written: ${error.message}`);
      onProgress('Writing the accounts', Math.min(i + CHUNK, parse.accounts.length), parse.accounts.length);
    }

    const { error: cErr } = await rep().from('imports')
      .update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: me.user?.id ?? null })
      .eq('id', importId);
    if (cErr) throw new Error(`The import could not be committed: ${cErr.message}`);

    // Now the client has a chart, give it the practice master's mapping for
    // every code it recognises. Without this a new client arrives with two
    // hundred accounts mapped to nothing and no profit and loss at all, which
    // is what stood between one client and the rest of them.
    //
    // It never overwrites: an account already decided for this client, drafted
    // or chosen by a person, is left alone. What it cannot recognise stays
    // unmapped and is raised by review check 7 rather than guessed at.
    onProgress('Seeding the mapping');
    const { data: seedData, error: seedErr } = await rep()
      .rpc('seed_mapping_defaults', { p_client: clientId });
    if (seedErr) throw new Error(`The mapping could not be seeded: ${seedErr.message}`);
    const seed = (Array.isArray(seedData) ? seedData[0] : seedData) as
      { seeded: number; already_had: number; unmapped: number } | null;

    // covers_to stays null: a chart of accounts is a statement of what exists,
    // not of a period. The ledger's coverage is derived in the database
    // (migration 194) and has nothing to do with this feed.
    await rep().from('feed_status').upsert({
      client_id: clientId,
      feed: 'chart_of_accounts',
      last_import: importId,
      last_file: file.name,
      uploaded_at: new Date().toISOString(),
      uploaded_by: me.user?.id ?? null,
    }, { onConflict: 'client_id,feed' });

    return {
      importId,
      written: parse.accounts.length,
      added: prepared.added,
      changed: prepared.changed,
      mapping: {
        seeded: Number(seed?.seeded ?? 0),
        alreadyHad: Number(seed?.already_had ?? 0),
        unmapped: Number(seed?.unmapped ?? 0),
      },
    };
  } catch (e) {
    await rep().from('imports')
      .update({ status: 'rejected', notes: e instanceof Error ? e.message : String(e) })
      .eq('id', importId);
    throw e;
  }
}
