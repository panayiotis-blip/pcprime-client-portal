// Central date/time formatting for the whole app — always dd/mm/yyyy (en-GB
// style), so clients and staff see one consistent format regardless of their
// browser/OS locale. Note: native <input type="date"> pickers still display
// in the browser's own locale; this controls every date we render ourselves.

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // Date-only strings (yyyy-mm-dd) are anchored to local midnight so they
  // don't shift a day across timezones.
  const s = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00' : value;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// dd/mm/yyyy (e.g. 27/05/2026). Empty/invalid → fallback.
export function formatDate(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// dd/mm/yyyy HH:mm (24-hour). Empty/invalid → fallback.
export function formatDateTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)} ${hh}:${mi}`;
}

// HH:mm only.
export function formatTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
