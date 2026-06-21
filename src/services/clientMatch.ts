// Fuzzy client matching — used by the smart-import "match & reconcile" step and
// the duplicate-finder tool. The core problem: the same client may be written in
// Greek on one list and Latin on another ("Γεώργιος Παπαδόπουλος" vs "Georgios
// Papadopoulos"), or misspelled. Exact matching misses these and creates dupes.
//
// Strategy: strong identifiers first (email / tax number / client code / phone),
// then transliterate Greek→Latin, normalise, and score names with Jaro-Winkler.

// ---- Greek → Latin transliteration -----------------------------------------
// Common digraphs first, then single letters (ELOT-743-ish, tuned for matching
// rather than perfect romanisation).
const GREEK_DIGRAPHS: [RegExp, string][] = [
  [/ου/g, 'ou'], [/αυ/g, 'av'], [/ευ/g, 'ev'], [/ηυ/g, 'iv'],
  [/μπ/g, 'b'], [/ντ/g, 'nt'], [/γκ/g, 'gk'], [/γγ/g, 'ng'],
  [/τζ/g, 'tz'], [/τσ/g, 'ts'],
];
const GREEK_LETTERS: Record<string, string> = {
  α: 'a', ά: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z',
  η: 'i', ή: 'i', θ: 'th', ι: 'i', ί: 'i', ϊ: 'i', ΐ: 'i', κ: 'k',
  λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'o', π: 'p', ρ: 'r',
  σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y', ϋ: 'y', ΰ: 'y', φ: 'f',
  χ: 'ch', ψ: 'ps', ω: 'o', ώ: 'o',
};

export function transliterateGreek(input: string): string {
  let s = (input || '').toLowerCase();
  for (const [re, rep] of GREEK_DIGRAPHS) s = s.replace(re, rep);
  let out = '';
  for (const ch of s) out += GREEK_LETTERS[ch] ?? ch;
  return out;
}

// Company/legal-form noise that shouldn't drive a name match.
const NAME_NOISE = /\b(ltd|limited|plc|λτδ|λτδ\.|co|company|the|και|and|&)\b/gi;

// Normalise a name to a comparable token-sorted Latin string.
export function normalizeName(input: string): string {
  let s = transliterateGreek(String(input ?? ''));
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip remaining accents
  s = s.toLowerCase().replace(NAME_NOISE, ' ');
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(Boolean).sort().join(' '); // order-independent
}

const cleanId = (v: unknown) => String(v ?? '').replace(/[\s\-_.]/g, '').toLowerCase();

// ---- Jaro-Winkler similarity (0..1) ----------------------------------------
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const maxDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aM = new Array(a.length).fill(false);
  const bM = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

// ---- matching ---------------------------------------------------------------
export interface MatchCandidate { client: any; score: number; reason: string }

// Per-client email may be a string or text[] (migration 035). Normalise to a list.
const emailList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[;,]+/)).map((e) => cleanId(e)).filter(Boolean);

export interface MatchInput {
  name?: string;
  email?: string | string[];
  vat_number?: string;
  tax_number?: string;
  client_code?: string;
  phone?: string;
}

// Rank existing clients as candidate matches for an incoming record. Strong
// identifiers score ~1.0; otherwise the best transliterated name similarity.
export function rankClientMatches(
  rec: MatchInput,
  clients: any[],
  opts: { nameThreshold?: number; limit?: number } = {},
): MatchCandidate[] {
  const nameThreshold = opts.nameThreshold ?? 0.82;
  const limit = opts.limit ?? 5;

  const recEmails = emailList(rec.email);
  const recVat = cleanId(rec.vat_number ?? rec.tax_number);
  const recCode = cleanId(rec.client_code);
  const recPhone = cleanId(rec.phone);
  const recName = normalizeName(rec.name ?? '');

  const out: MatchCandidate[] = [];
  for (const c of clients) {
    let score = 0;
    let reason = '';
    if (recEmails.length && emailList(c.email).some((e) => recEmails.includes(e))) {
      score = 1; reason = 'email match';
    } else if (recVat && cleanId(c.vat_number ?? c.tax_number) === recVat) {
      score = 0.99; reason = 'tax number match';
    } else if (recCode && cleanId(c.client_code) === recCode) {
      score = 0.97; reason = 'client code match';
    } else if (recPhone && cleanId(c.phone) === recPhone) {
      score = 0.9; reason = 'phone match';
    } else if (recName) {
      const s = Math.max(
        jaroWinkler(recName, normalizeName(c.name ?? '')),
        jaroWinkler(recName, normalizeName(c.name_tax_office ?? '')),
      );
      if (s >= nameThreshold) { score = s; reason = `name ${Math.round(s * 100)}%`; }
    }
    if (score > 0) out.push({ client: c, score, reason });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const bestClientMatch = (rec: MatchInput, clients: any[]): MatchCandidate | null =>
  rankClientMatches(rec, clients, { limit: 1 })[0] ?? null;
