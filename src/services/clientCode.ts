// Client code generation.
//
// Format: <TYPE>-<3 letters>-<counter>, e.g. CO-ALP-001, IND-GEO-002,
// PART-XYZ-001. The counter runs per three-letter group, so a second company
// starting "ALP" becomes CO-ALP-002 while the first "BET" company starts again
// at CO-BET-001.
//
// Codes are ASCII by design: they end up in filenames, spreadsheet exports,
// TaxisNet XML and URLs, so Greek names are transliterated rather than kept in
// their own script. Older codes (221XXXNNN, PC-CO-NNN) are left alone — they
// appear on issued invoices and filings, so renumbering would break every
// historical reference.

const GREEK_MAP: Record<string, string> = {
  Α: 'A',  Β: 'V',  Γ: 'G',  Δ: 'D',  Ε: 'E',  Ζ: 'Z',  Η: 'I',  Θ: 'TH',
  Ι: 'I',  Κ: 'K',  Λ: 'L',  Μ: 'M',  Ν: 'N',  Ξ: 'X',  Ο: 'O',  Π: 'P',
  Ρ: 'R',  Σ: 'S',  Τ: 'T',  Υ: 'Y',  Φ: 'F',  Χ: 'CH', Ψ: 'PS', Ω: 'O',
};

// Combining diacritical marks (U+0300–U+036F), left over after NFD decomposition.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Fold a name down to Latin A–Z. Accents are stripped first so Ά and ά both
 * reach Α, and final sigma (ς) uppercases to Σ on the way. Digits, spaces and
 * punctuation are dropped.
 *
 * Multi-letter mappings expand before truncation, which is why ΑΧΙΛΛΕΥΣ gives
 * ACH (Α→A, Χ→CH) and ΘΕΜΙΣΤΟΚΛΟΙ gives THE (Θ→TH, Ε→E).
 */
export function transliterate(name: string): string {
  const stripped = (name || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase();
  let out = '';
  for (const ch of stripped) {
    const mapped = GREEK_MAP[ch];
    if (mapped) out += mapped;
    else if (ch >= 'A' && ch <= 'Z') out += ch;
  }
  return out;
}

const TYPE_PREFIX: Record<string, string> = {
  individual:  'IND',
  company:     'CO',
  partnership: 'PART',
};

/**
 * The full prefix a code is counted within, e.g. "CO-ALP-".
 * Names with fewer than three usable letters are padded with X.
 */
export function clientCodePrefix(name: string, clientType?: string | null): string {
  const letters = transliterate(name).slice(0, 3).padEnd(3, 'X');
  const type = TYPE_PREFIX[(clientType || 'company').toLowerCase()] || TYPE_PREFIX.company;
  return `${type}-${letters}-`;
}
