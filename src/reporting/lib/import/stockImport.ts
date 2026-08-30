// The stock valuation import: BUILD.md §6.6 and §7.
//
// A valuation is a position at a date, like a trial balance, and like a trial
// balance the file does not say which date. So the operator states it and it is
// read back before anything is written; the file name is not consulted.
//
// §6.6: the valuation and the stock account in the ledger rarely agree and the
// gap changes sign, and that must be resolved before a gross margin is
// reported. The ledger figure is therefore captured at the same moment, from
// the accounts mapped to the stock line, so the two are always stored together
// and the difference is a fact rather than something to be worked out later.

import { supabase } from '../../../lib/supabase';
import { parseStockValuation, type StockParse } from '../btms/stockValuation.ts';
import { readSheetRows, sha256 } from './sheet.ts';
import { allRows } from './pages.ts';
import type { Progress } from './ledgerImport.ts';

const rep = () => supabase.schema('reporting');

/** The report line stock is carried on. */
const STOCK_LINE = 'B-110';

export type StockPrepared = {
  parse: StockParse;
  checksum: string;
  fileName: string;
  fileSize: number;
  duplicateOf: { id: number; uploaded_at: string; original_filename: string } | null;
};

export type StockCommitted = {
  importId: number;
  valuedAt: string;
  items: number;
  value: number;
  ledgerValue: number;
  difference: number;
};

export async function prepareStockImport(
  clientId: number,
  file: File,
  onProgress: Progress = () => {},
): Promise<StockPrepared> {
  onProgress('Reading the file');
  const rows = await readSheetRows(file);

  onProgress('Parsing');
  const parse = parseStockValuation(rows);

  const checksum = await sha256(file);
  const { data: dup } = await rep().from('imports')
    .select('id, uploaded_at, original_filename')
    .eq('client_id', clientId).eq('checksum', checksum).eq('status', 'committed')
    .order('uploaded_at', { ascending: false }).limit(1);

  return {
    parse,
    checksum,
    fileName: file.name,
    fileSize: file.size,
    duplicateOf: (dup?.[0] as StockPrepared['duplicateOf']) ?? null,
  };
}

/** What the ledger says stock is worth at that date, for the comparison §6.6 asks for. */
export async function stockPerLedger(clientId: number, valuedAt: string): Promise<number> {
  const defaults = await allRows<{ account_code: string; line_id: string | null }>(
    (f, t) => rep().from('mapping_defaults').select('account_code, line_id')
      .eq('client_id', clientId).eq('line_id', STOCK_LINE).range(f, t));
  const overrides = await allRows<{ account_code: string; line_id: string }>(
    (f, t) => rep().from('mappings').select('account_code, line_id')
      .eq('client_id', clientId).range(f, t));

  const codes = new Set(defaults.map((d) => String(d.account_code)));
  // An override can move an account onto the stock line or off it, and both
  // directions matter — reading only the defaults would value stock at what it
  // used to be mapped to.
  for (const o of overrides) {
    if (o.line_id === STOCK_LINE) codes.add(String(o.account_code));
    else codes.delete(String(o.account_code));
  }
  if (!codes.size) return 0;

  const month = valuedAt.slice(0, 7) + '-01';
  const rows = await allRows<{ account_code: string; debit: number; credit: number }>(
    (f, t) => rep().from('balances_monthly')
      .select('account_code, debit, credit')
      .eq('client_id', clientId).lte('period_month', month)
      .in('account_code', [...codes]).range(f, t));

  const net = rows.reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0);
  return Math.round(net * 100) / 100;
}

export async function commitStockImport(
  clientId: number,
  file: File,
  prepared: StockPrepared,
  valuedAt: string,
  onProgress: Progress = () => {},
): Promise<StockCommitted> {
  const { parse, checksum } = prepared;
  if (!parse.ok) throw new Error('This file was refused at the parsing stage; there is nothing to commit.');

  const ext = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'xls';
  const path = `${clientId}/stock/${checksum}.${ext}`;
  onProgress('Storing the file');
  const up = await supabase.storage.from('reporting-imports')
    .upload(path, file, { upsert: true, contentType: file.type || 'application/vnd.ms-excel' });
  if (up.error) throw new Error(`The file could not be stored: ${up.error.message}`);

  onProgress('Comparing with the ledger');
  const ledgerValue = await stockPerLedger(clientId, valuedAt);

  onProgress('Recording the import');
  const { data: me } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await rep().from('imports').insert({
    client_id: clientId,
    feed: 'stock',
    status: 'staged',
    storage_path: path,
    original_filename: file.name,
    checksum,
    period_from: valuedAt,
    period_to: valuedAt,
    row_count: parse.totals.items,
    truncated: false,
    uploaded_by: me.user?.id ?? null,
  }).select('id').single();
  if (impErr || !imp) throw new Error(`The import could not be recorded: ${impErr?.message}`);
  const importId = (imp as { id: number }).id;

  try {
    onProgress('Writing the valuation');
    const { error } = await rep().from('stock_valuations').upsert({
      client_id: clientId,
      valued_at: valuedAt,
      items: parse.totals.items,
      units: parse.totals.units,
      value: parse.totals.value,
      ledger_value: ledgerValue,
      negative_items: parse.negative.items,
      negative_value: parse.negative.value,
      file_path: path,
    }, { onConflict: 'client_id,valued_at' });
    if (error) throw new Error(`The valuation could not be written: ${error.message}`);

    const { error: cErr } = await rep().from('imports')
      .update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: me.user?.id ?? null })
      .eq('id', importId);
    if (cErr) throw new Error(`The import could not be committed: ${cErr.message}`);

    await rep().from('feed_status').upsert({
      client_id: clientId,
      feed: 'stock_valuation',
      last_import: importId,
      last_file: file.name,
      uploaded_at: new Date().toISOString(),
      uploaded_by: me.user?.id ?? null,
      covers_to: valuedAt,
    }, { onConflict: 'client_id,feed' });

    return {
      importId,
      valuedAt,
      items: parse.totals.items,
      value: parse.totals.value,
      ledgerValue,
      difference: Math.round((parse.totals.value - ledgerValue) * 100) / 100,
    };
  } catch (e) {
    await rep().from('imports')
      .update({ status: 'rejected', notes: e instanceof Error ? e.message : String(e) })
      .eq('id', importId);
    throw e;
  }
}
