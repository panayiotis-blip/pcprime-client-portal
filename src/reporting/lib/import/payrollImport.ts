// The payroll import: BUILD.md §6.4 and §7.
//
// Two files, imported together, because that is what makes them worth having:
// the cost analysis and the paysheet listing are independent statements of the
// same month, and §6.4 calls them "two reports, each a check on the other".
// Loading one alone throws away the check.
//
// So a commit needs both, and it refuses when they disagree. Where the gross,
// deductions, contributions, net or cost differ between them, one of the two
// files is wrong — and a payroll cost that is wrong reaches the client's
// accounts, their IR.7 and their social insurance return together.
//
// The period comes from the files themselves ('08/2026'), which both state,
// and they must state the same one. Nothing is asked of the operator here that
// the files already know.

import { supabase } from '../../../lib/supabase';
import {
  parseCostAnalysis, parsePaysheet, reconcilePayroll,
  type CostAnalysisParse, type PaysheetParse,
} from '../btms/payroll.ts';
import { readSheetRows, sha256 } from './sheet.ts';
import type { Progress } from './ledgerImport.ts';
import type { ImportSource } from './portalFolder.ts';

const rep = () => supabase.schema('reporting');

export type PayrollPrepared = {
  cost: CostAnalysisParse;
  sheet: PaysheetParse;
  costFile: { name: string; size: number; checksum: string };
  sheetFile: { name: string; size: number; checksum: string };
  /** The two reports against each other, line by line. */
  reconciliation: ReturnType<typeof reconcilePayroll>;
  /** 'YYYY-MM-01' — the month both files claim. */
  periodMonth: string | null;
  periodsAgree: boolean;
};

export type PayrollCommitted = {
  importId: number;
  periodMonth: string;
  departments: number;
  employees: number;
  gross: number;
  cost: number;
};

/** 'MM/YYYY' as the reports write it, to the first of that month. */
function toPeriodMonth(mmyyyy: string): string | null {
  const m = mmyyyy.match(/^(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}-01` : null;
}

export async function preparePayrollImport(
  clientId: number,
  costFile: File,
  sheetFile: File,
  onProgress: Progress = () => {},
): Promise<PayrollPrepared> {
  onProgress('Reading the cost analysis');
  const cost = parseCostAnalysis(await readSheetRows(costFile));

  onProgress('Reading the paysheet');
  const sheet = parsePaysheet(await readSheetRows(sheetFile));

  onProgress('Checking one against the other');
  const reconciliation = reconcilePayroll(cost, sheet);

  const periodsAgree = !!cost.period && cost.period === sheet.period;
  const periodMonth = periodsAgree ? toPeriodMonth(cost.period) : null;

  return {
    cost,
    sheet,
    costFile: { name: costFile.name, size: costFile.size, checksum: await sha256(costFile) },
    sheetFile: { name: sheetFile.name, size: sheetFile.size, checksum: await sha256(sheetFile) },
    reconciliation,
    periodMonth,
    periodsAgree,
  };
}

export async function commitPayrollImport(
  clientId: number,
  costFile: File,
  sheetFile: File,
  p: PayrollPrepared,
  sources: { cost: ImportSource; sheet: ImportSource },
  onProgress: Progress = () => {},
): Promise<PayrollCommitted> {
  if (!p.cost.ok || !p.sheet.ok) {
    throw new Error('One of the two files was refused at the parsing stage.');
  }
  if (!p.periodsAgree || !p.periodMonth) {
    throw new Error(
      `The two files are for different months — the cost analysis says ${p.cost.period || '(none)'} ` +
      `and the paysheet says ${p.sheet.period || '(none)'}.`,
    );
  }
  if (!p.reconciliation.agrees) {
    const bad = p.reconciliation.rows.filter((r) => Math.abs(r.diff) >= 0.005)
      .map((r) => `${r.what} by ${r.diff.toFixed(2)}`).join(', ');
    throw new Error(`The two reports disagree — ${bad}. One of them is wrong; neither is imported.`);
  }

  // ---- the evidence copies -----------------------------------------
  // Both reports are already in the client's BTMS folder; portalFolder.ts put
  // them there and is the only thing that stores a BTMS file. The import
  // record names the cost analysis, as it always has, because that is the file
  // its checksum is taken from -- the paysheet is recorded beside it in the
  // folder rather than in a second bucket of the importer's own.
  const costPath = sources.cost.storagePath;

  onProgress('Recording the import');
  const { data: me } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await rep().from('imports').insert({
    client_id: clientId,
    feed: 'payroll_calc',
    status: 'staged',
    storage_path: costPath,
    original_filename: p.costFile.name,
    checksum: p.costFile.checksum,
    period_from: p.periodMonth,
    period_to: p.periodMonth,
    row_count: p.sheet.employees.length,
    truncated: false,
    uploaded_by: me.user?.id ?? null,
  }).select('id').single();
  if (impErr || !imp) throw new Error(`The import could not be recorded: ${impErr?.message}`);
  const importId = (imp as { id: number }).id;

  try {
    const t = p.cost.totals;
    onProgress('Writing the period');
    const { error: perErr } = await rep().from('payroll_periods').upsert({
      client_id: clientId,
      period: p.periodMonth,
      employees: p.sheet.employees.length,
      gross: t?.gross[0] ?? 0,
      deductions: t?.deductions[0] ?? 0,
      contributions: t?.contributions[0] ?? 0,
      net: t?.net[0] ?? 0,
      cost: t?.cost[0] ?? 0,
      gross_ytd: t?.gross[1] ?? 0,
      cost_ytd: t?.cost[1] ?? 0,
    }, { onConflict: 'client_id,period' });
    if (perErr) throw new Error(`The period could not be written: ${perErr.message}`);

    // A period is replaced whole: departments and employees together, so a
    // re-import cannot leave last month's people beside this month's.
    await rep().from('payroll_lines').delete()
      .eq('client_id', clientId).eq('period', p.periodMonth);

    onProgress('Writing the departments and employees');
    const lines = [
      ...p.cost.departments.map((d) => ({
        client_id: clientId, period: p.periodMonth, scope: 'department' as const,
        ref: d.dep, name: d.dep, headcount: d.employees,
        rate: null, hours: null,
        gross: d.gross[0], deductions: d.deductions[0], contributions: d.contributions[0],
        net: d.net[0], cost: d.cost[0], gross_ytd: d.gross[1], cost_ytd: d.cost[1],
        detail: { earn: d.earn, ded: d.ded, con: d.con, tr: d.tr },
      })),
      ...p.sheet.employees.map((e) => ({
        client_id: clientId, period: p.periodMonth, scope: 'employee' as const,
        ref: e.code, name: e.name, headcount: 1,
        rate: e.rate, hours: e.hours,
        gross: e.gross, deductions: e.deductions, contributions: e.contributions,
        net: e.net, cost: e.cost, gross_ytd: null, cost_ytd: null,
        detail: { earn: e.earn, ded: e.ded, con: e.con, tr: e.tr, basic: e.basic },
      })),
    ];
    const { error: linErr } = await rep().from('payroll_lines').insert(lines);
    if (linErr) throw new Error(`The payroll lines could not be written: ${linErr.message}`);

    const { error: cErr } = await rep().from('imports')
      .update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: me.user?.id ?? null })
      .eq('id', importId);
    if (cErr) throw new Error(`The import could not be committed: ${cErr.message}`);

    for (const feed of ['payroll_cost_analysis', 'payroll_paysheet']) {
      await rep().from('feed_status').upsert({
        client_id: clientId,
        feed,
        last_import: importId,
        last_file: feed === 'payroll_paysheet' ? p.sheetFile.name : p.costFile.name,
        uploaded_at: new Date().toISOString(),
        uploaded_by: me.user?.id ?? null,
        covers_to: p.periodMonth,
      }, { onConflict: 'client_id,feed' });
    }

    return {
      importId,
      periodMonth: p.periodMonth,
      departments: p.cost.departments.length,
      employees: p.sheet.employees.length,
      gross: t?.gross[0] ?? 0,
      cost: t?.cost[0] ?? 0,
    };
  } catch (e) {
    await rep().from('payroll_lines').delete()
      .eq('client_id', clientId).eq('period', p.periodMonth);
    await rep().from('imports')
      .update({ status: 'rejected', notes: e instanceof Error ? e.message : String(e) })
      .eq('id', importId);
    throw e;
  }
}
