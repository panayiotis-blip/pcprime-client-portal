// Pre-export error check. Runs when the user clicks "Export to XML" — blocking
// errors stop the export; warnings let it proceed with a confirm.

import { collectFields, SUPPORTED_YEARS, PROVISIONAL_YEARS } from './buildXml';
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
    warnings.push(`No bundled TaxisNet schema for ${year} — generated against the 2024 form; re-check when the ${year} schema is added.`);
  } else if (PROVISIONAL_YEARS.includes(year)) {
    warnings.push(`${year} is generated against the 2024 schema (no separate ${year} XSD published yet) — re-check once the ${year} schema lands.`);
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

  // Unproven mappings → warn, but say how unproven. 'derived' means the table's
  // columns line up one-for-one with the printed form and this key falls in a
  // fixed position; 'inferred' means it was read off the layout with no such
  // check. They deserve different levels of suspicion.
  const derivedGroups = new Set<string>();
  const inferredGroups = new Set<string>();
  const scan = (f: { key: string; confidence: string }) => {
    const group = f.key.replace(/c\d+[a-z]?$/i, '');
    if (f.confidence === 'derived') derivedGroups.add(group);
    else if (f.confidence === 'inferred') inferredGroups.add(group);
  };
  flat.forEach(scan);
  grids.forEach((g) => g.rows.forEach((r) => r.forEach(scan)));
  if (inferredGroups.size) {
    warnings.push(`${inferredGroups.size} field(s) use inferred mappings — read off the form layout with nothing to check them against. Verify with a TaxisNet test import before relying on the file.`);
  }
  if (derivedGroups.size) {
    warnings.push(`${derivedGroups.size} field(s) use derived mappings: their table's columns match the printed form one-for-one, but no filing has been seen carrying them. A TaxisNet test import would settle it.`);
  }

  // Benefits in kind have no column on the form: they are declared as their own
  // employment line under code 7 or 9. They used to be exported into the tax
  // column, which overstated tax deducted at source, so they are now left out —
  // say so, rather than dropping a figure the preparer entered.
  const bikTotal = (inputData?.employments ?? []).reduce((s: number, e: any) => s + (Number(e?.bik) || 0), 0);
  if (bikTotal > 0) {
    warnings.push(`Benefits in kind (€${bikTotal.toLocaleString()}) are NOT in the file: the form has no column for them — declare them as a separate employment line with code 7 or 9 (benefits not subject to Social Insurance).`);
  }

  return { errors, warnings };
}
