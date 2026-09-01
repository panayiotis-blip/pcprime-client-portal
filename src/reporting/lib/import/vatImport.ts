// The two VAT feeds.
//
// Both were marked `imported: false` — stored with the client and never read —
// so uploading one answered "there is no importer for this one yet", the row
// stayed OUTSTANDING, and it read as a failure. VAT is the one screen the
// partner asked to calculate and flag variances against the return as filed,
// so that placeholder ends here.
//
// There are three figures for every box, and the point of the screen is that
// they are three:
//
//   rebuilt   what this application computes from the postings (vat_figures)
//   computed  what BTMS computed, from its own VAT figures summary
//   filed     what was actually submitted
//
// They are not expected to agree. On A&F Q2 2026 the rebuild gives box 4 of
// 64.100,43 against BTMS's 64.914,16 — 813,73 apart, with boxes 1 to 3 agreeing
// exactly. That difference is the reason the screen exists and it is shown,
// not reconciled away.

import { supabase } from '../../../lib/supabase';
import { readSheetRows, sha256 } from './sheet.ts';
import { parseVatSummary, boxesFor, type VatSummaryParse, type VatBoxes } from '../btms/vatSummary.ts';
import type { ImportSource } from './portalFolder.ts';

const rep = () => supabase.schema('reporting');

export type Progress = (step: string, done?: number, total?: number) => void;

export type VatPrepared = {
  parse: VatSummaryParse;
  boxes: VatBoxes;
  checksum: string;
  fileName: string;
  /** The quarter, as 'YYYY-MM' of the month it ends in. */
  period: string;
};

export async function prepareVatSummaryImport(
  file: File, period: string, onProgress: Progress = () => {},
): Promise<VatPrepared> {
  onProgress('Reading the file');
  const rows = await readSheetRows(file);
  const parse = parseVatSummary(rows as never);
  const checksum = await sha256(file);
  return {
    parse,
    boxes: boxesFor(parse, period),
    checksum,
    fileName: file.name,
    period,
  };
}

/**
 * BTMS's own computation of the quarter, kept beside ours.
 *
 * vat_periods is keyed on the client and the period, so re-importing a quarter
 * replaces what BTMS said about it rather than accumulating opinions — which is
 * right: a re-export after a correction IS the new answer.
 */
export async function commitVatSummaryImport(
  clientId: number,
  file: File,
  prepared: VatPrepared,
  source: ImportSource,
  onProgress: Progress = () => {},
): Promise<{ period: string; box3: number; box4: number; prior: number }> {
  const { parse, boxes, period } = prepared;
  if (!parse.ok) {
    throw new Error(parse.notes[0]?.message ?? 'This file was refused at the parsing stage.');
  }
  if (!boxes.months.inPeriod.length) {
    throw new Error(
      `No month of ${period} is in this file. It covers ${
        [...parse.output, ...parse.input].map((m) => m.month).filter((v, i, a) => a.indexOf(v) === i).sort().join(', ')
      } — check the quarter it was given.`,
    );
  }

  onProgress('Recording the import');
  const { data: me } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await rep().from('imports').insert({
    client_id: clientId,
    feed: 'vat_summary',
    status: 'staged',
    storage_path: source.storagePath,
    original_filename: file.name,
    checksum: prepared.checksum,
    period_from: `${period}-01`,
    period_to: `${period}-01`,
    row_count: parse.output.length + parse.input.length,
    truncated: false,
    uploaded_by: me.user?.id ?? null,
  }).select('id').single();
  if (impErr || !imp) throw new Error(`The import could not be recorded: ${impErr?.message}`);
  const importId = (imp as { id: number }).id;

  try {
    onProgress('Writing the quarter');
    const { error } = await rep().from('vat_periods').upsert({
      client_id: clientId,
      period,
      date_from: `${boxes.months.inPeriod[0]}-01`,
      date_to: `${period}-01`,
      box1: boxes.box1, box2: boxes.box2, box3: boxes.box3,
      box4: boxes.box4, box5: boxes.box5,
      out_base: boxes.outBase,
      in_base: boxes.inBase,
      // The months this quarter drew on, and the ones swept in from earlier —
      // the difference a person has to be able to see.
      by_code: {
        months: boxes.months.inPeriod,
        prior_months: boxes.months.prior,
        prior_box1: boxes.priorBox1,
        prior_box4: boxes.priorBox4,
      },
      computed_at: new Date().toISOString(),
    }, { onConflict: 'client_id,period' });
    if (error) throw new Error(`The quarter could not be written: ${error.message}`);

    const { error: cErr } = await rep().from('imports')
      .update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: me.user?.id ?? null })
      .eq('id', importId);
    if (cErr) throw new Error(`The import could not be committed: ${cErr.message}`);

    await rep().from('feed_status').upsert({
      client_id: clientId,
      feed: 'vat_summary',
      last_import: importId,
      last_file: file.name,
      uploaded_at: new Date().toISOString(),
      uploaded_by: me.user?.id ?? null,
      covers_to: `${period}-01`,
    }, { onConflict: 'client_id,feed' });

    return {
      period,
      box3: boxes.box3,
      box4: boxes.box4,
      prior: Math.round((boxes.priorBox1 + boxes.priorBox4) * 100) / 100,
    };
  } catch (e) {
    await rep().from('imports')
      .update({ status: 'rejected', notes: e instanceof Error ? e.message : String(e) })
      .eq('id', importId);
    throw e;
  }
}

/**
 * The return as filed.
 *
 * It is the one feed whose figures may not be in the file at all: a filed
 * return is often the PDF the tax office gave back, and there is nothing in it
 * this application can parse. So the boxes are keyed beside it, and the file is
 * the evidence for what was keyed rather than the source of it.
 *
 * Where a BTMS VAT summary is attached instead, its figures are read the same
 * way as the computed one — a person who has that file should not have to type
 * five numbers off it.
 */
export type FiledBoxes = { box1: number; box2: number; box3: number; box4: number; box5: number };

export async function commitVatReturn(
  clientId: number,
  file: File | null,
  period: string,
  boxes: FiledBoxes,
  source: ImportSource | null,
  prior: { box1: number; box4: number; box5: number } = { box1: 0, box4: 0, box5: 0 },
): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await rep().from('vat_returns').upsert({
    client_id: clientId,
    period,
    // Where the figures came from, because a keyed return and a read one are
    // not the same evidence and the screen should not pretend they are.
    source: file ? 'file' : 'keyed',
    file_path: source?.storagePath ?? null,
    box1: boxes.box1, box2: boxes.box2, box3: boxes.box3,
    box4: boxes.box4, box5: boxes.box5,
    prior_box1: prior.box1, prior_box4: prior.box4, prior_box5: prior.box5,
    filed_total: Math.round((boxes.box5 + prior.box5) * 100) / 100,
    attached_by: me.user?.id ?? null,
    attached_at: new Date().toISOString(),
    // The key carries the source, so a quarter can hold a keyed return and a
    // read one at once. Re-keying replaces the keyed one and leaves the file
    // alone, which is what a person correcting a typo means to happen.
  }, { onConflict: 'client_id,period,source' });
  if (error) throw new Error(`The filed return could not be saved: ${error.message}`);
}
