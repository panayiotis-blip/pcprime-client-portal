// Shared value formatting + types for the TaxisNet exporter, matching the
// conventions in the official sample filings (see supabase/xsd-tep-ext-2024).

export type TaxReturnFormType = 'individuals' | 'self_employed';
export const formCode = (ft: TaxReturnFormType) => (ft === 'self_employed' ? 'epr1a' : 'epr1m');

export const TIC_RE = /^\d{8}[A-Z]$/;

export const xmlEscape = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Money → comma decimal, trailing zeros stripped (11000 · 291,5 · 543,84 · -161,61).
// Blank/non-numeric → '' (skipped); an explicit 0 → "0".
export const fmtAmount = (v: unknown): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
};

// Date → D/M/YYYY (no zero padding), matching the sample field values.
export const fmtDate = (v: unknown): string => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v).trim();
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
};

export type FieldKind = 'text' | 'money' | 'date' | 'tic';

export const fmtByKind = (kind: FieldKind, raw: unknown): string =>
  kind === 'money' ? fmtAmount(raw)
    : kind === 'date' ? fmtDate(raw)
    : kind === 'tic' ? String(raw ?? '').trim().toUpperCase()
    : String(raw ?? '').trim();
