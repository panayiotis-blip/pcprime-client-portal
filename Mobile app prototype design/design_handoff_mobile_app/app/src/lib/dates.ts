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
