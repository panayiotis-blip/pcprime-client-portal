// =============================================================
// Shared field validators — used by Smart Import (and available to
// the client edit forms). Each returns a level + message.
// =============================================================

export type ValLevel = 'ok' | 'warning' | 'error';
export interface ValResult {
  level: ValLevel;
  message: string;
}

const ok = (): ValResult => ({ level: 'ok', message: '' });

const CLIENT_CATEGORIES = [
  'company', 'partnership', 'individual', 'sole_trader', 'self_employed',
  'deceased', 'dormant', 'prospective', 'other', 'vendor_only',
];

/** Loose date parser — accepts Date, DD/MM/YYYY, YYYY-MM-DD. */
export function parseDateLoose(raw: any): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // DD/MM/YYYY
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/); // YYYY-MM-DD
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function validateEmail(raw: any): ValResult {
  const v = String(raw ?? '').trim();
  if (!v) return ok();
  const parts = v.split(/[;,]+/).map((p) => p.trim()).filter(Boolean);
  const bad = parts.filter((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
  return bad.length
    ? { level: 'error', message: `Invalid email: ${bad.join(', ')}` }
    : ok();
}

export function validateVat(raw: any): ValResult {
  const v = String(raw ?? '').trim().toUpperCase().replace(/\s/g, '');
  if (!v) return ok();
  return /^CY\d{8}[A-Z]$/.test(v)
    ? ok()
    : { level: 'warning', message: 'VAT not in Cyprus format (CY########X)' };
}

export function validateIban(raw: any): ValResult {
  const v = String(raw ?? '').trim().toUpperCase().replace(/\s/g, '');
  if (!v) return ok();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)
    ? ok()
    : { level: 'warning', message: 'IBAN format looks invalid' };
}

export function validatePhone(raw: any): ValResult {
  const v = String(raw ?? '').trim();
  if (!v) return ok();
  return /^\+?[\d\s()\-./]{6,}$/.test(v)
    ? ok()
    : { level: 'warning', message: 'Phone number looks unusual' };
}

export function validateYear(raw: any): ValResult {
  const v = String(raw ?? '').trim();
  if (!v) return ok();
  const n = Number(v);
  const yr = new Date().getFullYear();
  return Number.isInteger(n) && n >= 1900 && n <= yr
    ? ok()
    : { level: 'error', message: `Year must be a number between 1900 and ${yr}` };
}

export function validateDate(raw: any, opts?: { notFuture?: boolean }): ValResult {
  if (raw == null || String(raw).trim() === '') return ok();
  const d = parseDateLoose(raw);
  if (!d) return { level: 'error', message: 'Not a valid date' };
  if (opts?.notFuture && d.getTime() > Date.now()) {
    return { level: 'error', message: 'Date is in the future' };
  }
  return ok();
}

export function validateAmount(raw: any, max = 99999.99): ValResult {
  const v = String(raw ?? '').trim();
  if (!v) return ok();
  const n = Number(v.replace(/[^\d.\-]/g, ''));
  if (!isFinite(n) || n < 0) return { level: 'error', message: 'Must be a positive number' };
  if (n > max) return { level: 'error', message: `Must not exceed ${max.toLocaleString()}` };
  return ok();
}

export function validateVatPeriod(raw: any): ValResult {
  const v = String(raw ?? '').trim();
  if (!v) return ok();
  return ['1', '4', '7', '10'].includes(v)
    ? ok()
    : { level: 'warning', message: 'VAT period is usually 1, 4, 7 or 10' };
}

export function validateVatCategory(raw: any): ValResult {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!v) return ok();
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(v)
    ? ok()
    : { level: 'warning', message: `VAT category should be a letter A-G — got "${raw}"` };
}

export function validateMonth(raw: any): ValResult {
  const v = String(raw ?? '').trim();
  if (!v) return ok();
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12
    ? ok()
    : { level: 'warning', message: 'Starting month should be a number 1-12' };
}

export function validateCategory(raw: any): ValResult {
  const v = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!v) return ok();
  return CLIENT_CATEGORIES.includes(v)
    ? ok()
    : { level: 'warning', message: `Unrecognised category "${raw}" — may need a manual category` };
}

/** Flags mojibake / replacement characters that hint at an encoding problem. */
export function checkEncoding(raw: any): ValResult {
  return String(raw ?? '').includes('�')
    ? { level: 'warning', message: 'Possible text-encoding issue' }
    : ok();
}

/** Dispatch a value to the right validator for a given client field key. */
export function validateField(fieldKey: string, value: any): ValResult {
  const enc = checkEncoding(value);
  if (enc.level !== 'ok') return enc;
  switch (fieldKey) {
    case 'email':                  return validateEmail(value);
    case 'vat_number':             return validateVat(value);
    case 'bank_iban':              return validateIban(value);
    case 'phone':
    case 'mobile':                 return validatePhone(value);
    case 'year_of_incorporation':  return validateYear(value);
    case 'engagement_letter_date': return validateDate(value, { notFuture: true });
    case 'incorporation_date':
    case 'date_of_birth':
    case 'vat_registration_date':
    case 'director_appointed_date': return validateDate(value);
    case 'annual_fee_agreed':
    case 'monthly_fee':            return validateAmount(value);
    case 'vat_period':             return validateVatPeriod(value);
    case 'vat_category':
    case 'oss_vat_category':       return validateVatCategory(value);
    case 'vat_start_month':
    case 'oss_vat_start_month':    return validateMonth(value);
    case 'client_category':        return validateCategory(value);
    default:                       return ok();
  }
}
