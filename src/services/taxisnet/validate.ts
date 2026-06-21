// Pre-export error check. Runs when the user clicks "Export to XML" — blocking
// errors stop the export; warnings let it proceed with a confirm.

import { collectFields, SUPPORTED_YEARS } from './buildXml';
import { KEY_CATALOGUE } from './keyCatalogue';
import { FIELD_MAPS } from './fieldMap';
import { TIC_RE, formCode } from './format';
import type { TaxReturnFormType } from './format';

export interface ValidationResult { errors: string[]; warnings: string[] }

export function validateExport(inputData: any, year: number, formType: TaxReturnFormType): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const form = formCode(formType);
  const cat = KEY_CATALOGUE[form];

  if (!SUPPORTED_YEARS.includes(year)) {
    warnings.push(`No bundled TaxisNet schema for ${year} — generated against the ${SUPPORTED_YEARS.join('/')} form; re-check when the ${year} schema is added.`);
  }

  const { tic, flat, grids } = collectFields(inputData, formType);

  // Taxpayer T.I.C.
  if (!tic) errors.push('Taxpayer T.I.C. is missing — TaxisNet will reject the file.');
  else if (!TIC_RE.test(tic)) errors.push(`Taxpayer T.I.C. "${tic}" is not valid (must be 8 digits followed by 1 letter, e.g. 12345678X).`);

  // Required flat fields declared in the map.
  for (const e of FIELD_MAPS[form].flat) {
    if (e.required && !flat.some((f) => f.key === e.key)) {
      errors.push(`Required field "${e.source}" is empty.`);
    }
  }

  // Every emitted key must exist in the official schema enumeration.
  for (const f of flat) {
    if (f.key !== FIELD_MAPS[form].ticFieldKey && !cat.flat.has(f.key)) {
      errors.push(`Field key "${f.key}" is not in the ${form} schema.`);
    }
  }
  for (const g of grids) {
    if (!cat.gridIds.has(g.gridId)) errors.push(`Grid "${g.gridId}" is not in the ${form} schema.`);
    g.rows.forEach((row, ri) => row.forEach((f) => {
      if (!cat.grid.has(f.key)) errors.push(`Grid key "${f.key}" (row ${ri + 1}) is not in the ${form} schema.`);
    }));
  }

  // Nothing to export.
  if (!flat.length && !grids.length) errors.push('There is nothing to export — the return has no data.');

  // Inferred (unverified) mappings → warn so nothing unconfirmed ships silently.
  const inferredGroups = new Set<string>();
  const scan = (f: { key: string; confidence: string }) => {
    if (f.confidence === 'inferred') inferredGroups.add(f.key.replace(/c\d+[a-z]?$/i, ''));
  };
  flat.forEach(scan);
  grids.forEach((g) => g.rows.forEach((r) => r.forEach(scan)));
  if (inferredGroups.size) {
    warnings.push(`${inferredGroups.size} field(s) use inferred mappings not yet confirmed against an official sample — verify with a TaxisNet test import before relying on the file.`);
  }

  return { errors, warnings };
}
