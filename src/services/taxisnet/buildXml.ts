// Builds the TaxisNet declaration XML by walking FIELD_MAPS. Output format is
// pinned to the official sample filings: mof:-prefixed elements + schemaLocation,
// ISO <period>, comma decimals, D/M/YYYY field dates, zeros emitted.

import { FIELD_MAPS } from './fieldMap';
import { fmtByKind, formCode, xmlEscape } from './format';
import type { TaxReturnFormType } from './format';

const MOF_NS = 'http://www.mof.gov.cy';
export const SUPPORTED_YEARS = [2024];
const versionFor = (year: number) => `${SUPPORTED_YEARS.includes(year) ? year : 2024}-1.0`;

const resolve = (obj: any, path: string): unknown =>
  path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);

export interface CollectedField { key: string; value: string; confidence: 'confirmed' | 'inferred' }
export interface CollectedGrid { gridId: string; rows: CollectedField[][] }
export interface Collected { tic: string; flat: CollectedField[]; grids: CollectedGrid[] }

// Resolve every mapped field to its (key, formatted value), dropping blanks.
// Shared by the builder and the validator so they never diverge.
export function collectFields(inputData: any, formType: TaxReturnFormType): Collected {
  const map = FIELD_MAPS[formCode(formType)];
  const tic = String(resolve(inputData, map.ticSource) ?? '').trim().toUpperCase();

  const flat: CollectedField[] = [];
  if (tic) flat.push({ key: map.ticFieldKey, value: tic, confidence: 'confirmed' });
  for (const e of map.flat) {
    const value = fmtByKind(e.kind, resolve(inputData, e.source));
    if (value) flat.push({ key: e.key, value, confidence: e.confidence });
  }

  const grids: CollectedGrid[] = [];
  for (const g of map.grids) {
    const arr = resolve(inputData, g.source);
    if (!Array.isArray(arr)) continue;
    const rows: CollectedField[][] = [];
    for (const el of arr) {
      const row: CollectedField[] = [];
      for (const c of g.cols) {
        const value = fmtByKind(c.kind, el?.[c.field]);
        if (value) row.push({ key: `${g.gridId}${c.col}`, value, confidence: c.confidence });
      }
      if (row.length) rows.push(row);
    }
    if (rows.length) grids.push({ gridId: g.gridId, rows });
  }
  return { tic, flat, grids };
}

export function buildTaxisnetXml(inputData: any, year: number, formType: TaxReturnFormType): string {
  const form = formCode(formType);
  const { tic, flat, grids } = collectFields(inputData, formType);
  const I = '\t';

  const fieldXml = flat.map(
    (f) => `${I}${I}<mof:field key="${f.key}">${xmlEscape(f.value)}</mof:field>`,
  );
  const gridXml = grids.map((g) => {
    const rowXml = g.rows.map((r, i) => {
      const fs = r.map((f) => `${I}${I}${I}${I}<mof:field key="${f.key}">${xmlEscape(f.value)}</mof:field>`);
      return `${I}${I}${I}<mof:row number="${i + 1}">\n${fs.join('\n')}\n${I}${I}${I}</mof:row>`;
    });
    return `${I}${I}<mof:grid id="${g.gridId}">\n${rowXml.join('\n')}\n${I}${I}</mof:grid>`;
  });

  const period = `${I}${I}<mof:period from="${year}-01-01" to="${year}-12-31"/>`;
  const body = [period, ...fieldXml, ...gridXml].join('\n');
  const schemaUrl = `http://taxisnet.mof.gov.cy/schema/cy-${form}-declaration.xsd`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mof:${form}-declarations xmlns:mof="${MOF_NS}" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${MOF_NS} ${schemaUrl}">\n` +
    `${I}<mof:${form}-declaration taxpayer="${xmlEscape(tic)}" version="${versionFor(year)}">\n` +
    `${body}\n` +
    `${I}</mof:${form}-declaration>\n` +
    `</mof:${form}-declarations>\n`
  );
}
