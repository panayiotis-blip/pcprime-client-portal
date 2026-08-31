// Reading a file that has just been stored.
//
// The parsers and the commit logic are untouched — they are proved against six
// years of real files and against BTMS's own printed totals, and FIX.md is
// explicit that they stay. This only chooses which of them a feed belongs to,
// and hands over the file and the place the folder put it.
//
// Nothing here stores anything. By the time this runs the file is already in
// the client's folder, and storeInBtmsFolder is the only code that puts it
// there.

import type { ImportSource } from '../lib/import/portalFolder.ts';
import { listBtmsFolder, fileFromPortal, sourceOf } from '../lib/import/portalFolder.ts';
import { prepareLedgerImport, commitLedgerImport } from '../lib/import/ledgerImport.ts';
import { prepareChartImport, commitChartImport } from '../lib/import/chartImport.ts';
import { prepareTrialBalanceImport, commitTrialBalanceImport } from '../lib/import/trialBalanceImport.ts';
import { prepareStockImport, commitStockImport } from '../lib/import/stockImport.ts';
import { preparePayrollImport, commitPayrollImport } from '../lib/import/payrollImport.ts';
import type { Feed } from './feeds.ts';

const n = (v: number) => v.toLocaleString('en-GB');

export type Step = (s: string) => void;

export async function runImport(
  clientId: number,
  feed: Feed,
  file: File,
  source: ImportSource,
  period: string | null,
  step: Step,
): Promise<string> {
  if (feed.kind === 'chart') {
    const p = await prepareChartImport(clientId, file, step);
    if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
    if (!p.fingerprint.accepted) throw new Error(p.fingerprint.reason);
    const r = await commitChartImport(clientId, file, p, source, step);
    return `${n(r.written)} accounts · ${r.mapping.seeded} mapped from the master`
      + (r.mapping.unmapped ? ` · ${r.mapping.unmapped} unmapped` : '');
  }

  if (feed.kind === 'ledger') {
    const p = await prepareLedgerImport(clientId, file, step);
    if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
    if (!p.fingerprint.accepted) throw new Error(p.fingerprint.reason);
    const r = await commitLedgerImport(clientId, file, p, source, {}, step);
    return `${n(r.postingsAdded)} postings across ${r.monthsReplaced} months.`;
  }

  if (feed.kind === 'trial_balance') {
    const annual = feed.key === 'trial_balance_annual';
    if (!period) throw new Error('The period is needed before a trial balance can be read.');
    // A year end is recorded at December, as the importer has always done; a
    // monthly one is the month it is at.
    const periodMonth = annual ? `${period.slice(0, 4)}-12-01` : `${period}-01`;
    const p = await prepareTrialBalanceImport(clientId, file, step);
    if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
    const r = await commitTrialBalanceImport(
      clientId, file, p, source, { periodMonth, isAnnual: annual }, step);
    return `${r.rows} accounts for ${annual ? 'year ended ' : ''}${r.periodMonth.slice(0, 7)}.`;
  }

  if (feed.kind === 'stock') {
    if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      throw new Error('A stock valuation needs the date the count was taken.');
    }
    const p = await prepareStockImport(clientId, file, step);
    if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
    const r = await commitStockImport(clientId, file, p, source, period, step);
    return `${n(r.items)} items, ${r.value.toFixed(2)} against ${r.ledgerValue.toFixed(2)} in the ledger.`;
  }

  if (feed.kind === 'payroll_cost' || feed.kind === 'payroll_sheet') {
    // Payroll takes both reports or neither: each is the other's check, and the
    // importer refuses them if they disagree. The one just stored is in the
    // folder, so the partner is looked for there.
    const wantKind = feed.kind === 'payroll_cost' ? 'payroll_sheet' : 'payroll_cost';
    step('Looking for the other payroll report');
    const held = await listBtmsFolder(clientId);
    const partner = held.find((f) => f.kind === wantKind);
    if (!partner) {
      return 'Stored. The other payroll report is not in the folder yet — the cost analysis and '
        + 'the paysheet are loaded together, because each is the other’s check.';
    }
    const partnerFile = await fileFromPortal(partner);
    const cost = feed.kind === 'payroll_cost' ? file : partnerFile;
    const sheet = feed.kind === 'payroll_cost' ? partnerFile : file;
    const costSrc = feed.kind === 'payroll_cost' ? source : sourceOf(partner);
    const sheetSrc = feed.kind === 'payroll_cost' ? sourceOf(partner) : source;
    const p = await preparePayrollImport(clientId, cost, sheet, step);
    const r = await commitPayrollImport(
      clientId, cost, sheet, p, { cost: costSrc, sheet: sheetSrc }, step);
    return `${r.periodMonth.slice(0, 7)} · ${r.employees} employees · cost ${r.cost.toFixed(2)}.`;
  }

  return 'Stored. There is no importer for this kind of file yet, so it is kept for the review.';
}
