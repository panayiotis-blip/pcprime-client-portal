// Facade for the TaxisNet exporter. The engine lives in ./taxisnet/* (format,
// fieldMap, keyCatalogue, buildXml, validate). This file keeps the import path
// the calculator already uses and owns the browser-download side effect.

import { buildTaxisnetXml } from './taxisnet/buildXml';
import { formCode } from './taxisnet/format';
import type { TaxReturnFormType } from './taxisnet/format';

export { buildTaxisnetXml } from './taxisnet/buildXml';
export { validateExport } from './taxisnet/validate';
export type { ValidationResult } from './taxisnet/validate';
export type { TaxReturnFormType } from './taxisnet/format';

// Build + trigger a browser download. Returns the XML string (callers that also
// file it to the client pass this on). Validate BEFORE calling this.
export function downloadTaxisnetXml(inputData: any, year: number, formType: TaxReturnFormType): string {
  const xml = buildTaxisnetXml(inputData, year, formType);
  const form = formCode(formType);
  const tic = String(inputData?.clientTIC ?? 'taxpayer').trim() || 'taxpayer';
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${form}-${tic}-${year}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return xml;
}
