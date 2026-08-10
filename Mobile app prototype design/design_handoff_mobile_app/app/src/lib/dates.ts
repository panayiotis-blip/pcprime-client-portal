/**
 * Date formatting, hand-rolled rather than routed through `Intl`, so the
 * output is identical on every engine and platform.
 */

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "Thursday, 6 August 2026" — Home's eyebrow. */
export function formatLongDate(date: Date) {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Friday 7 August" — the booking confirmation summary. */
export function formatBookingDay(date: Date) {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "10 August 2026" — filing due lines. */
export function formatDate(date: Date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "4 Aug" — document meta lines, where the year is usually noise. */
export function formatShortDate(date: Date) {
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** The two-letter block in Home's calendar rows and the Filings date blocks. */
export function monthAbbreviation(date: Date) {
  return MONTHS_SHORT[date.getMonth()];
}

/** "09:30", in the device's local time. */
export function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Whole days from today until `date`; negative once it is in the past. */
export function daysUntil(date: Date, from = new Date()) {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((end - start) / 86_400_000);
}

/**
 * "due in 6 days" / "due today" / "overdue by 3 days" — the alert card's
 * second half, and the only place the app editorialises about a date.
 */
export function describeDue(date: Date, from = new Date()) {
  const days = daysUntil(date, from);
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days} days`;
  if (days === -1) return 'overdue by a day';
  return `overdue by ${Math.abs(days)} days`;
}

/** Parses a Postgres `date` or `timestamptz`; null when the value is absent. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type BookableDay = {
  /** Stable key for selection state. */
  key: string;
  /** "MON" — the label above the date. */
  dow: string;
  /** Day of month. */
  num: number;
  /** Long label used in the confirmation summary. */
  label: string;
};

/**
 * The next `count` weekdays, starting tomorrow. Weekends are excluded — the
 * office does not take consultations on them.
 */
export function nextWeekdays(from: Date, count = 7): BookableDay[] {
  const days: BookableDay[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  while (days.length < count) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push({
      key: cursor.toDateString(),
      dow: WEEKDAYS_SHORT[weekday],
      num: cursor.getDate(),
      label: formatBookingDay(cursor),
    });
  }

  return days;
}
