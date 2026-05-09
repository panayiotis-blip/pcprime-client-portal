import type { LineItem } from '../../types/invoice';

export interface ParsedInvoice {
  invoiceNumber: string;
  vendorName: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  lineItems: LineItem[];
  details: string;
}

// ---------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------
function normalizeText(raw: string): { text: string; lines: string[] } {
  // Collapse runs of whitespace within a line; keep line breaks
  const cleaned = raw.replace(/[ \t ]+/g, ' ').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  return { text: cleaned, lines };
}

function parseAmount(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.,\-]/g, '').trim();
  if (!cleaned) return 0;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  // If both separators exist, the last-seen one is the decimal separator
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
    }
    return parseFloat(cleaned.replace(/,/g, '')) || 0;
  }
  // Only comma → assume decimal if 2 digits follow, else thousands separator
  if (lastComma !== -1) {
    const tail = cleaned.slice(lastComma + 1);
    if (tail.length === 2) return parseFloat(cleaned.replace(',', '.')) || 0;
    return parseFloat(cleaned.replace(/,/g, '')) || 0;
  }
  // Only dot
  if (lastDot !== -1) {
    const tail = cleaned.slice(lastDot + 1);
    if (tail.length === 3 && cleaned.length > 4) {
      // European thousands: 1.234
      return parseFloat(cleaned.replace(/\./g, '')) || 0;
    }
    return parseFloat(cleaned) || 0;
  }
  return parseFloat(cleaned) || 0;
}

function formatDate(day: string, month: string, year: string): string {
  const y = year.length === 2 ? '20' + year : year;
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${y}`;
}

function parseDate(str: string): string {
  if (!str) return '';
  const m1 = str.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m1) return formatDate(m1[1], m1[2], m1[3]);

  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    ian: '01', φεβ: '02', μαρ: '03', απρ: '04', μαϊ: '05', ιουν: '06',
    ιουλ: '07', αυγ: '08', σεπ: '09', οκτ: '10', νοε: '11', δεκ: '12',
  };
  const m2 = str.match(/(\d{1,2})\s+([A-Za-zΑ-Ωα-ω]{3,})\s+(\d{2,4})/);
  if (m2) {
    const k = m2[2].substring(0, 3).toLowerCase();
    if (months[k]) return formatDate(m2[1], months[k], m2[3]);
  }
  const m3 = str.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s*(\d{4})/);
  if (m3) {
    const k = m3[1].substring(0, 3).toLowerCase();
    if (months[k]) return formatDate(m3[2], months[k], m3[3]);
  }
  return '';
}

function detectCurrency(text: string): string {
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/\$|\bUSD\b/i.test(text)) return 'USD';
  return '';
}

// Amounts written as 1.234,56 / 1,234.56 / 1234,56 / 1234.56 / 1234
const AMOUNT_RX = /(?:[€£$]\s*)?[-−]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\b|\b\d+(?:[.,]\d{1,2})\b/;
const AMOUNT_LINE_END_RX = /([-−]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})|\d+[.,]\d{1,2})\s*$/;

// ---------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------
function extractInvoiceNumber(text: string, lines: string[]): string {
  const patterns: RegExp[] = [
    /(?:invoice|inv|bill|τιμολογ[ίι]ο|αρ(?:ιθ)?\.?\s*τ(?:ιμ)?)\s*(?:#|no\.?|number|num|αρ\.?|αριθμ[όο]ς)?[\s:\/\-]*([A-Za-z0-9][A-Za-z0-9\-\/]{2,20})/i,
    /\binvoice[\s:]+#?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,20})/i,
    /^#\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,20})/m,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1] && !/^(date|number|no|total)$/i.test(m[1])) return m[1].trim();
  }
  // Fallback: look for a standalone "No." / "N°" / "#" token followed by a code
  for (const line of lines) {
    const m = line.match(/\b(?:no\.?|n°|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i);
    if (m) return m[1].trim();
  }
  return '';
}

function extractVendor(lines: string[]): string {
  // Strategy 1: line ending in LTD / LIMITED / AE / ΑΕ / ΕΠΕ / LLC / LLP / INC / CORP / BV / SA / PC
  const suffixRx = /\b(LTD|LIMITED|LLC|LLP|INC|CORP|B\.?V\.?|S\.?A\.?|A\.?E\.?|PC|ΕΠΕ|ΑΕ|ΟΕ|ΕΕ|ΙΚΕ)\b\.?\s*$/i;
  for (const line of lines.slice(0, 15)) {
    if (suffixRx.test(line)) return line.replace(/^(from|seller|vendor|supplier)[:\s]+/i, '').trim();
  }

  // Strategy 2: explicit labels
  const labelRx = /^(?:from|seller|vendor|supplier|bill(?:ed)? from|προμηθευτ[ήη]ς|εκδ[όο]της)[:\s]+(.+)$/i;
  for (const line of lines.slice(0, 25)) {
    const m = line.match(labelRx);
    if (m && m[1].trim().length > 2) return m[1].trim();
  }

  // Strategy 3: first reasonable-looking line in top 5 that isn't a label / date / number
  const labelWordRx = /^(invoice|date|bill|to|from|tax|vat|total|sub|due|page|tel|phone|fax|email|www|http|no\.?|#|amount|address|τιμολογ|ημερομη|τηλ|φαξ|δ[ιί]ευθυνση|συνολο|φπα|σελ[ιί]δα)/i;
  for (const line of lines.slice(0, 8)) {
    if (line.length < 3 || line.length > 80) continue;
    if (/^\d/.test(line)) continue;           // starts with a number
    if (labelWordRx.test(line)) continue;
    if (/^[A-Z]{2,}\d/.test(line)) continue; // looks like SKU or code
    if (line.split(/\s+/).length > 10) continue; // too verbose
    return line;
  }
  return '';
}

function extractDate(text: string, labels: string[]): string {
  for (const label of labels) {
    const rx = new RegExp(`${label}\\s*[:\\-]?\\s*(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{1,2}\\s+[A-Za-zΑ-Ωα-ω]+\\s+\\d{2,4}|[A-Za-z]+\\s+\\d{1,2},?\\s*\\d{4})`, 'i');
    const m = text.match(rx);
    if (m) return parseDate(m[1]);
  }
  return '';
}

// Find the best "total" line and return the amount next to it.
function extractTotal(lines: string[]): number {
  // Highest priority labels first. Later occurrences win ties (totals tend to be near the bottom).
  const priorities: { rx: RegExp; weight: number }[] = [
    { rx: /\b(grand\s*total|amount\s*due|balance\s*due|total\s*due|πληρωτ[έε]ο)\b/i, weight: 100 },
    { rx: /\btotal\b(?!.*\b(vat|tax|net|sub))/i, weight: 80 },
    { rx: /\b(συν[οό]λο|total\s*eur)\b/i, weight: 80 },
    { rx: /\btotal\b/i, weight: 40 },
  ];

  let best = { score: 0, amount: 0 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of priorities) {
      if (!p.rx.test(line)) continue;
      // Amount on the same line?
      let amountStr: string | null = null;
      const sameLine = line.match(AMOUNT_LINE_END_RX);
      if (sameLine) amountStr = sameLine[1];
      // Otherwise check the next line (sometimes totals span two lines)
      else if (i + 1 < lines.length) {
        const next = lines[i + 1].match(AMOUNT_LINE_END_RX);
        if (next) amountStr = next[1];
      }
      if (!amountStr) continue;
      const amount = parseAmount(amountStr);
      if (!amount || !isFinite(amount)) continue;
      // Later occurrence bonus
      const score = p.weight + i * 0.1;
      if (score > best.score) best = { score, amount };
    }
  }
  if (best.amount) return best.amount;

  // Fallback: the largest amount appearing on the page (sanity cap at 1M)
  let max = 0;
  for (const line of lines) {
    const m = line.match(AMOUNT_LINE_END_RX);
    if (m) {
      const v = parseAmount(m[1]);
      if (v > max && v < 1_000_000) max = v;
    }
  }
  return max;
}

function extractTax(lines: string[]): number {
  const rx = /\b(?:vat|tax|gst|φπα|φορος)\b[^\n]*?([-−]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})|\d+[.,]\d{1,2})/i;
  for (const line of lines) {
    const m = line.match(rx);
    if (m) return parseAmount(m[1]);
  }
  return 0;
}

function extractSubtotal(lines: string[]): number {
  const rx = /\b(sub\s*total|net(?:\s*amount)?|καθαρ[ηή]\s*αξ[ιί]α|μερικ[οό]\s*συν[οό]λο)\b[^\n]*?([-−]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})|\d+[.,]\d{1,2})/i;
  for (const line of lines) {
    const m = line.match(rx);
    if (m) return parseAmount(m[2]);
  }
  return 0;
}

function extractLineItems(lines: string[]): LineItem[] {
  const items: LineItem[] = [];
  for (const line of lines) {
    // desc  qty  price  amount (tab/space separated, numbers at end)
    const m1 = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+[€£$]?(\d[\d.,\s]*)\s+[€£$]?(\d[\d.,\s]*)$/);
    if (m1) {
      items.push({
        description: m1[1].trim(),
        quantity: parseAmount(m1[2]),
        unitPrice: parseAmount(m1[3]),
        amount: parseAmount(m1[4]),
      });
      continue;
    }
    // desc  ...  amount
    const m2 = line.match(/^(.{3,}?)\s{2,}[€£$]?([-−]?\d[\d.,\s]*[.,]\d{2})\s*$/);
    if (m2) {
      const desc = m2[1].trim();
      if (!/^(subtotal|total|vat|tax|sub|balance|amount|net)/i.test(desc)) {
        items.push({ description: desc, amount: parseAmount(m2[2]) });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------
export function parseInvoiceText(raw: string): ParsedInvoice {
  const { text, lines } = normalizeText(raw);

  const invoiceNumber = extractInvoiceNumber(text, lines);
  const vendorName   = extractVendor(lines);
  const invoiceDate  = extractDate(text, ['invoice\\s*date', 'date', 'dated', 'ημερομηνία']) || extractDate(text, ['']);
  const dueDate      = extractDate(text, ['due\\s*date', 'payment\\s*due', 'pay\\s*by', 'λήξη', 'πληρωτέο έως']);
  const subtotal     = extractSubtotal(lines);
  const taxAmount    = extractTax(lines);
  const totalAmount  = extractTotal(lines) || (subtotal + taxAmount);
  const currency     = detectCurrency(text);
  const lineItems    = extractLineItems(lines);

  const details = vendorName
    ? `${vendorName}${invoiceNumber ? ' - ' + invoiceNumber : ''}`
    : invoiceNumber || '';

  return {
    invoiceNumber,
    vendorName,
    invoiceDate,
    dueDate,
    subtotal,
    taxAmount,
    totalAmount,
    currency,
    lineItems,
    details,
  };
}
