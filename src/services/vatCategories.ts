// =============================================================
// Cyprus VAT period categories (BTMS reference).
// Stored on clients as the single-letter code A-G; shown with the
// descriptive label. Shared by the Registrations form, the client
// list, the printed client card and Smart Import.
// =============================================================

export interface VatCategory {
  value: string;
  label: string;
}

export const VAT_CATEGORIES: VatCategory[] = [
  { value: 'A', label: 'A — 2-Monthly (ending odd months)' },
  { value: 'B', label: 'B — 2-Monthly (ending even months)' },
  { value: 'C', label: 'C — Monthly' },
  { value: 'D', label: 'D — 6-Monthly' },
  { value: 'E', label: 'E — Annually' },
  { value: 'F', label: 'F — 4-Monthly' },
  { value: 'G', label: 'G — 3-Monthly' },
];

const BY_CODE = new Map(VAT_CATEGORIES.map((c) => [c.value, c]));

/** Full descriptive label for a code, e.g. 'G' → 'G — 3-Monthly'.
 *  Unknown / blank codes return an empty string. */
export function vatCategoryLabel(code: string | null | undefined): string {
  const v = String(code ?? '').trim().toUpperCase();
  return BY_CODE.get(v)?.label || '';
}
