// =============================================================
// Cyprus VAT period categories (BTMS reference).
// Stored on clients as the single-letter code A-G; shown with the
// descriptive label. Shared by the Registrations form, the client
// list, the printed client card and Smart Import.
// =============================================================

export interface VatCategory {
  value: string;
  label: string;
  /** Months per filing period — drives the staggered period calculation. */
  frequency: number;
}

export const VAT_CATEGORIES: VatCategory[] = [
  { value: 'A', label: 'A — 2-Monthly (ending odd months)',  frequency: 2 },
  { value: 'B', label: 'B — 2-Monthly (ending even months)', frequency: 2 },
  { value: 'C', label: 'C — Monthly',                        frequency: 1 },
  { value: 'D', label: 'D — 6-Monthly',                      frequency: 6 },
  { value: 'E', label: 'E — Annually',                       frequency: 12 },
  { value: 'F', label: 'F — 4-Monthly',                      frequency: 4 },
  { value: 'G', label: 'G — 3-Monthly',                      frequency: 3 },
];

const BY_CODE = new Map(VAT_CATEGORIES.map((c) => [c.value, c]));

/** Full descriptive label for a code, e.g. 'G' → 'G — 3-Monthly'.
 *  Unknown / blank codes return an empty string. */
export function vatCategoryLabel(code: string | null | undefined): string {
  const v = String(code ?? '').trim().toUpperCase();
  return BY_CODE.get(v)?.label || '';
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Month dropdown options — value is the month number 1-12 (as a string). */
export const MONTHS: { value: string; label: string }[] =
  MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label }));

/** The filing periods for a category + starting month, e.g.
 *  ('G', 2) → ['Feb–Apr', 'May–Jul', 'Aug–Oct', 'Nov–Jan'].
 *  Returns [] if the category or starting month is missing/invalid. */
export function vatPeriods(
  code: string | null | undefined,
  startMonth: number | string | null | undefined,
): string[] {
  const cat = BY_CODE.get(String(code ?? '').trim().toUpperCase());
  const s = Number(startMonth);
  if (!cat || !Number.isInteger(s) || s < 1 || s > 12) return [];
  const f = cat.frequency;
  const periods: string[] = [];
  for (let i = 0; i < 12 / f; i++) {
    const startIdx = (s - 1 + i * f) % 12;
    const endIdx = (s - 1 + i * f + f - 1) % 12;
    periods.push(
      f === 1
        ? MONTH_ABBR[startIdx]
        : `${MONTH_ABBR[startIdx]}–${MONTH_ABBR[endIdx]}`,
    );
  }
  return periods;
}
