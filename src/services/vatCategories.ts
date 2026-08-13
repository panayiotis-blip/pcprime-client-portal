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

export interface VatPeriodDates {
  /** 'Feb–Apr 2026', or 'Nov 2026–Jan 2027' where the period crosses the year. */
  label: string;
  /** ISO dates — first day of the first month, last day of the last. */
  start: string;
  end: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The filing periods of one cycle year, with real dates — what a VAT filing
 * needs recording against. `vatPeriods` above answers "what are this client's
 * periods called"; this answers "which period is this return for".
 *
 * The year is the year the CYCLE starts in, so a category G client starting in
 * November has Nov 2026–Jan 2027 as their first 2026 period. Periods that run
 * past December carry the year on both ends rather than pretending otherwise.
 */
export function vatPeriodsForYear(
  code: string | null | undefined,
  startMonth: number | string | null | undefined,
  year: number,
): VatPeriodDates[] {
  const cat = BY_CODE.get(String(code ?? '').trim().toUpperCase());
  const s = Number(startMonth);
  if (!cat || !Number.isInteger(s) || s < 1 || s > 12) return [];
  if (!Number.isInteger(year)) return [];

  const f = cat.frequency;
  const out: VatPeriodDates[] = [];
  for (let i = 0; i < 12 / f; i++) {
    // Month arithmetic overflows into the next year on its own.
    const start = new Date(year, s - 1 + i * f, 1);
    const end = new Date(year, s - 1 + i * f + f, 0); // day 0 = last of previous
    const sameYear = start.getFullYear() === end.getFullYear();
    const startPart = `${MONTH_ABBR[start.getMonth()]}${sameYear ? '' : ' ' + start.getFullYear()}`;
    const endPart = `${MONTH_ABBR[end.getMonth()]} ${end.getFullYear()}`;
    out.push({
      label: f === 1 ? `${MONTH_ABBR[start.getMonth()]} ${start.getFullYear()}` : `${startPart}–${endPart}`,
      start: iso(start),
      end: iso(end),
    });
  }
  return out;
}

/** Months (1-12) in which VAT tasks should FIRE for a category + start month:
 *  the month AFTER each filing period ends (the return is then due the 10th of
 *  the following month). e.g. G (3-monthly) starting Apr → [1, 4, 7, 10].
 *  Returns [] if the category / start month is missing or invalid. */
export function vatFireMonths(
  code: string | null | undefined,
  startMonth: number | string | null | undefined,
): number[] {
  const cat = BY_CODE.get(String(code ?? '').trim().toUpperCase());
  const s = Number(startMonth);
  if (!cat || !Number.isInteger(s) || s < 1 || s > 12) return [];
  const f = cat.frequency;
  const months = new Set<number>();
  for (let i = 0; i < 12 / f; i++) {
    const endIdx = (s - 1 + i * f + f - 1) % 12;   // 0-based period-end month
    months.add(((endIdx + 1) % 12) + 1);            // 1-based fire month = end + 1
  }
  return [...months].sort((a, b) => a - b);
}
