// Supabase-backed API layer. Preserves the shape of the old Express api
// so existing components keep working. All data access goes through the
// Supabase client with RLS enforcing per-client access.
import { supabase } from '../lib/supabase';
import { clientCodePrefix } from './clientCode';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ---- Email column boundary translation (migration 035 made clients.email text[]) ----
// Forms and display code work with a "; "-joined string; the DB stores text[].
// These two helpers translate at the API boundary so callers don't have to care.
function normaliseClientForRead(c: any): any {
  if (!c) return c;
  const out: any = { ...c };
  if (Array.isArray(c.email)) out.email = c.email.join('; ');
  // tags: keep as array — UI components handle chip rendering directly.
  return out;
}
function normaliseClientForWrite(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const out: any = { ...data };
  if (typeof out.email === 'string') {
    const parts = out.email.split(/[;,]+/).map((p: string) => p.trim()).filter(Boolean);
    out.email = parts.length === 0 ? null : parts;
  }
  // Tags coming in as a comma-separated string from a text input
  if (typeof out.tags === 'string') {
    const parts = out.tags.split(/[,;]+/).map((p: string) => p.trim()).filter(Boolean);
    out.tags = parts;  // empty array is fine — preserves the "no tags" state
  }
  return out;
}

// Call a Supabase Edge Function with the current user's JWT.
async function adminFn(pathSuffix: string, method: string, body?: any): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users${pathSuffix}`, {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

// ---------- Types returned to app code ----------
export type UserRole = 'owner' | 'supervisor' | 'admin' | 'staff' | 'client';

export interface ClientAddress {
  id: number;
  client_id: number;
  address_type: 'registered' | 'trading' | 'postal' | 'home';
  line1: string | null;
  line2: string | null;
  line3: string | null;
  office: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  notes: string | null;
  is_linked_to_registered: boolean;
  created_at: string;
  updated_at: string;
}

// One file attached to a client onboarding submission (migration 123).
export interface IntakeAttachment {
  name: string;
  mime: string;
  size: number;
  kind: string;            // 'id' | 'passport' | 'proof_of_address' | 'other' | …
  storage_path: string;
  uploaded_at: string;
}

export interface AuthUser {
  id: string;                 // auth.users.id (uuid)
  username: string;
  display_name: string;
  email: string;
  role: UserRole;
  client_id: number | null;   // convenience: first linked client
  client_ids: number[];
  permissions: string[];      // effective permissions (role defaults ± per-user overrides)
  tos_accepted_version: number; // latest Terms version this user has accepted
}

// True if the user effectively has the given permission key.
// Use this anywhere we previously gated by role.
export function hasPermission(user: AuthUser | null | undefined, perm: string): boolean {
  if (!user) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

// True for any internal-firm role (owner, supervisor, admin, staff).
// Use this anywhere the UI used to gate on `user?.role === 'admin'`.
export function isStaffRole(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'owner' || user.role === 'supervisor'
      || user.role === 'admin' || user.role === 'staff';
}

// True for the leadership tier (owner + supervisor). Used for the
// destructive / sensitive operations: credentials, audit log, soft-delete.
export function isSupervisorOrHigher(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'owner' || user.role === 'supervisor';
}

// True for owner only. Used for user management.
export function isOwner(user: AuthUser | null | undefined): boolean {
  return !!user && user.role === 'owner';
}

// Display label for a role.
export function roleLabel(role: UserRole | undefined): string {
  switch (role) {
    case 'owner':      return 'Owner';
    case 'supervisor': return 'Supervisor';
    case 'admin':      return 'Administrator';
    case 'staff':      return 'Staff';
    case 'client':     return 'Client';
    default:           return '—';
  }
}

// ---------- System folders (matches old server/routes/folderRoutes.ts) ----------
const SYSTEM_FOLDERS: { name: string; category_key: string }[] = [
  { name: 'KYC Documents', category_key: 'kyc' },
  { name: 'Contracts', category_key: 'contracts' },
  { name: 'Agreements', category_key: 'agreements' },
  { name: 'Company Records', category_key: 'company_records' },
  { name: 'Audited Accounts', category_key: 'audited_accounts' },
  { name: 'Scanned Invoices', category_key: 'scanned' },
  { name: 'Issued Invoices (to Client)', category_key: 'issued_invoices' },
  { name: 'Other', category_key: 'other' },
];
const JOURNAL_SUBFOLDERS = [
  { name: 'INP — Purchase Invoices', category_key: 'scanned_INP' },
  { name: 'INS — Sales Invoices', category_key: 'scanned_INS' },
  { name: 'PM — Bank Payments', category_key: 'scanned_PM' },
  { name: 'DEP — Deposits', category_key: 'scanned_DEP' },
  { name: 'JV — Journals', category_key: 'scanned_JV' },
];

// Per-client lock so concurrent callers don't each trigger the seed
const seedingPromises = new Map<number, Promise<void>>();

// Load the folder template from the DB (migration 091). If the table doesn't
// exist yet or the read fails, fall back to the hardcoded arrays so the app
// keeps seeding correctly during/before the migration is applied.
//
// Cached for the session: the template is firm-wide static data, and seeding
// (its only caller now) would otherwise re-fetch it for every new client.
type FolderTemplate = {
  top: { name: string; category_key: string }[];
  sub: { name: string; category_key: string }[];
};
let folderTemplateCache: Promise<FolderTemplate> | null = null;

async function loadFolderTemplate(): Promise<FolderTemplate> {
  if (folderTemplateCache) return folderTemplateCache;
  folderTemplateCache = (async () => {
    try {
      const { data, error } = await supabase.from('folder_template')
        .select('category_key, name, parent_key, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error || !data || data.length === 0) throw new Error('empty');
      const top = data.filter((r: any) => !r.parent_key).map((r: any) => ({ name: r.name, category_key: r.category_key }));
      const sub = data.filter((r: any) =>  r.parent_key === 'scanned').map((r: any) => ({ name: r.name, category_key: r.category_key }));
      return { top, sub };
    } catch {
      // Don't pin the fallback for the whole session — if the table appears
      // later (migration just applied), the next call retries the DB.
      folderTemplateCache = null;
      return { top: SYSTEM_FOLDERS, sub: JOURNAL_SUBFOLDERS };
    }
  })();
  return folderTemplateCache;
}

async function seedSystemFolders(clientId: number): Promise<void> {
  const existing = seedingPromises.get(clientId);
  if (existing) return existing;

  const p = (async () => {
    const tpl = await loadFolderTemplate();
    // Read what's already there and only insert the missing keys. Avoids the
    // upsert/partial-unique-index inference issue that was creating duplicates.
    const { data: existingRows } = await supabase.from('folders')
      .select('category_key')
      .eq('client_id', clientId)
      .eq('is_system', true);
    const existingKeys = new Set((existingRows || []).map((r: any) => r.category_key));

    const topRowsToInsert = tpl.top
      .filter(f => !existingKeys.has(f.category_key))
      .map(f => ({
        client_id: clientId, name: f.name, category_key: f.category_key, is_system: true,
      }));
    if (topRowsToInsert.length > 0) {
      await supabase.from('folders').insert(topRowsToInsert);
    }

    // Use the lowest-id "scanned" row as the canonical parent in case legacy duplicates exist.
    const { data: scannedRows } = await supabase.from('folders').select('id')
      .eq('client_id', clientId).eq('category_key', 'scanned').eq('is_system', true)
      .order('id', { ascending: true }).limit(1);
    const scanned = scannedRows?.[0];
    if (scanned) {
      const subRowsToInsert = tpl.sub
        .filter(sf => !existingKeys.has(sf.category_key))
        .map(sf => ({
          client_id: clientId, parent_id: scanned.id, name: sf.name, category_key: sf.category_key, is_system: true,
        }));
      if (subRowsToInsert.length > 0) {
        await supabase.from('folders').insert(subRowsToInsert);
      }
    }
  })();

  seedingPromises.set(clientId, p);
  try { await p; } finally { seedingPromises.delete(clientId); }
}

// AI cost logging. Rates are an ESTIMATE for claude-haiku-4-5 in USD per
// million tokens — verify against console.anthropic.com pricing; adjust here
// if the model or rates change. The Anthropic console stays authoritative.
const AI_RATE_INPUT_PER_MTOK = 1.0;   // USD / 1M input tokens
const AI_RATE_OUTPUT_PER_MTOK = 5.0;  // USD / 1M output tokens
const AI_MODEL = 'claude-haiku-4-5-20251001';

async function logAiUsage(usage: any, pages: number): Promise<void> {
  const inTok  = Number(usage?.input_tokens || 0);
  const outTok = Number(usage?.output_tokens || 0);
  if (!inTok && !outTok) return; // nothing to record
  const cost = (inTok / 1_000_000) * AI_RATE_INPUT_PER_MTOK + (outTok / 1_000_000) * AI_RATE_OUTPUT_PER_MTOK;
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('ai_usage').insert({
    user_id: user?.id, source: 'extract-document', model: AI_MODEL,
    input_tokens: inTok, output_tokens: outTok,
    estimated_cost: Math.round(cost * 100000) / 100000, pages,
  });
}

async function getJournalFolderId(clientId: number, journalCode: string): Promise<number | null> {
  await seedSystemFolders(clientId);
  const key = `scanned_${journalCode}`;
  const known = JOURNAL_SUBFOLDERS.map(f => f.category_key);
  const lookup = known.includes(key) ? key : 'scanned';
  const { data } = await supabase.from('folders').select('id')
    .eq('client_id', clientId).eq('category_key', lookup).eq('is_system', true).single();
  return data?.id || null;
}

// ---------- Reference-data cache ----------
// Categories and cities are small, firm-wide lists that change rarely, yet each
// was refetched from scratch on every mount of every component that shows them
// (three apiece). The cached value is the in-flight promise, so components that
// mount at the same time share a single request instead of racing.
const lookupCache = new Map<string, Promise<any[]>>();

function cachedLookup(key: string, fetcher: () => Promise<any[]>): Promise<any[]> {
  let hit = lookupCache.get(key);
  if (!hit) {
    // Drop a rejected fetch so the next caller retries rather than being handed
    // the same failure forever.
    hit = fetcher().catch(err => { lookupCache.delete(key); throw err; });
    lookupCache.set(key, hit);
  }
  // Hand out a copy: callers that sort or splice the result would otherwise
  // corrupt the cached array for everyone else.
  return hit.then(rows => [...rows]);
}

// Called after any write to a cached table, so the next read re-fetches.
function invalidateLookup(prefix: string) {
  for (const key of Array.from(lookupCache.keys())) {
    if (key.startsWith(prefix)) lookupCache.delete(key);
  }
}

async function getClientIdsForUser(uid: string): Promise<number[]> {
  const { data } = await supabase.from('user_clients').select('client_id').eq('user_id', uid);
  return (data || []).map((r: any) => r.client_id);
}

// Batched form of the above, for when we need the links for many users at once.
// Replaces a per-user query loop (N+1). Paged explicitly rather than issuing one
// unbounded .in(): a single large query would be silently truncated if
// PostgREST's max-rows is configured, whereas the per-user queries never came
// near that ceiling. Errors are swallowed, matching getClientIdsForUser — a
// failed lookup yields no links rather than breaking the calling page.
async function getClientIdsByUser(uids: string[]): Promise<Map<string, number[]>> {
  const byUser = new Map<string, number[]>();
  if (!uids.length) return byUser;

  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_clients')
      .select('user_id, client_id')
      .in('user_id', uids)
      .range(from, from + PAGE - 1);
    if (error) break;
    for (const r of (data || []) as any[]) {
      const list = byUser.get(r.user_id);
      if (list) list.push(r.client_id);
      else byUser.set(r.user_id, [r.client_id]);
    }
    if (!data || data.length < PAGE) break;
  }
  return byUser;
}

// ---------- Vendor pattern helpers ----------
function normalizeVendor(name: string): string {
  return (name || '').toUpperCase().replace(/\b(LTD|LIMITED|LLC|SA|AE|EE|OE|CO|COMPANY|INC|CORP)\b/g, '')
    .replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function learnFromInvoice(clientId: number, vendorName: string, data: any): Promise<void> {
  if (!vendorName) return;
  const normalized = normalizeVendor(vendorName);
  const first = data?.journal_lines?.[0] || {};
  const total = Number(data?.total_amount || 0);
  const vatAmt = Number(first.vat_amount || 0);
  const netAmt = total - vatAmt;
  const vat_rate = netAmt > 0 ? Math.round((vatAmt / netAmt) * 100) : 0;

  const { data: existing } = await supabase.from('vendor_patterns')
    .select('*').eq('client_id', clientId).eq('vendor_name_normalized', normalized).maybeSingle();
  const patch = {
    client_id: clientId,
    vendor_name_normalized: normalized,
    vendor_name_original: vendorName,
    debit_account: first.debit_account || '',
    credit_account: first.credit_account || '',
    vat_code: first.vat_code || '',
    vat_rate,
    journal_type: data?.journal || '',
    details_template: first.details || '',
    match_count: (existing?.match_count || 0) + 1,
    last_used: new Date().toISOString(),
  };
  if (existing) await supabase.from('vendor_patterns').update(patch).eq('id', existing.id);
  else await supabase.from('vendor_patterns').insert(patch);
}

// ---------- Cyprus VAT period helpers ----------
// Cyprus VAT period groups (quarterly):
//   Group 1: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec
//   Group 2: Feb–Apr, May–Jul, Aug–Oct, Nov–Jan
//   Group 3: Mar–May, Jun–Aug, Sep–Nov, Dec–Feb
// Filing/payment due 40 days after period end → 10th of the 2nd month after period end.

// -----------------------------------------------------------------
// File-type validation by magic bytes (file signature).
// Reads the first 16 bytes of the file and compares against known
// signatures. Trusting the browser's claimed Content-Type is unsafe
// (any user can rename .exe → .pdf and the browser happily reports
// "application/pdf"), so we read the actual content here.
//
// LIMITATION: this is client-side only. A determined attacker who
// calls Supabase Storage's REST API directly with a crafted
// Content-Type header can still bypass this. Storage RLS limits
// blast radius (uploads only land in folders the user has access
// to), but a true belt-and-braces fix would be server-side
// validation in an edge function. Flagged as a Phase-2 task.
// -----------------------------------------------------------------
const ALLOWED_TYPES_DESCRIPTION = 'PDF, JPG, PNG, HEIC, or XML';

async function detectAllowedFileType(file: File): Promise<{ ok: boolean; type: string; reason?: string }> {
  if (!file.size) return { ok: false, type: 'empty', reason: 'File is empty.' };

  const buffer = await file.slice(0, 16).arrayBuffer();
  const b = new Uint8Array(buffer);
  if (b.length < 4) return { ok: false, type: 'too_small', reason: 'File is too small to identify.' };

  // PDF: "%PDF-"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D) {
    return { ok: true, type: 'pdf' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    return { ok: true, type: 'png' };
  }
  // JPEG (any variant): FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    return { ok: true, type: 'jpeg' };
  }
  // HEIC / HEIF / AVIF: bytes 4-7 = "ftyp"; subtype at 8-11
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const subtype = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'hevc', 'heis', 'avif'].includes(subtype)) {
      return { ok: true, type: 'heic' };
    }
  }
  // XML: plain-text, browser-viewable. Allowed so TaxisNet tax-return exports
  // can be filed in a client's Documents folder. Accept a leading UTF-8 BOM
  // (EF BB BF) or whitespace before the "<?xml" / "<" opening.
  {
    let i = 0;
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) i = 3; // skip BOM
    while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0A || b[i] === 0x0D)) i++;
    if (b[i] === 0x3C) { // '<'  — "<?xml" declaration or a root element
      const isXmlName = file.name.toLowerCase().endsWith('.xml');
      const isXmlDecl = b[i + 1] === 0x3F; // '<?'
      if (isXmlName || isXmlDecl) return { ok: true, type: 'xml' };
    }
  }

  // Note: we DO NOT allow ZIP-based files (XLSX, DOCX, ZIP). They can't be
  // previewed in the browser, only downloaded — the user wants every uploaded
  // file to be viewable in-app, so we reject them here.

  return { ok: false, type: 'unknown', reason: `File type not viewable in the browser. Allowed: ${ALLOWED_TYPES_DESCRIPTION}.` };
}

// Sanitize a single segment of a storage path. Supabase Storage object keys
// are restricted to ASCII alphanumerics + dot/dash/underscore (plus '/' for
// folders, which we handle separately). Anything else — Unicode (Greek,
// Cyrillic etc.), spaces, ampersands, parens — gets replaced with '_' so
// the upload doesn't fail with "Invalid key".
//
// The displayed filename in the documents table is the ORIGINAL f.name,
// so users still see the proper text in the UI; this only affects the
// internal storage path.
function safeStorageSegment(input: unknown): string {
  const s = (input == null ? '' : String(input)).trim();
  if (!s) return 'unnamed';
  const cleaned = s
    // Replace anything that isn't ASCII alphanumeric, dot, dash, or underscore
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Collapse runs of underscores so the result is readable
    .replace(/_+/g, '_')
    // Block path-traversal: drop runs of dots (also covers '..')
    .replace(/\.\.+/g, '_')
    // Trim leading/trailing punctuation so we don't end up with "_xxx" or "xxx."
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 200);
  return cleaned || 'unnamed';
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeVatPeriods(group: 1 | 2 | 3, today: Date, lookbackQ: number, lookaheadQ: number) {
  const offset = group - 1; // 0..2 — months index within a 3-month cycle that the group's quarters start on
  const M = today.getMonth();
  const Y = today.getFullYear();
  const monthsSinceStart = ((M - offset) + 12) % 12;
  const monthsIntoQuarter = monthsSinceStart % 3;
  const currentStart = new Date(Y, M - monthsIntoQuarter, 1);

  const periods: { label: string; start: string; end: string; due: string }[] = [];
  for (let i = -lookbackQ; i < lookaheadQ; i++) {
    const start = new Date(currentStart.getFullYear(), currentStart.getMonth() + i * 3, 1);
    const end   = new Date(start.getFullYear(), start.getMonth() + 3, 0);   // last day of (start month + 2)
    const due   = new Date(end.getFullYear(),   end.getMonth() + 2, 10);    // 10th of (period end month + 2)

    const startMon = start.toLocaleString('en', { month: 'short' });
    const endMon   = end.toLocaleString('en', { month: 'short' });
    const label = start.getFullYear() === end.getFullYear()
      ? `${startMon}–${endMon} ${start.getFullYear()}`
      : `${startMon} ${start.getFullYear()} – ${endMon} ${end.getFullYear()}`;
    periods.push({ label, start: toIsoDate(start), end: toIsoDate(end), due: toIsoDate(due) });
  }
  return periods;
}

// ---------- Cyprus Social Insurance period helpers ----------
// Monthly contribution period; payment + return due by the end of the month
// FOLLOWING the contribution month (i.e. May 2026 contributions are due 30 Jun 2026).
function computeSocialInsurancePeriods(today: Date, lookbackMonths: number, lookaheadMonths: number) {
  const Y = today.getFullYear();
  const M = today.getMonth();
  const periods: { label: string; start: string; end: string; due: string }[] = [];
  for (let i = -lookbackMonths; i < lookaheadMonths; i++) {
    const start = new Date(Y, M + i, 1);
    const end   = new Date(start.getFullYear(), start.getMonth() + 1, 0); // last day of start month
    const due   = new Date(end.getFullYear(),   end.getMonth() + 2, 0);   // last day of next month
    const monName = start.toLocaleString('en', { month: 'short' });
    periods.push({
      label: `${monName} ${start.getFullYear()}`,
      start: toIsoDate(start),
      end:   toIsoDate(end),
      due:   toIsoDate(due),
    });
  }
  return periods;
}

// ---------- Cyprus IR7 (annual employer return) helpers ----------
// Annual return for the calendar year; due 31 May of the following year (electronic).
function computeIR7Periods(today: Date, lookbackYears: number, lookaheadYears: number) {
  const Y = today.getFullYear();
  const periods: { label: string; start: string; end: string; due: string }[] = [];
  for (let i = -lookbackYears; i < lookaheadYears; i++) {
    const year  = Y + i;
    const start = new Date(year,     0,  1);
    const end   = new Date(year,     11, 31);
    const due   = new Date(year + 1, 4,  31); // 31 May next year (month index 4)
    periods.push({
      label: `${year}`,
      start: toIsoDate(start),
      end:   toIsoDate(end),
      due:   toIsoDate(due),
    });
  }
  return periods;
}

// ---------- Cyprus Provisional Tax (Temporary Tax) helpers ----------
// Two installments per tax year: 31 July and 31 December.
function computeProvisionalTaxPeriods(asOf: Date, lookbackYears: number, lookaheadYears: number) {
  const Y = asOf.getFullYear();
  const periods: { label: string; start: string; end: string; due: string }[] = [];
  for (let i = -lookbackYears; i <= lookaheadYears; i++) {
    const year = Y + i;
    // 1st installment: covers Jan–Jun of the year, due 31 Jul
    periods.push({
      label: `${year} — 1st installment`,
      start: toIsoDate(new Date(year, 0,  1)),
      end:   toIsoDate(new Date(year, 5, 30)),
      due:   toIsoDate(new Date(year, 6, 31)),
    });
    // 2nd installment: covers Jul–Dec of the year, due 31 Dec
    periods.push({
      label: `${year} — 2nd installment`,
      start: toIsoDate(new Date(year,  6,  1)),
      end:   toIsoDate(new Date(year, 11, 31)),
      due:   toIsoDate(new Date(year, 11, 31)),
    });
  }
  return periods;
}

// ---------- Cyprus UBO (Beneficial Ownership) annual confirmation ----------
// Universal annual deadline: 31 December every year.
function computeUboPeriods(asOf: Date, lookbackYears: number, lookaheadYears: number) {
  const Y = asOf.getFullYear();
  const periods: { label: string; start: string; end: string; due: string }[] = [];
  for (let i = -lookbackYears; i <= lookaheadYears; i++) {
    const year = Y + i;
    periods.push({
      label: `UBO — ${year}`,
      start: toIsoDate(new Date(year,  0,  1)),
      end:   toIsoDate(new Date(year, 11, 31)),
      due:   toIsoDate(new Date(year, 11, 31)),
    });
  }
  return periods;
}

// ---------- Cyprus HE32 (Annual Return to Registrar) helpers ----------
// Per-company anniversary. We approximate due date as
// (incorporation anniversary + 28 days) — close enough; real Cyprus
// rules around AGM date are more nuanced but this catches the spirit.
function computeHE32Periods(asOf: Date, incorporation: Date, lookbackYears: number, lookaheadYears: number) {
  const Y = asOf.getFullYear();
  const incY = incorporation.getFullYear();
  const incM = incorporation.getMonth();
  const incD = incorporation.getDate();
  const periods: { label: string; start: string; end: string; due: string }[] = [];
  for (let i = -lookbackYears; i <= lookaheadYears; i++) {
    const year = Y + i;
    if (year < incY) continue;          // skip years before the company existed
    const anniversary = new Date(year, incM, incD);
    const due         = new Date(year, incM, incD + 28);  // Date ctor handles month overflow
    periods.push({
      label: `HE32 — ${year}`,
      start: toIsoDate(new Date(year, 0,  1)),
      end:   toIsoDate(new Date(year, 11, 31)),
      due:   toIsoDate(due),
      // anniversary unused but kept here in case we want to display it later
      _anniversary: toIsoDate(anniversary),
    } as any);
  }
  return periods;
}

// Batch month from DD/MM/YYYY → YYYY-MM
function toBatchMonth(d: string): string {
  if (!d) return '';
  const parts = d.split('/');
  return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}` : '';
}

// ---------- Public API ----------
export const api = {
  // --------- Auth ---------
  async login(emailOrUsername: string, password: string) {
    const email = emailOrUsername.includes('@') ? emailOrUsername : `${emailOrUsername}@placeholder.local`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const user = await api.me();
    return { user: user.user };
  },

  async sendMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/' },
    });
    if (error) throw new Error(error.message);
  },

  async logout() {
    // Reference data is firm-wide, but RLS still scopes what a session can see —
    // don't let the next user on this browser inherit the previous one's rows.
    lookupCache.clear();
    await supabase.auth.signOut();
  },

  async me(): Promise<{ user: AuthUser | null }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { user: null };
    const uid = session.user.id;
    const [{ data: prof }, client_ids, permsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      getClientIdsForUser(uid),
      supabase.rpc('get_my_permissions'),
    ]);
    if (!prof) return { user: null };
    return {
      user: {
        id: uid,
        email: session.user.email || '',
        username: prof.username || '',
        display_name: prof.full_name || prof.username || '',
        role: prof.role,
        client_ids,
        client_id: client_ids[0] ?? null,
        permissions: (permsResult.data as string[]) || [],
        tos_accepted_version: (prof as any).tos_accepted_version ?? 0,
      },
    };
  },

  async acceptTos(version: number) {
    const { error } = await supabase.rpc('accept_tos', { p_version: version });
    if (error) throw new Error(error.message);
  },

  // Users admin — limited without service role key. Creating and deleting auth users requires
  // the admin to do it via Supabase dashboard for now. We expose listing + profile updates.
  async getUsers() {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    // Fold in linked client ids. Previously one query per user, awaited in
    // sequence — N+1 round trips for N users, and this runs uncached on the
    // mount of every component that lists staff.
    const profiles = (data || []) as any[];
    const idsByUser = await getClientIdsByUser(profiles.map(p => p.id));
    return profiles.map(p => ({
      id: p.id, username: p.username, display_name: p.full_name || p.username,
      role: p.role, active: p.active, created_at: p.created_at,
      hourly_rate: p.hourly_rate ?? null,
      client_ids: idsByUser.get(p.id) || [],
    }));
  },

  async createUser(data: { email: string; password: string; username?: string; display_name?: string; role?: 'admin' | 'client'; client_ids?: number[] }) {
    return adminFn('', 'POST', {
      email: data.email, password: data.password,
      username: data.username, full_name: data.display_name,
      role: data.role, client_ids: data.client_ids,
    });
  },

  async updateUser(id: string, data: any) {
    const patch: any = {};
    if (data.role) patch.role = data.role;
    if (data.display_name !== undefined) patch.full_name = data.display_name;
    if (data.active !== undefined) patch.active = data.active;
    if (data.username !== undefined) patch.username = data.username;
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) throw new Error(error.message);

    if (Array.isArray(data.client_ids)) {
      await supabase.from('user_clients').delete().eq('user_id', id);
      if (data.client_ids.length) {
        await supabase.from('user_clients').insert(
          data.client_ids.map((cid: number) => ({ user_id: id, client_id: cid })),
        );
      }
    }
  },

  async deleteUser(id: string) {
    return adminFn(`/${id}`, 'DELETE');
  },

  async resetUserPassword(id: string, password: string) {
    return adminFn(`/${id}/password`, 'PATCH', { password });
  },

  async inviteClient(data: { email: string; full_name?: string; client_id: number }) {
    return adminFn('/invite', 'POST', {
      email: data.email,
      full_name: data.full_name,
      client_id: data.client_id,
    });
  },

  // --------- Client self-signup applications ---------
  async submitApplication(payload: Record<string, any>) {
    const { data, error } = await supabase.functions.invoke('submit-application', { body: payload });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || 'Submission failed.');
    return data;
  },
  async getApplications(status?: string) {
    let q = supabase.from('portal_applications').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },
  async updateApplication(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('portal_applications').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Clients ---------
  // After migration 035, clients.email is text[]. To keep frontend code (forms,
  // displays) working with a string, translate at the API boundary: arrays come
  // out as "; "-joined strings on read; strings go in as arrays on write.
  async getClients() {
    const { data, error } = await supabase.from('clients').select('*').order('name');
    if (error) throw new Error(error.message);
    return (data || []).map((c: any) => normaliseClientForRead(c));
  },

  async getClient(id: number) {
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data ? normaliseClientForRead(data) : data;
  },

  async createClient(data: any) {
    // Normalise before insert — clients.email/tags are arrays (text[]), but the
    // Add Client form supplies them as plain strings (and always carries an
    // email key, even when blank). Without this the insert sends a string into
    // a text[] column and Postgres rejects it, so every add fails.
    const patch = normaliseClientForWrite(data);
    const { data: row, error } = await supabase.from('clients').insert(patch).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  // Part 6C — quick-create a pure vendor from the invoice editor.
  async quickCreateVendor(payload: { name: string; tax_number?: string; email?: string; phone?: string }) {
    const { code } = await api.getNextClientCode(payload.name, 'company');
    const email = (payload.email || '').trim();
    const { data: row, error } = await supabase.from('clients').insert({
      client_code:     code,
      name:            payload.name.trim(),
      tax_number:      (payload.tax_number || '').trim() || null,
      phone:           (payload.phone || '').trim() || null,
      email:           email ? [email] : null,   // clients.email is text[]
      client_category: 'vendor_only',
      client_status:   'active',
      is_active:       true,
      status:          'active',
      is_vendor:       true,
    }).select('id, name, client_code').single();
    if (error) throw new Error(error.message);
    return row;
  },

  async updateClient(id: number, data: any) {
    const patch = normaliseClientForWrite(data);
    const { error } = await supabase.from('clients').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async selfUpdateClient(id: number, data: any) {
    // Client role: whitelist of fields only
    const allowed = ['address','phone','email','mobile','contact_person','website','city','postal_code','country'];
    const patch: any = {};
    for (const k of allowed) if (k in data) patch[k] = data[k];
    Object.assign(patch, normaliseClientForWrite(patch));
    const { error } = await supabase.from('clients').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteClient(id: number) {
    // Soft-delete via SECURITY DEFINER RPC — sidesteps an RLS edge case
    // where the post-update row state failed a permissive WITH CHECK
    // clause on the linked-user UPDATE policy. The audit trigger still
    // fires on the underlying UPDATE.
    const { error } = await supabase.rpc('soft_delete_client', { p_id: id });
    if (error) throw new Error(error.message);
  },

  async restoreClient(id: number) {
    const { error } = await supabase.rpc('restore_client', { p_id: id });
    if (error) throw new Error(error.message);
  },

  async getDeletedClients() {
    const { data, error } = await supabase.rpc('list_deleted_clients');
    if (error) throw new Error(error.message);
    return (data as any[]) || [];
  },

  // Permanently delete soft-deleted clients (owner-only + MFA, see migration 057).
  async hardDeleteClients(ids: number[]) {
    const { data, error } = await supabase.rpc('hard_delete_clients', { p_ids: ids });
    if (error) throw new Error(error.message);
    return data as { deleted: number; skipped: any[] };
  },

  async mergeClient(targetId: number, sourceId: number, fields?: Record<string, string>) {
    const { data, error } = await supabase.rpc('merge_clients', {
      p_target:    targetId,
      p_source:    sourceId,
      p_overrides: fields ?? {},
    });
    if (error) throw new Error(error.message);
    return data;
  },

  // CO-ALP-001 / IND-GEO-002 / PART-XYZ-001 — see services/clientCode.ts.
  // The counter runs per three-letter group, so only codes sharing this exact
  // prefix are scanned. Existing 221XXXNNN and PC-CO-NNN codes never match a
  // new prefix, so they are neither renumbered nor counted.
  //
  // The old implementation did .replace(/[^A-Z]/g, '') on an uppercased name,
  // which discarded Greek entirely — every Greek-named client fell through to
  // the padding and collapsed onto the same 221XXX prefix.
  async getNextClientCode(name: string, clientType?: string | null) {
    const prefix = clientCodePrefix(name, clientType);
    const { data } = await supabase.from('clients').select('client_code').like('client_code', `${prefix}%`);
    const max = (data || []).reduce((m: number, r: any) => {
      const n = parseInt((r.client_code || '').slice(prefix.length), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return { code: `${prefix}${String(max + 1).padStart(3, '0')}` };
  },

  // --------- Client couples (spouse billing link) ---------
  // Two individual clients whose fees go out on one invoice in the payer's
  // name. Records, folders and documents stay entirely separate — see
  // migration 135. Not to be confused with mergeClient, which destroys one.
  async getClientCouple(clientId: number) {
    const { data, error } = await supabase
      .from('client_couples')
      .select('*, a:clients!client_a_id(id, name, client_code), b:clients!client_b_id(id, name, client_code)')
      .or(`client_a_id.eq.${clientId},client_b_id.eq.${clientId}`)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row: any = data;
    // Resolve the pair from the caller's point of view so the UI doesn't have
    // to care which side of the stored (a < b) ordering it landed on.
    const isA = row.client_a_id === clientId;
    const partner = isA ? row.b : row.a;
    return {
      id: row.id as number,
      partner_id: partner?.id ?? null,
      partner_name: partner?.name ?? null,
      partner_code: partner?.client_code ?? null,
      payer_client_id: row.payer_client_id as number,
      this_client_pays: row.payer_client_id === clientId,
      notes: row.notes as string | null,
    };
  },

  async linkClientCouple(clientId: number, partnerId: number, payerClientId: number, notes?: string | null) {
    if (clientId === partnerId) throw new Error('A client cannot be linked to itself.');
    if (payerClientId !== clientId && payerClientId !== partnerId) {
      throw new Error('The payer must be one of the two linked clients.');
    }
    // The table stores the pair with the lower id first; the trigger rejects a
    // client that is already half of another couple.
    const [a, b] = clientId < partnerId ? [clientId, partnerId] : [partnerId, clientId];
    const { data, error } = await supabase
      .from('client_couples')
      .insert({ client_a_id: a, client_b_id: b, payer_client_id: payerClientId, notes: notes || null })
      .select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async setCouplePayer(coupleId: number, payerClientId: number) {
    const { error } = await supabase
      .from('client_couples')
      .update({ payer_client_id: payerClientId })
      .eq('id', coupleId);
    if (error) throw new Error(error.message);
  },

  async unlinkClientCouple(coupleId: number) {
    const { error } = await supabase.from('client_couples').delete().eq('id', coupleId);
    if (error) throw new Error(error.message);
  },

  // GDPR Article 15/20 — assemble the personal data held about one client into
  // a single machine-readable bundle. Staff-triggered and audit-logged (the
  // export itself is an accountable event). Credential PASSWORDS are never
  // included — getCredentials already strips the ciphertext; we re-shape here
  // to make that explicit.
  async exportClientData(clientId: number) {
    const [
      client, addresses, directors, directorships, services,
      notes, documents, taxFilings, emails, credentials, purchaseInvoices,
    ] = await Promise.all([
      api.getClient(clientId).catch(() => null),
      api.getClientAddresses(clientId).catch(() => []),
      api.getClientDirectors(clientId).catch(() => []),
      api.getDirectorshipsForClient(clientId).catch(() => []),
      api.getClientServices(clientId).catch(() => []),
      api.getClientNotes(clientId).catch(() => []),
      api.getDocuments({ client_id: String(clientId) }).catch(() => []),
      api.getClientTaxFilings(clientId).catch(() => []),
      api.getClientEmails(clientId).catch(() => []),
      api.getCredentials(clientId).catch(() => []),
      api.getInvoices({ client_id: String(clientId) }).catch(() => []),
    ]);

    const safeCredentials = (credentials as any[]).map(c => ({
      platform: c.platform, username: c.username,
      url: c.effective_url ?? c.url ?? null, notes: c.notes,
      has_stored_password: !!c.has_password,
    }));

    const { data: { user } } = await supabase.auth.getUser();
    const bundle = {
      _meta: {
        export_type: 'gdpr_client_data',
        client_id: clientId,
        exported_at: new Date().toISOString(),
        exported_by: user?.email ?? user?.id ?? null,
        note: 'Personal data held about this client. Passwords for stored credentials are deliberately excluded.',
      },
      client,
      addresses,
      directors,
      directorships,
      services,
      notes,
      documents,
      tax_filings: taxFilings,
      emails,
      credentials: safeCredentials,
      purchase_invoices: purchaseInvoices,
    };

    await api.logAction('client.data_export', 'clients', clientId, {
      client_name: (client as any)?.name ?? null,
      sections: Object.keys(bundle).filter(k => k !== '_meta'),
    });

    return bundle;
  },

  async generateMissingCodes() {
    // surname/legal_name mirror what the Add Client form feeds the generator,
    // so a backfilled code matches what the form would have produced.
    const { data } = await supabase.from('clients')
      .select('id, name, client_code, client_type, surname, legal_name')
      .or('client_code.is.null,client_code.eq.');
    let updated = 0;
    for (const c of data || []) {
      const basis = c.client_type === 'individual'
        ? (c.surname || c.name)
        : (c.legal_name || c.name);
      const { code } = await api.getNextClientCode(basis, c.client_type);
      await supabase.from('clients').update({ client_code: code }).eq('id', c.id);
      updated++;
    }
    return { updated };
  },

  // --------- Chart of Accounts ---------
  async getAccounts(clientId: number) {
    const { data, error } = await supabase.from('accounts').select('*').eq('client_id', clientId).order('code');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async createAccount(clientId: number, data: any) {
    const { data: row, error } = await supabase.from('accounts').insert({ ...data, client_id: clientId }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },
  async updateAccount(_clientId: number, accId: number, data: any) {
    const { error } = await supabase.from('accounts').update(data).eq('id', accId);
    if (error) throw new Error(error.message);
  },
  async deleteAccount(_clientId: number, accId: number) {
    const { error } = await supabase.from('accounts').delete().eq('id', accId);
    if (error) throw new Error(error.message);
  },
  async copyAccounts(targetId: number, sourceId: number) {
    const { data } = await supabase.from('accounts').select('code, description, category, active, is_header, report_category').eq('client_id', sourceId);
    if (!data?.length) return { copied: 0 };
    await supabase.from('accounts').insert(data.map((a: any) => ({ ...a, client_id: targetId })));
    return { copied: data.length };
  },

  // --------- Master Chart of Accounts (firm-level, migration 097) ---------
  async getMasterAccounts() {
    const { data, error } = await supabase.from('master_accounts').select('*').order('code');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async createMasterAccount(data: { code: string; description: string; category: string; active?: boolean; is_header?: boolean; report_category?: string | null }) {
    const { data: row, error } = await supabase.from('master_accounts').insert(data).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },
  async updateMasterAccount(id: number, data: any) {
    const { error } = await supabase.from('master_accounts').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteMasterAccount(id: number) {
    const { error } = await supabase.from('master_accounts').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Copy the master into one client. Insert-if-not-exists by code.
  async applyMasterToClient(clientId: number): Promise<{ inserted: number; skipped: number }> {
    const { data, error } = await supabase.rpc('apply_master_to_client', { p_client_id: clientId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { inserted: row?.inserted ?? 0, skipped: row?.skipped ?? 0 };
  },
  // Copy the master into every (non-deleted) client. Supervisor-only.
  async applyMasterToAllClients(): Promise<{ totalInserted: number; totalSkipped: number; clientCount: number }> {
    const { data, error } = await supabase.rpc('apply_master_to_all_clients');
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<{ client_id: number; inserted: number; skipped: number }>;
    let totalInserted = 0, totalSkipped = 0;
    for (const r of rows) { totalInserted += r.inserted || 0; totalSkipped += r.skipped || 0; }
    return { totalInserted, totalSkipped, clientCount: rows.length };
  },

  // --------- Client Services (migration 098) ---------
  // Catalogue + stages — staff-readable, supervisor-writable.
  async getServiceDefinitions() {
    const { data, error } = await supabase
      .from('service_definitions').select('*').order('ordinal');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async getServiceStages() {
    const { data, error } = await supabase
      .from('service_stages').select('*').order('service_id').order('ordinal');
    if (error) throw new Error(error.message);
    return data || [];
  },
  // Deliverables per service (migration 106) — used by the engagement letter
  // builder to show sub-bullets that snapshot into the letter's services jsonb.
  async getServiceDeliverables() {
    const { data, error } = await supabase
      .from('service_deliverables').select('*')
      .eq('enabled', true)
      .order('service_id').order('ordinal');
    if (error) throw new Error(error.message);
    return data || [];
  },

  // ---------- Platform Sites (migration 110) ----------
  // Firm-level catalogue of the platforms (TFA, Ergani, JCC, etc.) that
  // we hold credentials for. Per-client credentials reference one of
  // these so the URL lives in one place.
  async getPlatformSites() {
    const { data, error } = await supabase
      .from('platform_sites').select('*')
      .order('ordinal').order('name');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async createPlatformSite(data: { name: string; url?: string | null; notes?: string | null; ordinal?: number; enabled?: boolean }) {
    const { data: row, error } = await supabase.from('platform_sites')
      .insert({ name: data.name, url: data.url || null, notes: data.notes || null,
                ordinal: data.ordinal ?? 0, enabled: data.enabled ?? true })
      .select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async updatePlatformSite(id: number, patch: any) {
    const { error } = await supabase.from('platform_sites')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deletePlatformSite(id: number) {
    const { error } = await supabase.from('platform_sites').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ---------- Client notes feed (migration 111) ----------
  // Returns notes newest-first, plus any tasks born from each note so the
  // UI can display the link inline. The author label is resolved with a
  // second query against profiles — PostgREST can't auto-embed because
  // created_by is FK'd to auth.users, not the public profiles view.
  async getClientNotes(clientId: number) {
    const { data: raw, error } = await supabase
      .from('client_notes').select('*')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const notes = raw || [];
    if (notes.length === 0) return notes;
    // Authors — one lookup for all the distinct user ids on the page.
    const userIds = Array.from(new Set(notes.map((n: any) => n.created_by).filter(Boolean)));
    let profileMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles').select('id, display_name, username')
        .in('id', userIds);
      for (const p of (profs || [])) profileMap.set(p.id, p);
    }
    // Linked tasks — single query so the chip strip renders inline.
    const ids = notes.map((n: any) => n.id);
    const { data: tasks } = await supabase
      .from('staff_tasks')
      .select('id, title, status, source_note_id')
      .in('source_note_id', ids);
    const byNote = new Map<number, any[]>();
    for (const t of (tasks || [])) {
      if (!byNote.has(t.source_note_id)) byNote.set(t.source_note_id, []);
      byNote.get(t.source_note_id)!.push(t);
    }
    return notes.map((n: any) => {
      const prof = n.created_by ? profileMap.get(n.created_by) : null;
      return {
        ...n,
        author_name: prof?.display_name || prof?.username || null,
        linked_tasks: byNote.get(n.id) || [],
      };
    });
  },
  async createClientNote(clientId: number, data: { body: string; needs_attention?: boolean; pinned?: boolean }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('client_notes').insert({
      client_id: clientId,
      body: data.body,
      needs_attention: data.needs_attention || false,
      pinned: data.pinned || false,
      created_by: session?.user?.id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async updateClientNote(id: number, patch: { body?: string; needs_attention?: boolean; pinned?: boolean }) {
    const { error } = await supabase.from('client_notes').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteClientNote(id: number) {
    // Soft delete — restore by clearing deleted_at, not wired into the UI yet.
    const { error } = await supabase.from('client_notes')
      .update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Promote a note to a staff task. The new task remembers source_note_id
  // so the note's UI can render the chip "→ Task #N".
  async createTaskFromNote(noteId: number, data: {
    title: string;
    client_id: number;
    description?: string;
    assigned_to?: string | null;
    due_date?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('staff_tasks').insert({
      title: data.title,
      description: data.description || null,
      client_id: data.client_id,
      assigned_to: data.assigned_to || null,
      due_date: data.due_date || null,
      priority: data.priority || 'medium',
      status: 'open',
      created_by: session?.user?.id || null,
      source_note_id: noteId,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async updateServiceStage(id: number, patch: any) {
    const { error } = await supabase.from('service_stages')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // ---- Services (catalogue) ----
  async createServiceDefinition(data: { key: string; label: string; description?: string | null; ordinal?: number }) {
    const { data: row, error } = await supabase.from('service_definitions').insert({
      key: data.key, label: data.label, description: data.description || null,
      ordinal: data.ordinal ?? 99, enabled: true,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async updateServiceDefinition(id: number, patch: any) {
    const { error } = await supabase.from('service_definitions')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteServiceDefinition(id: number) {
    const { error } = await supabase.from('service_definitions').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  // ---- Stages ----
  async createServiceStage(data: {
    service_id: number; key: string; label: string;
    cadence?: string; default_day_of_month?: number | null; default_use_last_day?: boolean;
    active_months?: number[] | null;
    sends_email?: boolean; creates_task?: boolean; task_priority?: string;
    ordinal?: number;
  }) {
    const { data: row, error } = await supabase.from('service_stages').insert({
      service_id: data.service_id, key: data.key, label: data.label,
      cadence: data.cadence || 'monthly',
      default_day_of_month: data.default_day_of_month ?? null,
      default_use_last_day: data.default_use_last_day ?? false,
      active_months: data.active_months ?? null,
      sends_email: data.sends_email ?? true,
      creates_task: data.creates_task ?? true,
      task_priority: data.task_priority || 'medium',
      ordinal: data.ordinal ?? 99,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async deleteServiceStage(id: number) {
    const { error } = await supabase.from('service_stages').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  // ---- Deliverables ----
  async createServiceDeliverable(data: { service_id: number; label: string; description?: string | null; ordinal?: number }) {
    const { data: row, error } = await supabase.from('service_deliverables').insert({
      service_id: data.service_id, label: data.label,
      description: data.description || null,
      ordinal: data.ordinal ?? 99, enabled: true,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async updateServiceDeliverable(id: number, patch: any) {
    const { error } = await supabase.from('service_deliverables')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteServiceDeliverable(id: number) {
    const { error } = await supabase.from('service_deliverables').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  async getServiceEmailTemplates() {
    const { data, error } = await supabase
      .from('service_email_templates').select('*');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async upsertServiceEmailTemplate(stageId: number, subject: string, body: string) {
    const { error } = await supabase.from('service_email_templates')
      .upsert({ service_stage_id: stageId, subject, body, updated_at: new Date().toISOString() },
              { onConflict: 'service_stage_id' });
    if (error) throw new Error(error.message);
  },

  // Per-client opt-in for a service.
  async getClientServices(clientId: number) {
    const { data, error } = await supabase
      .from('client_services').select('*').eq('client_id', clientId);
    if (error) throw new Error(error.message);
    return data || [];
  },
  async toggleClientService(clientId: number, serviceId: number, enabled: boolean) {
    const { error } = await supabase.from('client_services')
      .upsert({ client_id: clientId, service_id: serviceId, enabled, updated_at: new Date().toISOString() },
              { onConflict: 'client_id,service_id' });
    if (error) throw new Error(error.message);
  },
  async getClientStageOverrides(clientServiceId: number) {
    const { data, error } = await supabase
      .from('client_service_stage_overrides').select('*')
      .eq('client_service_id', clientServiceId);
    if (error) throw new Error(error.message);
    return data || [];
  },
  async upsertStageOverride(clientServiceId: number, stageId: number, patch: {
    day_of_month?: number | null; use_last_day?: boolean | null; skip?: boolean;
  }) {
    const { error } = await supabase.from('client_service_stage_overrides')
      .upsert({
        client_service_id: clientServiceId,
        service_stage_id: stageId,
        ...patch,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_service_id,service_stage_id' });
    if (error) throw new Error(error.message);
  },

  // Manual trigger for due schedules. Optional filters narrow what fires:
  //   serviceId — only this service (NULL = all services)
  //   clientIds — only these clients (NULL = every enabled client)
  // Returns how many runs/tasks were created.
  async runDueServiceSchedules(opts: {
    runDate?: string; serviceId?: number | null; clientIds?: number[] | null;
  } = {}): Promise<{ created_runs: number; created_tasks: number }> {
    const args: any = {};
    if (opts.runDate)   args.p_run_date   = opts.runDate;
    if (opts.serviceId) args.p_service_id = opts.serviceId;
    if (opts.clientIds && opts.clientIds.length > 0) args.p_client_ids = opts.clientIds;
    const { data, error } = await supabase.rpc('run_due_service_schedules', args);
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { created_runs: row?.created_runs ?? 0, created_tasks: row?.created_tasks ?? 0 };
  },

  // Dry-run: returns the stage firings that WOULD happen for the given
  // date + filters. Used by the Run Schedules modal to preview before
  // committing. already_fired=true rows show what's already been processed
  // this month (will be skipped on the real run).
  async previewDueServiceSchedules(opts: {
    runDate?: string; serviceId?: number | null; clientIds?: number[] | null;
  } = {}): Promise<Array<{
    client_id: number; client_name: string;
    service_label: string; stage_label: string;
    scheduled_date: string;
    would_send_email: boolean; would_create_task: boolean;
    already_fired: boolean;
  }>> {
    const args: any = {};
    if (opts.runDate)   args.p_run_date   = opts.runDate;
    if (opts.serviceId) args.p_service_id = opts.serviceId;
    if (opts.clientIds && opts.clientIds.length > 0) args.p_client_ids = opts.clientIds;
    const { data, error } = await supabase.rpc('preview_due_service_schedules', args);
    if (error) throw new Error(error.message);
    return data || [];
  },

  // List pending automated emails (service_runs.email_sent=false). The UI
  // walks this to fire send-via-outlook one row at a time.
  async getPendingServiceEmails() {
    const { data, error } = await supabase
      .from('v_pending_service_emails').select('*').order('scheduled_date');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async markServiceEmailSent(runId: number, error?: string) {
    const { error: e } = await supabase.from('service_runs')
      .update({ email_sent: !error, email_error: error || null, fired_at: new Date().toISOString() })
      .eq('id', runId);
    if (e) throw new Error(e.message);
  },

  // --------- Engagement Letters (migration 104) ---------
  async getEngagementLetters(clientId: number) {
    const { data, error } = await supabase.from('engagement_letters')
      .select('*').eq('client_id', clientId).order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async getEngagementLetter(id: number) {
    const { data, error } = await supabase.from('engagement_letters')
      .select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async getNextEngagementLetterVersion(clientId: number): Promise<number> {
    const { data, error } = await supabase.rpc('next_engagement_letter_version', { p_client_id: clientId });
    if (error) throw new Error(error.message);
    return (typeof data === 'number' ? data : (data?.[0] ?? 1));
  },
  async createEngagementLetter(clientId: number, body: {
    version: number;
    effective_from?: string | null;
    effective_to?: string | null;
    services: any[];
    total_annual_fee: number;
    currency?: string;
    intro_text?: string | null;
    terms_text?: string | null;
    notes?: string | null;
  }) {
    const { data: row, error } = await supabase.from('engagement_letters')
      .insert({ client_id: clientId, status: 'draft', currency: 'EUR', ...body })
      .select().single();
    if (error) throw new Error(error.message);
    return row;
  },
  async updateEngagementLetter(id: number, patch: any) {
    const { error } = await supabase.from('engagement_letters')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteEngagementLetter(id: number) {
    const { error } = await supabase.from('engagement_letters').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Stamp the letter as sent + record who/when/where. The PDF goes out via
  // sendViaOutlook (caller passes the prepared base64 attachment).
  async markEngagementLetterSent(id: number, toEmail: string) {
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('engagement_letters').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_to_email: toEmail,
      sent_by: session?.user?.id || null,
    }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async markEngagementLetterAccepted(id: number, opts: {
    method: 'email_reply' | 'portal_click';
    signature?: string;
    ip?: string;
    notes?: string;
  }) {
    const { error } = await supabase.from('engagement_letters').update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_method: opts.method,
      accepted_signature: opts.signature || null,
      accepted_ip: opts.ip || null,
      accepted_notes: opts.notes || null,
    }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Generate and store an accept_token if the letter doesn't have one yet.
  // Called right before send so the email link is ready.
  async ensureEngagementLetterToken(id: number): Promise<string> {
    const { data: existing } = await supabase.from('engagement_letters')
      .select('accept_token').eq('id', id).maybeSingle();
    if (existing?.accept_token) return existing.accept_token;
    const token = (crypto as any).randomUUID
      ? (crypto as any).randomUUID().replace(/-/g, '')
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const { error } = await supabase.from('engagement_letters')
      .update({ accept_token: token }).eq('id', id);
    if (error) throw new Error(error.message);
    return token;
  },

  // Public-facing fetch used by the /accept-engagement/:token page.
  async getEngagementLetterByToken(token: string) {
    const { data, error } = await supabase.rpc('get_engagement_letter_for_acceptance', { p_token: token });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  // Public-facing accept — typed signature only (IP capture would need
  // a server-side hop we're not building now).
  async acceptEngagementLetterByToken(token: string, signature: string): Promise<{ ok: boolean; already_accepted?: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('accept_engagement_letter_by_token', {
      p_token: token, p_signature: signature,
    });
    if (error) throw new Error(error.message);
    return data as any;
  },

  // Mark older sent/accepted letters as superseded when a new one is issued.
  async supersedePriorEngagementLetters(clientId: number, newLetterId: number) {
    const { data, error } = await supabase.rpc('supersede_prior_engagement_letters',
      { p_client_id: clientId, p_new_id: newLetterId });
    if (error) throw new Error(error.message);
    return (typeof data === 'number' ? data : (data?.[0] ?? 0));
  },

  // --------- Platform Credentials ---------
  // Passwords are encrypted at rest via migration 011. They never appear in the
  // table response — use getCredentialPassword(id) to decrypt (and audit-log).
  async getCredentials(clientId: number) {
    const { data, error } = await supabase.from('platform_credentials')
      .select('id, client_id, platform, platform_site_id, url, username, notes, password_enc, site:platform_sites(name, url)')
      .eq('client_id', clientId);
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({
      ...r,
      has_password: !!r.password_enc,
      password_enc: undefined,
      site_name: r.site?.name || null,
      site_url:  r.site?.url || null,
      // Effective URL: per-credential override beats the site default.
      effective_url: r.url || r.site?.url || null,
    }));
  },

  async createCredential(clientId: number, data: { platform: string; platform_site_id?: number | null; url?: string | null; username?: string; notes?: string; password?: string }) {
    const { data: row, error } = await supabase.from('platform_credentials').insert({
      client_id: clientId,
      platform: data.platform,
      platform_site_id: data.platform_site_id ?? null,
      url:      data.url      || null,
      username: data.username || '',
      notes:    data.notes    || '',
    }).select().single();
    if (error) throw new Error(error.message);
    if (data.password) {
      const { error: rpcErr } = await supabase.rpc('set_credential_password', { p_id: row.id, p_password: data.password });
      if (rpcErr) throw new Error(rpcErr.message);
    }
    return { id: row.id };
  },

  async updateCredential(_clientId: number, credId: number, data: { platform?: string; platform_site_id?: number | null; url?: string | null; username?: string; notes?: string; password?: string }) {
    const patch: any = {};
    if (data.platform !== undefined)         patch.platform = data.platform;
    if (data.platform_site_id !== undefined) patch.platform_site_id = data.platform_site_id;
    if (data.url !== undefined)              patch.url = data.url || null;
    if (data.username !== undefined)         patch.username = data.username;
    if (data.notes    !== undefined)         patch.notes    = data.notes;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('platform_credentials').update(patch).eq('id', credId);
      if (error) throw new Error(error.message);
    }
    if (data.password !== undefined) {
      const { error: rpcErr } = await supabase.rpc('set_credential_password', { p_id: credId, p_password: data.password });
      if (rpcErr) throw new Error(rpcErr.message);
    }
  },

  async deleteCredential(_clientId: number, credId: number) {
    const { error } = await supabase.from('platform_credentials').delete().eq('id', credId);
    if (error) throw new Error(error.message);
  },

  // Decrypt a credential's password. Server-side function audit-logs every call.
  async getCredentialPassword(credId: number): Promise<string> {
    const { data, error } = await supabase.rpc('get_credential_password', { p_id: credId });
    if (error) throw new Error(error.message);
    return (data as string) || '';
  },

  // --------- Invoices ---------
  // List fetch (populates AppContext.invoices at login). Deliberately does NOT
  // include journal_lines: pulling every accounting line for every invoice was
  // the app's largest boot payload, and only two actions actually need the
  // lines — the BTMS export and un-export — which now fetch them on demand via
  // getInvoicesWithLines / getInvoice. The `*` still carries every scalar
  // invoice field; the client-name join is one string per row.
  async getInvoices(params?: Record<string, string>) {
    let q = supabase.from('invoices')
      .select('*, client:clients(name)')
      .order('created_at', { ascending: false });
    if (params?.client_id) q = q.eq('client_id', Number(params.client_id));
    if (params?.status === 'not-exported') q = q.neq('status', 'exported');
    else if (params?.status) q = q.eq('status', params.status);
    if (params?.batch_month) q = q.eq('batch_month', params.batch_month);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((i: any) => ({ ...i, client_name: i.client?.name || null }));
  },

  // Full invoices WITH journal_lines, for the selected set only (BTMS export).
  // Chunked so the .in() URL stays bounded on a large batch.
  async getInvoicesWithLines(ids: number[]) {
    if (!ids.length) return [] as any[];
    const CHUNK = 200;
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from('invoices')
        .select('*, client:clients(name), journal_lines(*)')
        .in('id', ids.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
      out.push(...(data || []).map((inv: any) => ({ ...inv, client_name: inv.client?.name || null })));
    }
    return out;
  },

  async getInvoice(id: number) {
    const { data, error } = await supabase.from('invoices')
      .select('*, client:clients(name), journal_lines(*), files:invoice_files(*)')
      .eq('id', id).single();
    if (error) throw new Error(error.message);
    return { ...data, client_name: (data as any).client?.name || null };
  },

  async createInvoice(data: any, file?: File) {
    const { data: { session } } = await supabase.auth.getSession();
    const batch_month = toBatchMonth(data.invoice_date);
    const { data: row, error } = await supabase.from('invoices').insert({
      client_id: data.client_id,
      invoice_number: data.invoice_number || '',
      vendor_name: data.vendor_name || '',
      invoice_date: data.invoice_date || '',
      due_date: data.due_date || '',
      total_amount: data.total_amount || 0,
      currency: data.currency || '',
      currency_rate: data.currency_rate || '',
      raw_ocr_text: data.raw_ocr_text || '',
      status: data.status || 'draft',
      journal: data.journal || 'JV',
      reference: data.reference || '',
      batch_month,
      uploaded_by: session?.user?.id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    const invoiceId = row.id as number;

    if (data.journal_lines?.length) {
      await supabase.from('journal_lines').insert(data.journal_lines.map((l: any) => ({
        invoice_id: invoiceId,
        debit_account: l.debit_account || '', credit_account: l.credit_account || '',
        amount: l.amount || 0, vat_code: l.vat_code || '', vat_amount: l.vat_amount || 0,
        details: l.details || '',
        t_analysis_1: l.t_analysis_1 || '', t_analysis_2: l.t_analysis_2 || '',
        t_analysis_3: l.t_analysis_3 || '', t_analysis_4: l.t_analysis_4 || '', t_analysis_5: l.t_analysis_5 || '',
      })));
    }

    if (data.status !== 'draft' && data.vendor_name) {
      try { await learnFromInvoice(data.client_id, data.vendor_name, data); } catch {}
    }

    if (file) {
      const check = await detectAllowedFileType(file);
      if (!check.ok) throw new Error(`Upload blocked for "${file.name}": ${check.reason}`);
      const path = `${data.client_id}/${invoiceId}/${Date.now()}_${safeStorageSegment(file.name)}`;
      const up = await supabase.storage.from('invoice-files').upload(path, file);
      if (!up.error) {
        await supabase.from('invoice_files').insert({
          invoice_id: invoiceId, file_name: file.name, mime_type: file.type || 'application/octet-stream',
          storage_path: path,
        });
        // Also file it under the journal-subfolder in documents
        const folderId = await getJournalFolderId(data.client_id, data.journal || 'JV');
        const year = batch_month ? batch_month.split('-')[0] : '';
        await supabase.from('documents').insert({
          client_id: data.client_id, doc_type: 'invoice',
          category: `scanned_${data.journal || 'JV'}`, folder_id: folderId,
          year, month: batch_month, file_name: file.name, mime_type: file.type || '',
          storage_path: path, uploaded_by: session?.user?.id || null,
          notes: `${data.journal || 'JV'} — ${data.vendor_name || ''} ${data.invoice_number || '#' + invoiceId}`,
        });
      }
    }

    return { id: invoiceId };
  },

  async updateInvoice(id: number, data: any) {
    const batch_month = toBatchMonth(data.invoice_date);
    const { error } = await supabase.from('invoices').update({
      invoice_number: data.invoice_number, vendor_name: data.vendor_name,
      invoice_date: data.invoice_date, due_date: data.due_date,
      total_amount: data.total_amount, currency: data.currency, currency_rate: data.currency_rate,
      status: data.status, journal: data.journal, reference: data.reference,
      batch_month,
    }).eq('id', id);
    if (error) throw new Error(error.message);

    await supabase.from('journal_lines').delete().eq('invoice_id', id);
    if (data.journal_lines?.length) {
      await supabase.from('journal_lines').insert(data.journal_lines.map((l: any) => ({
        invoice_id: id,
        debit_account: l.debit_account || '', credit_account: l.credit_account || '',
        amount: l.amount || 0, vat_code: l.vat_code || '', vat_amount: l.vat_amount || 0,
        details: l.details || '',
        t_analysis_1: l.t_analysis_1 || '', t_analysis_2: l.t_analysis_2 || '',
        t_analysis_3: l.t_analysis_3 || '', t_analysis_4: l.t_analysis_4 || '', t_analysis_5: l.t_analysis_5 || '',
      })));
    }

    // Optional: learn pattern on reviewed
    if (data.status !== 'draft' && data.vendor_name) {
      const { data: inv } = await supabase.from('invoices').select('client_id').eq('id', id).single();
      if (inv) try { await learnFromInvoice(inv.client_id, data.vendor_name, data); } catch {}
    }
  },

  async deleteInvoice(id: number) {
    const { error } = await supabase.from('invoices').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async batchUpdateStatus(ids: number[], status: string) {
    if (!ids?.length) return { updated: 0 };
    const { error } = await supabase.from('invoices').update({ status }).in('id', ids);
    if (error) throw new Error(error.message);
    return { updated: ids.length };
  },

  async getBatchSummary(clientId?: number) {
    let q = supabase.from('invoices')
      .select('client_id, batch_month, status, total_amount, clients(name)')
      .neq('batch_month', '');
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const map = new Map<string, any>();
    for (const r of (data as any[]) || []) {
      const key = `${r.client_id}|${r.batch_month}|${r.status}`;
      const cur = map.get(key) || { client_id: r.client_id, client_name: r.clients?.name, batch_month: r.batch_month, status: r.status, count: 0, total: 0 };
      cur.count++; cur.total += Number(r.total_amount || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => (b.batch_month || '').localeCompare(a.batch_month || ''));
  },

  // Returns a promise-of-URL (was sync before). Callers should await.
  async getInvoiceFileUrl(_invoiceId: number, fileId: number): Promise<string> {
    const { data } = await supabase.from('invoice_files').select('storage_path').eq('id', fileId).single();
    if (!data) throw new Error('File not found');
    const signed = await supabase.storage.from('invoice-files').createSignedUrl(data.storage_path, 300);
    if (signed.error) throw new Error(signed.error.message);
    return signed.data.signedUrl;
  },

  // --------- Documents ---------
  async getDocuments(params?: Record<string, string>) {
    let q = supabase.from('documents').select('*').order('created_at', { ascending: false });
    if (params?.client_id) q = q.eq('client_id', Number(params.client_id));
    if (params?.folder_id) q = q.eq('folder_id', Number(params.folder_id));
    if (params?.category) q = q.eq('category', params.category);
    if (params?.year) q = q.eq('year', params.year);
    if (params?.month) q = q.eq('month', params.month);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async uploadDocuments(params: { clientId: number; docType: string; category: string; month: string; year?: string; files: File[]; notes?: string }) {
    return api.uploadDocumentsToFolder({ ...params, folderId: null });
  },

  async uploadDocumentsToFolder(params: { clientId: number; folderId?: number | null; docType: string; category: string; month: string; year?: string; files: File[]; notes?: string }) {
    const { data: { session } } = await supabase.auth.getSession();
    const year = params.year || (params.month ? params.month.split('-')[0] : '');

    // Validate EVERY file before uploading any of them — otherwise a rejection
    // partway through would leave the earlier files orphaned in storage
    // (uploaded but never inserted into the documents table).
    const checks = await Promise.all(
      params.files.map(async f => ({ name: f.name, ...(await detectAllowedFileType(f)) }))
    );
    const rejected = checks.filter(c => !c.ok);
    if (rejected.length) {
      const lines = rejected.map(r => `  • ${r.name}: ${r.reason}`).join('\n');
      throw new Error(
        rejected.length === params.files.length
          ? `Upload blocked. ${rejected.length} file(s) rejected:\n${lines}`
          : `Upload blocked — fix or remove the bad file(s) and try again. ${rejected.length} of ${params.files.length} rejected:\n${lines}`
      );
    }

    // KYC files go to a dedicated, more-restricted bucket per migration 019.
    const bucket = params.category === 'kyc' ? 'kyc-documents' : 'documents';

    const rows: any[] = [];
    for (const f of params.files) {
      const safeCategory = safeStorageSegment(params.category || 'other');
      const path = `${params.clientId}/${safeCategory}/${Date.now()}_${safeStorageSegment(f.name)}`;
      const up = await supabase.storage.from(bucket).upload(path, f);
      if (up.error) throw new Error(up.error.message);
      rows.push({
        client_id: params.clientId, folder_id: params.folderId || null,
        doc_type: params.docType, category: params.category,
        year, month: params.month,
        file_name: f.name, mime_type: f.type || 'application/octet-stream',
        storage_path: path, storage_bucket: bucket, notes: params.notes || '',
        uploaded_by: session?.user?.id || null,
      });
    }
    const { data, error } = await supabase.from('documents').insert(rows).select();
    if (error) throw new Error(error.message);
    return { inserted: data?.length || 0 };
  },

  async getDocStructure(clientId: number) {
    const { data } = await supabase.from('documents')
      .select('category, year, month').eq('client_id', clientId);
    return data || [];
  },

  // Resolve a system-folder id from its category_key (seeds folders if needed).
  async getFolderIdByCategoryKey(clientId: number, categoryKey: string): Promise<number | null> {
    await seedSystemFolders(clientId);
    const { data } = await supabase.from('folders').select('id')
      .eq('client_id', clientId).eq('category_key', categoryKey).eq('is_system', true)
      .order('id', { ascending: true }).limit(1);
    return data?.[0]?.id || null;
  },

  // --------- Smart Import mappings (reusable column-mapping presets) ---------
  async getImportMappings() {
    const { data, error } = await supabase.from('import_mappings')
      .select('*').order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async saveImportMapping(payload: {
    name: string;
    description?: string | null;
    column_mapping: Record<string, string>;
    options?: Record<string, any>;
    is_shared?: boolean;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const row = {
      user_id:        session?.user?.id,
      name:           payload.name,
      description:    payload.description || null,
      column_mapping: payload.column_mapping,
      options:        payload.options || {},
      is_shared:      payload.is_shared ?? false,
    };
    // Upsert on (user_id, name) — re-saving under the same name overwrites it.
    const { data, error } = await supabase.from('import_mappings')
      .upsert(row, { onConflict: 'user_id,name' }).select('id').single();
    if (error) throw new Error(error.message);
    return data.id as string;
  },

  async deleteImportMapping(id: string) {
    const { error } = await supabase.from('import_mappings').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Apply one chunk of resolved Smart Import row operations.
  async smartImport(rows: any[]) {
    const { data, error } = await supabase.rpc('smart_import', { p_rows: rows });
    if (error) throw new Error(error.message);
    return data as {
      batch_id: string; created: number; updated: number;
      credentials: number; failed: number; errors: any[];
    };
  },

  // --------- Folder templates (the master list of storage-folder NAMES) ---------
  // One row per system folder. Renaming a row updates the template AND
  // propagates the new name to every existing client's folder. Leadership-only.
  async getFolderTemplates() {
    const { data, error } = await supabase.from('folder_template')
      .select('id, category_key, name, parent_key, sort_order, is_active, updated_at')
      .order('parent_key', { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async renameFolderTemplate(id: number, name: string) {
    const { error } = await supabase.rpc('rename_folder_template', { p_id: id, p_name: name });
    if (error) throw new Error(error.message);
  },
  async setFolderTemplateActive(id: number, active: boolean) {
    const { error } = await supabase.rpc('set_folder_template_active', { p_id: id, p_active: active });
    if (error) throw new Error(error.message);
  },
  async addFolderTemplate(name: string, parentKey: string | null, sortOrder: number) {
    const { data, error } = await supabase.rpc('add_folder_template', {
      p_name: name, p_parent_key: parentKey, p_sort_order: sortOrder,
    });
    if (error) throw new Error(error.message);
    return data as number;
  },
  async deleteFolderTemplate(id: number) {
    const { error } = await supabase.rpc('delete_folder_template', { p_id: id });
    if (error) throw new Error(error.message);
  },

  // --------- Document categories (Scan Document master list) ---------
  // Active categories only — used by the Scan Document dropdown.
  async getDocumentCategories() {
    const { data, error } = await supabase.from('document_categories')
      .select('*').eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Every category, active or not — used by the Company Settings admin.
  async getAllDocumentCategories() {
    const { data, error } = await supabase.from('document_categories')
      .select('*').order('display_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async createDocumentCategory(payload: Record<string, any>) {
    const { data, error } = await supabase.from('document_categories')
      .insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateDocumentCategory(id: number, payload: Record<string, any>) {
    const { error } = await supabase.from('document_categories')
      .update(payload).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteDocumentCategory(id: number) {
    const { error } = await supabase.from('document_categories').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Persist a new display order — writes display_order = position for each id.
  async reorderDocumentCategories(ids: number[]) {
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('document_categories')
        .update({ display_order: i + 1 }).eq('id', ids[i]);
      if (error) throw new Error(error.message);
    }
  },

  // --------- Client categories (editable client/company category list) ---------
  // Active categories only — used by the client form + Clients list filter.
  async getClientCategories() {
    return cachedLookup('client_categories:active', async () => {
      const { data, error } = await supabase.from('client_categories')
        .select('*').eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    });
  },

  // Every category, active or not — used by the Company Settings admin.
  async getAllClientCategories() {
    return cachedLookup('client_categories:all', async () => {
      const { data, error } = await supabase.from('client_categories')
        .select('*').order('display_order', { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    });
  },

  async createClientCategory(payload: Record<string, any>) {
    const { data, error } = await supabase.from('client_categories')
      .insert(payload).select().single();
    if (error) throw new Error(error.message);
    invalidateLookup('client_categories');
    return data;
  },

  async updateClientCategory(id: number, payload: Record<string, any>) {
    const { error } = await supabase.from('client_categories')
      .update(payload).eq('id', id);
    if (error) throw new Error(error.message);
    invalidateLookup('client_categories');
  },

  async deleteClientCategory(id: number) {
    const { error } = await supabase.from('client_categories').delete().eq('id', id);
    if (error) throw new Error(error.message);
    invalidateLookup('client_categories');
  },

  async reorderClientCategories(ids: number[]) {
    // Invalidate even on a partial failure — some rows may already have moved.
    try {
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase.from('client_categories')
          .update({ display_order: i + 1 }).eq('id', ids[i]);
        if (error) throw new Error(error.message);
      }
    } finally {
      invalidateLookup('client_categories');
    }
  },

  // --------- Cities (editable city list for client addresses) ---------
  // Active cities only — used by the address city dropdown.
  async getCities() {
    return cachedLookup('cities:active', async () => {
      const { data, error } = await supabase.from('cities')
        .select('*').eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    });
  },

  // Every city, active or not — used by the Company Settings admin.
  async getAllCities() {
    return cachedLookup('cities:all', async () => {
      const { data, error } = await supabase.from('cities')
        .select('*').order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    });
  },

  async createCity(payload: Record<string, any>) {
    const { data, error } = await supabase.from('cities')
      .insert(payload).select().single();
    if (error) throw new Error(error.message);
    invalidateLookup('cities');
    return data;
  },

  async updateCity(id: number, payload: Record<string, any>) {
    const { error } = await supabase.from('cities')
      .update(payload).eq('id', id);
    if (error) throw new Error(error.message);
    invalidateLookup('cities');
  },

  async deleteCity(id: number) {
    const { error } = await supabase.from('cities').delete().eq('id', id);
    if (error) throw new Error(error.message);
    invalidateLookup('cities');
  },

  // Outbound email is sent exclusively through each staff member's own
  // Outlook/SMTP account — see sendViaOutlook below. (The legacy CloudMailin
  // path, api.sendEmail → send-email Edge Function, was removed when CloudMailin
  // was cancelled.)

  // --------- AI document extraction (extract-document Edge Function → Claude) ---------
  // Sends base64 page image(s) and gets back structured invoice fields.
  async extractDocument(images: { media_type: string; data: string }[]) {
    const { data, error } = await supabase.functions.invoke('extract-document', { body: { images } });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || 'AI extraction failed.');
    // Best-effort cost logging — never let it block or fail a scan.
    try { await logAiUsage(data.usage, images.length); } catch { /* ignore */ }
    return data.data as Record<string, any>;
  },

  // Cost-monitoring view: month + all-time totals plus the most recent scans.
  async getAiUsageSummary(recentLimit = 50) {
    const { data, error } = await supabase.from('ai_usage')
      .select('id, created_at, source, model, input_tokens, output_tokens, estimated_cost, pages')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data || [];
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const sum = (list: any[]) => list.reduce((a, r) => ({
      scans: a.scans + 1,
      input: a.input + Number(r.input_tokens || 0),
      output: a.output + Number(r.output_tokens || 0),
      cost: a.cost + Number(r.estimated_cost || 0),
    }), { scans: 0, input: 0, output: 0, cost: 0 });
    return {
      all: sum(rows),
      month: sum(rows.filter(r => new Date(r.created_at) >= monthStart)),
      recent: rows.slice(0, recentLimit),
    };
  },

  // --------- Recurring invoices (Accounting — billing module Phase A) ---------
  async getRecurringInvoices() {
    const { data, error } = await supabase.from('recurring_invoices')
      .select('*, client:clients(name, client_code), lines:recurring_invoice_lines(*)')
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async saveRecurringInvoice(
    profile: {
      id?: number; client_id: number; label: string | null; vat_rate: number;
      discount_type: string | null; discount_value: number | null;
      active: boolean; notes: string | null;
    },
    lines: { line_no: number; line_type: string; description: string;
             quantity: number; unit_price: number; amount: number;
             vatable: boolean; vat_rate: number }[],
  ) {
    const payload = {
      client_id: profile.client_id, label: profile.label, vat_rate: profile.vat_rate,
      discount_type: profile.discount_type, discount_value: profile.discount_value,
      active: profile.active, notes: profile.notes,
    };
    let id = profile.id;
    if (id) {
      const { error } = await supabase.from('recurring_invoices').update(payload).eq('id', id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from('recurring_invoices')
        .insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      id = (data as any).id as number;
    }
    // Replace the line items.
    const { error: delErr } = await supabase.from('recurring_invoice_lines')
      .delete().eq('recurring_id', id);
    if (delErr) throw new Error(delErr.message);
    if (lines.length) {
      const { error: insErr } = await supabase.from('recurring_invoice_lines')
        .insert(lines.map(l => ({ ...l, recurring_id: id })));
      if (insErr) throw new Error(insErr.message);
    }
    return id;
  },

  async deleteRecurringInvoice(id: number) {
    const { error } = await supabase.from('recurring_invoices').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async generateRecurringInvoices(ids: number[], issueDate: string, dueDate?: string) {
    const { data, error } = await supabase.rpc('generate_recurring_invoices', {
      p_ids: ids, p_issue_date: issueDate, p_due_date: dueDate || null,
    });
    if (error) throw new Error(error.message);
    return data as { generated: number; issue_date: string };
  },

  // --------- Folders ---------
  async getFolders(clientId: number) {
    // Read first, seed only when needed. Seeding used to run on EVERY open —
    // two extra round trips (plus the template fetch) to create folders that,
    // for any client used before, already exist. If the read comes back with
    // system folders, this client is seeded and we skip it entirely.
    const readFolders = () => supabase.from('folders').select('*')
      .eq('client_id', clientId).order('is_system', { ascending: false }).order('name');

    let { data, error } = await readFolders();
    if (error) throw new Error(error.message);
    if (!(data || []).some((f: any) => f.is_system)) {
      await seedSystemFolders(clientId);
      ({ data, error } = await readFolders());
      if (error) throw new Error(error.message);
    }

    // Defensive dedupe: keep one system folder per category_key (lowest id wins),
    // and remap any subfolder parent_ids that point to a duplicate over to the canonical id.
    // Protects the UI even if legacy duplicate rows still exist in the DB.
    const systemByKey = new Map<string, any>();
    const nonSystem: any[] = [];
    const idRemap = new Map<number, number>();
    for (const f of data || []) {
      if (!f.is_system) { nonSystem.push(f); continue; }
      const prior = systemByKey.get(f.category_key);
      if (!prior) {
        systemByKey.set(f.category_key, f);
      } else if (f.id < prior.id) {
        idRemap.set(prior.id, f.id);
        systemByKey.set(f.category_key, f);
      } else {
        idRemap.set(f.id, prior.id);
      }
    }
    const dedupedSystem = Array.from(systemByKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    const deduped = [...dedupedSystem, ...nonSystem];
    for (const f of deduped) {
      if (f.parent_id && idRemap.has(f.parent_id)) f.parent_id = idRemap.get(f.parent_id);
    }

    // Attach doc count. This was one count() query PER FOLDER, run in sequence
    // — ~15+ round trips on a seeded client, and the main cause of the tab's
    // lag. Replaced with a single read of every document's folder_id, tallied
    // in memory. (documents rows are light — no OCR text or blobs.)
    const { data: docRows } = await supabase.from('documents')
      .select('folder_id').eq('client_id', clientId);
    const countByFolder = new Map<number, number>();
    for (const d of (docRows || []) as any[]) {
      if (d.folder_id != null) countByFolder.set(d.folder_id, (countByFolder.get(d.folder_id) || 0) + 1);
    }
    return deduped.map(f => ({ ...f, doc_count: countByFolder.get(f.id) || 0 }));
  },

  async createFolder(data: { client_id: number; parent_id?: number | null; name: string }) {
    const { data: row, error } = await supabase.from('folders').insert({
      client_id: data.client_id, parent_id: data.parent_id || null, name: data.name, is_system: false,
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async renameFolder(id: number, name: string) {
    const { error } = await supabase.from('folders').update({ name }).eq('id', id).eq('is_system', false);
    if (error) throw new Error(error.message);
  },

  async deleteFolder(id: number) {
    const { data: f } = await supabase.from('folders').select('parent_id, is_system').eq('id', id).single();
    if (f?.is_system) throw new Error('Cannot delete system folder');
    await supabase.from('documents').update({ folder_id: f?.parent_id || null }).eq('folder_id', id);
    await supabase.from('folders').update({ parent_id: f?.parent_id || null }).eq('parent_id', id);
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async moveDocToFolder(docId: number, folderId: number | null) {
    const { error } = await supabase.from('documents').update({ folder_id: folderId }).eq('id', docId);
    if (error) throw new Error(error.message);
  },

  async downloadDocumentUrl(id: number): Promise<string> {
    const { data } = await supabase.from('documents').select('storage_path, storage_bucket').eq('id', id).single();
    if (!data) throw new Error('Document not found');
    const bucket = data.storage_bucket || 'documents';
    const signed = await supabase.storage.from(bucket).createSignedUrl(data.storage_path, 300);
    if (signed.error) throw new Error(signed.error.message);
    return signed.data.signedUrl;
  },

  async deleteDocument(id: number) {
    // Soft-delete via SECURITY DEFINER RPC (see deleteClient comment).
    // File stays in storage; future hard-purge job removes it after retention.
    const { error } = await supabase.rpc('soft_delete_document', { p_id: id });
    if (error) throw new Error(error.message);
  },

  async restoreDocument(id: number) {
    const { error } = await supabase.rpc('restore_document', { p_id: id });
    if (error) throw new Error(error.message);
  },

  // --------- Permissions ---------
  // Get the permission matrix for any user (admin-only via roles.write).
  async getUserPermissions(userId: string): Promise<{ permission: string; granted_by_default: boolean; override: boolean | null }[]> {
    const { data, error } = await supabase.rpc('get_user_permissions', { p_user_id: userId });
    if (error) throw new Error(error.message);
    return (data as any[]) || [];
  },

  // Grant / revoke a single permission. Pass null to remove the override
  // and fall back to the role default.
  async setUserPermission(userId: string, permission: string, granted: boolean | null): Promise<void> {
    const { error } = await supabase.rpc('set_user_permission', {
      p_user_id: userId,
      p_permission: permission,
      p_granted: granted,
    });
    if (error) throw new Error(error.message);
  },

  // --------- Trusted devices ---------
  async trustThisDevice(label: string, userAgent: string, days = 30): Promise<string> {
    const { data, error } = await supabase.rpc('trust_this_device', {
      p_label:      label,
      p_user_agent: userAgent,
      p_days:       days,
    });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async verifyTrustedDevice(token: string): Promise<boolean> {
    if (!token) return false;
    const { data, error } = await supabase.rpc('verify_trusted_device', { p_token: token });
    if (error) return false;
    return Boolean(data);
  },

  async listMyTrustedDevices(userId: string) {
    const { data, error } = await supabase.from('trusted_devices')
      .select('id, device_label, user_agent, expires_at, created_at, last_used_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async revokeTrustedDevice(id: string) {
    const { error } = await supabase.rpc('revoke_trusted_device', { p_id: id });
    if (error) throw new Error(error.message);
  },

  // --------- MFA (TOTP) ---------
  async listMfaFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw new Error(error.message);
    return data; // { all, totp }
  },

  async enrollTotp(friendlyName?: string) {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: friendlyName || 'Authenticator app',
      issuer: 'PC Prime Portal',
    } as any);
    if (error) throw new Error(error.message);
    // data contains: { id, type, totp: { qr_code, secret, uri }, friendly_name }
    return data as any;
  },

  async verifyMfaEnrollment(factorId: string, code: string) {
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) throw new Error(challenge.error.message);
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async challengeMfa(factorId: string) {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) throw new Error(error.message);
    return data;
  },

  async verifyMfa(factorId: string, challengeId: string, code: string) {
    const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
    if (error) throw new Error(error.message);
    return data;
  },

  async unenrollMfa(factorId: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new Error(error.message);
  },

  async getMfaAal() {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw new Error(error.message);
    // { currentLevel: 'aal1' | 'aal2', nextLevel: 'aal1' | 'aal2', currentAuthenticationMethods: [...] }
    return data;
  },

  // --------- Call logs ---------
  async getCallLogs(params?: { client_id?: number; staff_id?: string; direction?: string; from?: string; to?: string; task_id?: number }) {
    let q = supabase.from('call_logs')
      .select('*, client:clients(name, client_code), task:staff_tasks!task_id(title, status)')
      .order('call_at', { ascending: false });
    if (params?.client_id) q = q.eq('client_id', params.client_id);
    if (params?.staff_id)  q = q.eq('staff_id',  params.staff_id);
    if (params?.direction) q = q.eq('direction', params.direction);
    if (params?.task_id)   q = q.eq('task_id',   params.task_id);
    if (params?.from)      q = q.gte('call_at',  params.from);
    if (params?.to)        q = q.lte('call_at',  params.to + 'T23:59:59');
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((c: any) => ({
      ...c,
      client_name: c.client?.name || null,
      client_code: c.client?.client_code || null,
      task_title:  c.task?.title || null,
      task_status: c.task?.status || null,
    }));
  },

  async createCallLog(data: {
    client_id?: number | null; staff_id?: string | null;
    direction: 'inbound' | 'outbound';
    contact_name?: string | null; contact_phone?: string | null;
    call_at?: string; duration_min?: number | null; notes?: string | null;
    task_id?: number | null;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('call_logs').insert({
      client_id:     data.client_id || null,
      staff_id:      data.staff_id || session?.user?.id || null,
      direction:     data.direction,
      contact_name:  data.contact_name || null,
      contact_phone: data.contact_phone || null,
      call_at:       data.call_at || new Date().toISOString(),
      duration_min:  data.duration_min ?? null,
      notes:         data.notes || null,
      task_id:       data.task_id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateCallLog(id: number, patch: any) {
    const { error } = await supabase.from('call_logs').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteCallLog(id: number) {
    const { error } = await supabase.from('call_logs').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Appointments / Calendar ---------
  async getAppointments(params?: { from?: string; to?: string; owner_id?: string }) {
    // owner_id references auth.users, so PostgREST can't auto-join to profiles.
    // The Calendar component looks owner names up from its staffUsers list.
    let q = supabase.from('appointments')
      .select('*, client:clients(name, client_code)')
      .order('starts_at', { ascending: true });
    if (params?.from)     q = q.gte('ends_at',   params.from);
    if (params?.to)       q = q.lte('starts_at', params.to);
    if (params?.owner_id) q = q.eq('owner_id', params.owner_id);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((a: any) => ({
      ...a,
      client_name: a.client?.name || null,
      client_code: a.client?.client_code || null,
    }));
  },

  async createAppointment(data: {
    owner_id: string;
    title: string;
    description?: string | null;
    location?: string | null;
    starts_at: string;
    ends_at: string;
    all_day?: boolean;
    status?: 'confirmed' | 'tentative' | 'cancelled';
    client_id?: number | null;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('appointments').insert({
      owner_id:    data.owner_id,
      created_by:  session?.user?.id || null,
      title:       data.title,
      description: data.description || null,
      location:    data.location || null,
      starts_at:   data.starts_at,
      ends_at:     data.ends_at,
      all_day:     !!data.all_day,
      status:      data.status || 'confirmed',
      client_id:   data.client_id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateAppointment(id: number, patch: any) {
    const { error } = await supabase.from('appointments').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteAppointment(id: number) {
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Timesheet ---------
  async getTimeEntries(params?: {
    user_id?: string;
    client_id?: number;
    service?: string;
    from?: string;            // YYYY-MM-DD inclusive
    to?: string;              // YYYY-MM-DD inclusive
    approval_status?: 'draft' | 'approved';
    billing_status?: 'unbilled' | 'written_off' | 'deferred' | 'invoiced';
  }) {
    let q = supabase.from('time_entries')
      .select('*, client:clients(name, client_code)')
      .order('entry_date', { ascending: false })
      .order('id',         { ascending: false });
    if (params?.user_id)         q = q.eq('user_id',         params.user_id);
    if (params?.client_id)       q = q.eq('client_id',       params.client_id);
    if (params?.service)         q = q.eq('service',         params.service);
    if (params?.approval_status) q = q.eq('approval_status', params.approval_status);
    if (params?.billing_status)  q = q.eq('billing_status',  params.billing_status);
    if (params?.from)            q = q.gte('entry_date',     params.from);
    if (params?.to)              q = q.lte('entry_date',     params.to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({
      ...r,
      client_name: r.client?.name || null,
      client_code: r.client?.client_code || null,
    }));
  },

  async approveTimeEntries(ids: number[]) {
    if (!ids.length) return 0;
    const { data, error } = await supabase.rpc('approve_time_entries', { p_ids: ids });
    if (error) throw new Error(error.message);
    return data as number;
  },

  async unlockTimeEntries(ids: number[]) {
    if (!ids.length) return 0;
    const { data, error } = await supabase.rpc('unlock_time_entries', { p_ids: ids });
    if (error) throw new Error(error.message);
    return data as number;
  },

  async setTimeEntriesBillingStatus(ids: number[], status: 'unbilled' | 'written_off' | 'deferred', reason?: string) {
    if (!ids.length) return 0;
    const { data, error } = await supabase.rpc('set_time_entries_billing_status', {
      p_ids: ids, p_status: status, p_reason: reason || null,
    });
    if (error) throw new Error(error.message);
    return data as number;
  },

  // --------- Client invoicing (sales invoices) ---------
  async getClientInvoices(params?: {
    client_id?: number;
    status?: 'draft' | 'issued' | 'paid' | 'cancelled';
    from?: string;
    to?: string;
  }) {
    let q = supabase.from('client_invoices')
      .select('*, client:clients(name, client_code)')
      .order('issue_date', { ascending: false, nullsFirst: true })
      .order('id',         { ascending: false });
    if (params?.client_id) q = q.eq('client_id', params.client_id);
    if (params?.status)    q = q.eq('status',    params.status);
    if (params?.from)      q = q.gte('issue_date', params.from);
    if (params?.to)        q = q.lte('issue_date', params.to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({
      ...r,
      client_name: r.client?.name || null,
      client_code: r.client?.client_code || null,
    }));
  },

  async getClientInvoice(id: number) {
    const [{ data: inv, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
      supabase.from('client_invoices').select('*, client:clients(name, client_code, email, phone, address, city, postal_code, country, vat_number)').eq('id', id).maybeSingle(),
      supabase.from('client_invoice_lines').select('*').eq('invoice_id', id).order('line_no', { ascending: true }).order('id', { ascending: true }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (!inv) throw new Error('Invoice not found');
    return { ...inv, lines: lines || [] };
  },

  async createClientInvoice(data: {
    client_id: number;
    issue_date?: string | null;
    due_date?: string | null;
    vat_rate?: number;
    discount_type?: 'percent' | 'amount' | null;
    discount_value?: number | null;
    notes?: string | null;
    billing_address?: string | null;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const vatRate = data.vat_rate ?? 19.00;
    // Default payment-terms note — editable per invoice.
    const defaultNotes = 'Note: Invoices outstanding for more than 15 days will carry interest at 8.5% p.a.';
    const { data: row, error } = await supabase.from('client_invoices').insert({
      client_id:       data.client_id,
      issue_date:      data.issue_date || null,
      due_date:        data.due_date || null,
      vat_rate:        vatRate,
      discount_type:   data.discount_type || null,
      discount_value:  data.discount_value ?? null,
      notes:           data.notes ?? defaultNotes,
      billing_address: data.billing_address || null,
      created_by:      session?.user?.id || null,
    }).select().single();
    if (error) throw new Error(error.message);

    // Seed a default fee line — the firm's standard wording for accounting
    // fees. The user adjusts price / description / VAT per line.
    await supabase.from('client_invoice_lines').insert({
      invoice_id:    row.id,
      line_no:       1,
      line_type:     'fixed',
      description:   'Our fees based on time spent',
      quantity:      1,
      unit_price:    0,
      amount:        0,
      vatable:       true,
      vat_rate:      vatRate,
      time_entry_id: null,
    });
    return { id: row.id as number };
  },

  async updateClientInvoice(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('client_invoices').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteClientInvoice(id: number) {
    const { error } = await supabase.from('client_invoices').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async issueClientInvoice(id: number) {
    const { data, error } = await supabase.rpc('issue_client_invoice', { p_id: id });
    if (error) throw new Error(error.message);
    return data as string;   // invoice_number
  },

  async cancelClientInvoice(id: number) {
    const { error } = await supabase.rpc('cancel_client_invoice', { p_id: id });
    if (error) throw new Error(error.message);
  },

  async markClientInvoicePaid(id: number, paidDate?: string, method?: string) {
    const { data, error } = await supabase.rpc('mark_client_invoice_paid', {
      p_id: id, p_paid_date: paidDate || null, p_method: method || null,
    });
    if (error) throw new Error(error.message);
    return data as string;   // the new receipt number
  },

  async getReceiptForInvoice(invoiceId: number) {
    const { data, error } = await supabase.from('receipts')
      .select('id, receipt_number')
      .eq('invoice_id', invoiceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: number; receipt_number: string } | null;
  },

  async getReceipt(id: number) {
    const { data, error } = await supabase.from('receipts')
      .select('*, client:clients(name, client_code, address, city, postal_code, country, vat_number), invoice:client_invoices(invoice_number, issue_date)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  // Receipts lister — used by the Statements screen (for client balances)
  // and by Sales Reports (full listing with client / invoice context).
  async getReceipts(params?: { client_id?: number; from?: string; to?: string }) {
    let q = supabase.from('receipts')
      .select('id, receipt_number, client_id, invoice_id, receipt_date, amount, payment_method, client:clients(name, client_code), invoice:client_invoices(invoice_number)')
      .order('receipt_date', { ascending: false });
    if (params?.client_id) q = q.eq('client_id', params.client_id);
    if (params?.from)      q = q.gte('receipt_date', params.from);
    if (params?.to)        q = q.lte('receipt_date', params.to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Invoice lines for a list of invoice IDs — used by the VAT report to
  // aggregate output VAT by rate over a period.
  async getInvoiceLinesByInvoices(invoiceIds: number[]) {
    if (invoiceIds.length === 0) return [];
    const { data, error } = await supabase.from('client_invoice_lines')
      .select('invoice_id, vat_rate, vatable, amount')
      .in('invoice_id', invoiceIds);
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Bundles everything a client statement / age analysis needs:
  // the client header, their issued+paid invoices, and their receipts.
  async getClientStatement(clientId: number) {
    const [client, invoices, receipts] = await Promise.all([
      supabase.from('clients')
        .select('id, name, client_code, address, city, postal_code, country, vat_number')
        .eq('id', clientId).maybeSingle(),
      supabase.from('client_invoices')
        .select('id, invoice_number, status, issue_date, due_date, total_amount, paid_date')
        .eq('client_id', clientId).in('status', ['issued', 'paid'])
        .order('issue_date', { ascending: true }).order('id', { ascending: true }),
      supabase.from('receipts')
        .select('id, receipt_number, receipt_date, amount, payment_method, invoice_id')
        .eq('client_id', clientId)
        .order('receipt_date', { ascending: true }).order('id', { ascending: true }),
    ]);
    if (client.error)   throw new Error(client.error.message);
    if (invoices.error) throw new Error(invoices.error.message);
    if (receipts.error) throw new Error(receipts.error.message);
    if (!client.data)   throw new Error('Client not found');
    return {
      client:   client.data,
      invoices: invoices.data || [],
      receipts: receipts.data || [],
    };
  },

  // --------- Client ↔ firm messaging (topics / threads) ---------
  // Topics for one client (both sides): subject, last message, unread count.
  async getClientThreads(clientId: number) {
    const { data, error } = await supabase.rpc('get_client_threads', { p_client_id: clientId });
    if (error) throw new Error(error.message);
    return (data || []) as { id: number; subject: string; status: string; created_at: string;
      last_at: string; last_body: string | null; unread: number }[];
  },
  async createMessageThread(clientId: number, subject: string) {
    const { data, error } = await supabase.rpc('create_message_thread', { p_client_id: clientId, p_subject: subject });
    if (error) throw new Error(error.message);
    return data as number;
  },
  async setThreadStatus(threadId: number, status: 'open' | 'closed') {
    const { error } = await supabase.rpc('set_thread_status', { p_thread_id: threadId, p_status: status });
    if (error) throw new Error(error.message);
  },
  // Messages within one topic.
  async getThreadMessages(threadId: number) {
    const { data, error } = await supabase.from('client_messages')
      .select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async sendClientMessage(threadId: number, body: string) {
    const { data, error } = await supabase.rpc('send_client_message', { p_thread_id: threadId, p_body: body });
    if (error) throw new Error(error.message);
    return data as number;
  },
  async markThreadRead(threadId: number) {
    const { error } = await supabase.rpc('mark_thread_read', { p_thread_id: threadId });
    if (error) throw new Error(error.message);
  },
  async getMessageInbox() {
    const { data, error } = await supabase.rpc('get_message_inbox');
    if (error) throw new Error(error.message);
    return (data || []) as { client_id: number; client_name: string; client_code: string | null;
      last_at: string; last_body: string; unread: number }[];
  },
  // Count of firm replies the client hasn't read yet (for their unread badge).
  async getMyUnreadMessageCount(clientId: number) {
    const { count, error } = await supabase.from('client_messages')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('author_is_staff', true).eq('read_by_client', false);
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // --------- Client's own billing: company profile + customers ---------
  // The client's invoicing identity. Falls back to their clients record so a
  // brand-new client starts with the details the firm already holds.
  async getCompanyProfile(clientId: number) {
    const { data: profile, error } = await supabase.from('client_company_profile')
      .select('*').eq('client_id', clientId).maybeSingle();
    if (error) throw new Error(error.message);
    if (profile) return profile as Record<string, any>;
    const { data: c } = await supabase.from('clients')
      .select('name, address, city, postal_code, country, vat_number, phone, email')
      .eq('id', clientId).maybeSingle();
    return {
      client_id: clientId,
      business_name: c?.name || '',
      registration_number: '',
      vat_number: c?.vat_number || '',
      address: [c?.address, [c?.postal_code, c?.city].filter(Boolean).join(' '), c?.country]
        .filter(Boolean).join('\n'),
      phone: c?.phone || '',
      email: c?.email || '',
      logo_url: null,
      footer: '',
      _isNew: true,
    } as Record<string, any>;
  },
  async saveCompanyProfile(clientId: number, patch: Record<string, any>) {
    const row: Record<string, any> = { ...patch, client_id: clientId };
    delete row._isNew;
    const { error } = await supabase.from('client_company_profile')
      .upsert(row, { onConflict: 'client_id' });
    if (error) throw new Error(error.message);
  },
  async uploadClientLogo(clientId: number, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext) ? ext : 'png';
    const key = `${clientId}/logo-${Date.now()}.${safeExt}`;
    const { error } = await supabase.storage.from('client-logos')
      .upload(key, file, { upsert: true, contentType: file.type || 'image/png' });
    if (error) throw new Error(error.message);
    const { data: pub } = supabase.storage.from('client-logos').getPublicUrl(key);
    return pub.publicUrl;
  },

  async getCustomers(ownerClientId: number) {
    const { data, error } = await supabase.from('customer')
      .select('*').eq('owner_client_id', ownerClientId).order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async saveCustomer(row: {
    id?: number; owner_client_id: number; name: string;
    contact_person?: string | null; email?: string | null; phone?: string | null;
    vat_number?: string | null; address?: string | null; notes?: string | null; active?: boolean;
  }) {
    if (row.id) {
      const { id, ...patch } = row;
      const { error } = await supabase.from('customer').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
      return id;
    }
    const { data, error } = await supabase.from('customer').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return data.id as number;
  },
  async deleteCustomer(id: number) {
    const { error } = await supabase.from('customer').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Client expense capture ---------
  async uploadExpenseFile(clientId: number, file: File) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${clientId}/${Date.now()}_${safe}`;
    const { error } = await supabase.storage.from('client-expenses')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) throw new Error(error.message);
    return path;
  },
  async expenseFileUrl(path: string) {
    const { data, error } = await supabase.storage.from('client-expenses').createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
  async createClientExpense(row: Record<string, any>) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('client_expense')
      .insert({ ...row, created_by: session?.user?.id || null }).select('id').single();
    if (error) throw new Error(error.message);
    return data.id as number;
  },
  async getMyExpenses(ownerClientId: number) {
    const { data, error } = await supabase.from('client_expense')
      .select('*').eq('owner_client_id', ownerClientId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async getClientExpenses(params?: { status?: string; client_id?: number }) {
    let q = supabase.from('client_expense')
      .select('*, client:clients(name, client_code)')
      .order('created_at', { ascending: false });
    if (params?.status)    q = q.eq('status', params.status);
    if (params?.client_id) q = q.eq('owner_client_id', params.client_id);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({ ...r, client_name: r.client?.name || null, client_code: r.client?.client_code || null }));
  },
  async updateExpense(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('client_expense').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Count of client expenses awaiting review (for the staff sidebar badge).
  async countSubmittedExpenses() {
    const { count, error } = await supabase.from('client_expense')
      .select('id', { count: 'exact', head: true }).eq('status', 'submitted');
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // --------- Advisor reports (firm publishes finished reports to a client) ---------
  async uploadAdvisorReportFile(clientId: number, file: File) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${clientId}/${Date.now()}_${safe}`;
    const { error } = await supabase.storage.from('advisor-reports')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) throw new Error(error.message);
    return path;
  },
  async advisorReportFileUrl(path: string) {
    const { data, error } = await supabase.storage.from('advisor-reports').createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
  async createAdvisorReport(row: Record<string, any>) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('advisor_report')
      .insert({ ...row, uploaded_by: session?.user?.id || null }).select('id').single();
    if (error) throw new Error(error.message);
    return data.id as number;
  },
  async getAdvisorReports(ownerClientId: number) {
    const { data, error } = await supabase.from('advisor_report')
      .select('*').eq('owner_client_id', ownerClientId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async deleteAdvisorReport(id: number, storagePath?: string | null) {
    if (storagePath) await supabase.storage.from('advisor-reports').remove([storagePath]);
    const { error } = await supabase.from('advisor_report').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Tax returns (personal income tax — individual clients only) ---------
  async listTaxReturns(clientId: number) {
    const { data, error } = await supabase.from('tax_returns')
      .select('id, tax_year, form_type, status, reference_number, updated_at, submitted_at')
      .eq('client_id', clientId)
      .order('tax_year', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async getTaxReturn(id: number) {
    const { data, error } = await supabase.from('tax_returns')
      .select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data;
  },
  async createTaxReturn(row: { client_id: number; tax_year: number; form_type?: 'individuals' | 'self_employed'; input_data?: any; results?: any; status?: string; notes?: string }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('tax_returns')
      .insert({ ...row, created_by: session?.user?.id || null })
      .select('id').single();
    if (error) throw new Error(error.message);
    return data.id as number;
  },
  async updateTaxReturn(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('tax_returns').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteTaxReturn(id: number) {
    const { error } = await supabase.from('tax_returns').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Client onboarding / refresh questionnaire (migration 120) ---------
  // Public (token-keyed) — callable by an anonymous browser via SECURITY DEFINER RPCs.
  async getClientIntake(token: string) {
    const { data, error } = await supabase.rpc('get_client_intake_by_token', { p_token: token });
    if (error) throw new Error(error.message);
    return (data as any[])?.[0] || null; // RPC returns a table → take first row
  },
  async submitClientIntake(token: string, payload: any) {
    const { data, error } = await supabase.rpc('submit_client_intake_by_token', { p_token: token, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as { ok: boolean; error?: string };
  },
  // Staff-side — create an intake link for a client (or a blank new-client intake).
  async createClientIntake(params: { clientId?: number | null; mode?: 'new' | 'refresh'; expiresInDays?: number }) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = (crypto as any).randomUUID
      ? crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 8)
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const expires_at = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 864e5).toISOString()
      : null;
    const { data, error } = await supabase.from('client_intake_submissions')
      .insert({
        token,
        client_id: params.clientId ?? null,
        mode: params.mode || (params.clientId ? 'refresh' : 'new'),
        status: 'pending',
        created_by: session?.user?.id || null,
        sent_at: new Date().toISOString(),
        expires_at,
      })
      .select('id, token').single();
    if (error) throw new Error(error.message);
    return data as { id: number; token: string };
  },
  async listClientIntakes(status?: string) {
    let q = supabase.from('client_intake_submissions')
      .select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },
  async reviewClientIntake(id: number, patch: { status: 'approved' | 'rejected'; notes?: string }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('client_intake_submissions')
      .update({ ...patch, reviewed_by: session?.user?.id || null, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Public (token-keyed) — upload an onboarding attachment via the intake-upload
  // edge function (anon can't write storage directly; the function validates the
  // token with the service role and appends the file to the submission).
  async uploadIntakeFile(token: string, file: File, kind: string) {
    const fd = new FormData();
    fd.append('token', token);
    fd.append('kind', kind);
    fd.append('file', file);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/intake-upload`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY }, // no Content-Type — the browser sets the multipart boundary
      body: fd,
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Upload failed.' }));
    if (!data.ok) throw new Error(data.error || 'Upload failed.');
    return data.file as IntakeAttachment;
  },
  // Staff-side — short-lived signed URL to view/download an intake attachment.
  async intakeAttachmentUrl(storagePath: string) {
    const { data, error } = await supabase.storage.from('intake-attachments').createSignedUrl(storagePath, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  // --------- User SMTP settings (per-user Outlook credentials for sending email) ---------
  // The plaintext password is never returned via the table read — only the
  // SECURITY DEFINER get_user_smtp_password() RPC can decrypt it, and that's
  // intended to be called from the send-mail Edge Function (Phase B).
  async getMySmtpSettings() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data, error } = await supabase.from('user_smtp_settings')
      .select('user_id, smtp_host, smtp_port, smtp_secure, smtp_user, from_name, is_active, last_used_at, last_error, smtp_password_enc, signature_html, signature_text, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const hasPassword = !!data.smtp_password_enc;
    const { smtp_password_enc, ...rest } = data as any;
    void smtp_password_enc;
    return { ...rest, has_password: hasPassword };
  },
  async saveMySmtpSettings(row: {
    smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
    smtp_user: string; from_name?: string | null; is_active?: boolean;
    signature_html?: string | null; signature_text?: string | null;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) throw new Error('Not authenticated');
    const payload = {
      user_id: session.user.id,
      smtp_host: row.smtp_host || 'smtp.office365.com',
      smtp_port: row.smtp_port ?? 587,
      smtp_secure: row.smtp_secure ?? false,
      smtp_user: row.smtp_user,
      from_name: row.from_name ?? null,
      is_active: row.is_active ?? true,
      signature_html: row.signature_html ?? null,
      signature_text: row.signature_text ?? null,
    };
    const { error } = await supabase.from('user_smtp_settings').upsert(payload, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
  },
  async setMySmtpPassword(password: string) {
    // Calls the SECURITY DEFINER fn which encrypts the password with the
    // Vault-stored key. Only the current user's row is affected (auth.uid()).
    const { error } = await supabase.rpc('set_user_smtp_password', { p_password: password });
    if (error) throw new Error(error.message);
  },
  async deleteMySmtpSettings() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) throw new Error('Not authenticated');
    const { error } = await supabase.from('user_smtp_settings').delete().eq('user_id', session.user.id);
    if (error) throw new Error(error.message);
  },

  // --------- Admin: manage ANOTHER staff user's SMTP settings ---------
  // Backed by the SECURITY DEFINER RPCs in migration 115, each gated on the
  // caller holding users.write. Lets the firm owner set up email per user from
  // User Management. The plaintext password is never returned here.
  async adminGetUserSmtpSettings(userId: string) {
    const { data, error } = await supabase.rpc('admin_get_user_smtp_settings', { p_user_id: userId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as null | {
      smtp_host: string; smtp_port: number; smtp_secure: boolean; smtp_user: string;
      from_name: string | null; is_active: boolean; has_password: boolean;
      last_used_at: string | null; last_error: string | null;
      signature_html: string | null; signature_text: string | null; updated_at: string;
    };
  },
  async adminSaveUserSmtpSettings(userId: string, row: {
    smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
    smtp_user: string; from_name?: string | null; is_active?: boolean;
    signature_html?: string | null; signature_text?: string | null;
  }) {
    const { error } = await supabase.rpc('admin_upsert_user_smtp_settings', {
      p_user_id: userId,
      p_smtp_host: row.smtp_host || 'smtp.office365.com',
      p_smtp_port: row.smtp_port ?? 587,
      p_smtp_secure: row.smtp_secure ?? false,
      p_smtp_user: row.smtp_user,
      p_from_name: row.from_name ?? null,
      p_is_active: row.is_active ?? true,
      p_signature_html: row.signature_html ?? null,
      p_signature_text: row.signature_text ?? null,
    });
    if (error) throw new Error(error.message);
  },
  async adminSetUserSmtpPassword(userId: string, password: string) {
    const { error } = await supabase.rpc('admin_set_user_smtp_password', { p_user_id: userId, p_password: password });
    if (error) throw new Error(error.message);
  },
  async adminDeleteUserSmtpSettings(userId: string) {
    const { error } = await supabase.rpc('admin_delete_user_smtp_settings', { p_user_id: userId });
    if (error) throw new Error(error.message);
  },

  // --------- Firm sending identity (info@) — migration 117, users.write-gated ---------
  async adminGetFirmEmailSettings() {
    const { data, error } = await supabase.rpc('admin_get_firm_email_settings');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as null | {
      smtp_host: string; smtp_port: number; smtp_secure: boolean; smtp_user: string | null;
      from_name: string | null; is_active: boolean; has_password: boolean;
      signature_html: string | null; signature_text: string | null; updated_at: string;
    };
  },
  async adminSaveFirmEmailSettings(row: {
    smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
    smtp_user: string; from_name?: string | null; is_active?: boolean;
    signature_html?: string | null; signature_text?: string | null;
  }) {
    const { error } = await supabase.rpc('admin_upsert_firm_email_settings', {
      p_smtp_host: row.smtp_host || 'smtp.gmail.com',
      p_smtp_port: row.smtp_port ?? 587,
      p_smtp_secure: row.smtp_secure ?? false,
      p_smtp_user: row.smtp_user,
      p_from_name: row.from_name ?? null,
      p_is_active: row.is_active ?? true,
      p_signature_html: row.signature_html ?? null,
      p_signature_text: row.signature_text ?? null,
    });
    if (error) throw new Error(error.message);
  },
  async adminSetFirmEmailPassword(password: string) {
    const { error } = await supabase.rpc('admin_set_firm_email_password', { p_password: password });
    if (error) throw new Error(error.message);
  },
  // Staff-readable firm signature (migration 126) — just the signature fields,
  // so any staff member composing from the shared Inbox can insert it. Never
  // exposes SMTP credentials.
  async getFirmEmailSignature(): Promise<{ signature_html: string | null; signature_text: string | null }> {
    const { data, error } = await supabase.rpc('get_firm_email_signature');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { signature_html: row?.signature_html ?? null, signature_text: row?.signature_text ?? null };
  },

  // --------- Shared firm inbox (info@) — populated by poll-inbox Edge Function ---------
  // Two-way in the app: staff view mail, and compose/reply (inbox-send) plus
  // read/archive/trash (inbox-action) sync back to Gmail.
  async getInboxEmails(opts?: { limit?: number; unreadOnly?: boolean }) {
    let q = supabase.from('inbox_emails')
      .select('id, gmail_thread_id, from_email, from_name, to_emails, label_ids, subject, snippet, received_at, has_attachments, is_read, flagged, is_urgent')
      .order('received_at', { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.unreadOnly) q = q.eq('is_read', false);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },
  async getInboxEmail(id: number) {
    const { data, error } = await supabase.from('inbox_emails')
      .select('*, attachments:inbox_email_attachments(id, filename, mime_type, size_bytes, storage_path)')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async markInboxRead(id: number, read = true) {
    const { error } = await supabase.from('inbox_emails').update({ is_read: read }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // Local follow-up flag / urgent marker (migration 127) — portal-managed, not
  // synced to Gmail.
  async setInboxFlags(id: number, patch: { flagged?: boolean; is_urgent?: boolean }) {
    const { error } = await supabase.from('inbox_emails').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  // All messages in one Gmail conversation (oldest first), for the threaded view.
  async getInboxThread(gmailThreadId: string) {
    const { data, error } = await supabase.from('inbox_emails')
      .select('*, attachments:inbox_email_attachments(id, filename, mime_type, size_bytes, storage_path)')
      .eq('gmail_thread_id', gmailThreadId)
      .order('received_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },
  // Write-back to Gmail (mark read/unread, archive, trash, untrash) via gmail.modify;
  // the Edge Function mirrors Gmail's resulting labels into inbox_emails.
  async inboxAction(action: 'read' | 'unread' | 'archive' | 'trash' | 'untrash', ids: number | number[]) {
    const inbox_email_ids = Array.isArray(ids) ? ids : [ids];
    const { data, error } = await supabase.functions.invoke('inbox-action', { body: { action, inbox_email_ids } });
    if (error) {
      let msg = error.message;
      try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    if (data && data.ok === false && (!data.results || !data.results.length)) {
      throw new Error(data.error || (data.errors && data.errors[0]?.error) || 'Action failed');
    }
    return data as { ok: boolean; action: string; results: { id: number; label_ids: string[]; is_read: boolean }[]; errors?: { id: number; error: string }[] };
  },
  async getInboxAttachmentUrl(storagePath: string) {
    const { data, error } = await supabase.storage
      .from('inbox-attachments').createSignedUrl(storagePath, 120);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
  async getInboxUnreadCount() {
    const { count, error } = await supabase.from('inbox_emails')
      .select('id', { count: 'exact', head: true }).eq('is_read', false);
    if (error) throw new Error(error.message);
    return count || 0;
  },
  // Poller health (last run / last error) — email_sync_state is service-role-only,
  // exposed to staff via the SECURITY DEFINER RPC from migration 124.
  async getInboxSyncStatus(mailbox = 'info@primeandcalculate.com') {
    const { data, error } = await supabase.rpc('get_inbox_sync_status', { p_mailbox: mailbox });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return (row || null) as null | {
      mailbox: string;
      last_run_at: string | null;
      last_error: string | null;
      has_cursor: boolean;
      message_count: number;
      unread_count: number;
      latest_received_at: string | null;
    };
  },
  // Manually run the poller now (the "Sync now" button). Goes through poll-inbox's
  // staff-JWT path; returns the live counts so the user sees the result/error.
  async triggerInboxSync() {
    const { data, error } = await supabase.functions.invoke('poll-inbox', { body: {} });
    if (error) {
      // Surface the function's own error message when available (FunctionsHttpError
      // carries the Response in .context), otherwise the generic non-2xx message.
      let msg = error.message;
      try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    if (data && data.ok === false) throw new Error(data.error || 'Sync failed');
    return data as { ok: true; trigger: string; mode: string; scanned: number; stored: number; duplicate: number; failed: number };
  },
  // Send mail FROM info@ via the Gmail API (compose / reply / forward). Threaded
  // when reply_to_inbox_id is set. Sent message lands in Gmail's Sent folder and
  // surfaces in the Inbox after the next poll.
  async sendInboxEmail(payload: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body_html: string;
    reply_to_inbox_id?: number;
    attachments?: { filename: string; mime_type?: string; content_base64: string }[];
  }) {
    const { data, error } = await supabase.functions.invoke('inbox-send', { body: payload });
    if (error) {
      let msg = error.message;
      try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    if (data && data.ok === false) throw new Error(data.error || 'Send failed');
    return data as { ok: true; gmail_message_id?: string; gmail_thread_id?: string };
  },
  // File a shared-inbox email against a client (Emails tab + Documents). The
  // copy/cross-bucket work happens server-side in the assign-inbox-email fn.
  async assignInboxEmailToClient(inboxEmailId: number, clientId: number) {
    const { data, error } = await supabase.functions.invoke('assign-inbox-email', {
      body: { inbox_email_id: inboxEmailId, client_id: clientId },
    });
    if (error) throw new Error(error.message);
    if (data && data.ok === false) throw new Error(data.error || 'Assign failed');
    return data as { ok: true; already?: boolean; attachments_copied?: number };
  },
  // Invokes the send-via-outlook Edge Function which relays mail through the
  // caller's own Outlook account. Attachments arrive base64-encoded so PDFs
  // generated client-side travel inline.
  async sendViaOutlook(payload: {
    to: string;
    subject: string;
    body: string;
    html?: string;
    attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
    // Admin only (users.write): send the test through another user's SMTP account.
    as_user_id?: string;
    // Send through the shared firm identity (info@) instead of the caller's own.
    from_firm?: boolean;
  }) {
    const { data, error } = await supabase.functions.invoke('send-via-outlook', { body: payload });
    if (error) {
      // supabase-js wraps any fetch failure (function not deployed, network,
      // CORS, etc.) as the same opaque "Failed to send a request" error. Pull
      // status + body off the error (when present) so the actual cause shows
      // through.
      const ctx = (error as any)?.context;
      const ctxStatus: number | undefined = ctx?.status;
      // The Response on the error is a real Response object — we have to
      // .text()/.json() it to see what the function returned. Async hop is
      // unavoidable here.
      let bodyText = '';
      try {
        if (ctx?.response && typeof ctx.response.text === 'function') {
          bodyText = await ctx.response.text();
        } else if (typeof ctx?.body === 'string') {
          bodyText = ctx.body;
        }
      } catch { /* swallow */ }
      // Parse JSON body if possible so the user sees the actual error string
      // (the function returns { ok: false, error: '...' }).
      let parsed: any = null;
      try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { /* not JSON */ }
      const fnError = parsed?.error || bodyText || null;

      const hint = ctxStatus === 404
        ? 'Edge Function "send-via-outlook" not found. Deploy it from supabase/functions/send-via-outlook/index.ts.'
        : ctxStatus === 401
        ? 'Auth missing — reload the page to refresh your session.'
        : ctxStatus === 400 && (fnError || '').toLowerCase().includes('no outlook account')
        ? 'Save your SMTP credentials in Settings → Email first (click "Save Settings", then "Send test email").'
        : ctxStatus === 400 && (fnError || '').toLowerCase().includes('inactive')
        ? 'Your SMTP settings are marked inactive in Settings → Email. Tick "Active" and save.'
        : ctxStatus
        ? `Function responded ${ctxStatus}. Check Supabase → Functions → send-via-outlook → Logs.`
        : 'Network call to Supabase Edge Functions failed. Most likely the function is not deployed, the Supabase project is paused, or there is a connectivity issue.';
      const detail = [
        fnError || error.message,
        hint,
      ].filter(Boolean).join('\n');
      throw new Error(detail);
    }
    if (data && data.ok === false) throw new Error(data.error || 'Send failed');
    return data as { ok: true };
  },

  // --------- Customer invoices (a client billing their own customers) ---------
  async getCustomerInvoices(ownerClientId: number, params?: { status?: string; customer_id?: number }) {
    let q = supabase.from('customer_invoice')
      .select('*, customer:customer(name)')
      .eq('owner_client_id', ownerClientId)
      .order('issue_date', { ascending: false, nullsFirst: true })
      .order('id', { ascending: false });
    if (params?.status)      q = q.eq('status', params.status);
    if (params?.customer_id) q = q.eq('customer_id', params.customer_id);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({ ...r, customer_name: r.customer?.name || null }));
  },
  async getCustomerInvoice(id: number) {
    const [{ data: inv, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
      supabase.from('customer_invoice')
        .select('*, customer:customer(name, address, email, phone, vat_number)')
        .eq('id', id).maybeSingle(),
      supabase.from('customer_invoice_line').select('*').eq('invoice_id', id)
        .order('line_no', { ascending: true }).order('id', { ascending: true }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (!inv) throw new Error('Invoice not found');
    return { ...inv, lines: lines || [] };
  },
  async createCustomerInvoice(data: {
    owner_client_id: number; customer_id: number;
    issue_date?: string | null; due_date?: string | null; notes?: string | null;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('customer_invoice').insert({
      owner_client_id: data.owner_client_id,
      customer_id:     data.customer_id,
      issue_date:      data.issue_date || null,
      due_date:        data.due_date || null,
      notes:           data.notes ?? null,
      created_by:      session?.user?.id || null,
    }).select('id').single();
    if (error) throw new Error(error.message);
    return { id: row.id as number };
  },
  async updateCustomerInvoice(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('customer_invoice').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async addCustomerInvoiceLine(invoiceId: number, line: Record<string, any>) {
    const { data, error } = await supabase.from('customer_invoice_line')
      .insert({ invoice_id: invoiceId, ...line }).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
  async updateCustomerInvoiceLine(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('customer_invoice_line').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteCustomerInvoiceLine(id: number) {
    const { error } = await supabase.from('customer_invoice_line').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  async issueCustomerInvoice(id: number) {
    const { data, error } = await supabase.rpc('issue_customer_invoice', { p_id: id });
    if (error) throw new Error(error.message);
    return data as string;
  },
  async markCustomerInvoicePaid(id: number, paidDate?: string, method?: string) {
    const { data, error } = await supabase.rpc('mark_customer_invoice_paid', {
      p_id: id, p_paid_date: paidDate || null, p_method: method || null,
    });
    if (error) throw new Error(error.message);
    return data as string;   // the new receipt number
  },
  async getCustomerReceiptForInvoice(invoiceId: number) {
    const { data, error } = await supabase.from('customer_receipt')
      .select('id, receipt_number').eq('invoice_id', invoiceId).maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: number; receipt_number: string } | null;
  },
  async getCustomerReceipt(id: number) {
    const { data, error } = await supabase.from('customer_receipt')
      .select('*, customer:customer(name, address, vat_number), invoice:customer_invoice(invoice_number)')
      .eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async getCustomerReceipts(ownerClientId: number) {
    const { data, error } = await supabase.from('customer_receipt')
      .select('*, customer:customer(name), invoice:customer_invoice(invoice_number)')
      .eq('owner_client_id', ownerClientId)
      .order('receipt_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({ ...r, customer_name: r.customer?.name || null, invoice_number: r.invoice?.invoice_number || null }));
  },
  async cancelCustomerInvoice(id: number) {
    const { error } = await supabase.rpc('cancel_customer_invoice', { p_id: id });
    if (error) throw new Error(error.message);
  },

  // --------- Service presets (reusable invoice line descriptions) ---------
  async getServicePresets(opts?: { activeOnly?: boolean }) {
    let q = supabase.from('service_presets').select('*')
      .order('sort_order', { ascending: true })
      .order('description', { ascending: true });
    if (opts?.activeOnly) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async saveServicePreset(preset: {
    id?: number; description: string; default_price?: number | null;
    vatable?: boolean; sort_order?: number; active?: boolean;
  }) {
    const row = {
      description:   preset.description,
      default_price: preset.default_price ?? null,
      vatable:       preset.vatable ?? true,
      sort_order:    preset.sort_order ?? 0,
      active:        preset.active ?? true,
    };
    if (preset.id) {
      const { error } = await supabase.from('service_presets').update(row).eq('id', preset.id);
      if (error) throw new Error(error.message);
      return preset.id;
    }
    const { data, error } = await supabase.from('service_presets').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return data.id as number;
  },

  async deleteServicePreset(id: number) {
    const { error } = await supabase.from('service_presets').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Invoice lines ---------
  async addInvoiceLine(invoiceId: number, line: {
    line_no?: number;
    line_type: 'time' | 'fixed' | 'expense' | 'remarks';
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
    vatable: boolean;
    vat_rate?: number;
    time_entry_id?: number | null;
  }) {
    const { data, error } = await supabase.from('client_invoice_lines').insert({
      invoice_id:     invoiceId,
      line_no:        line.line_no ?? 1,
      line_type:      line.line_type,
      description:    line.description,
      quantity:       line.quantity,
      unit_price:     line.unit_price,
      amount:         line.amount,
      vatable:        line.vatable,
      vat_rate:       line.vat_rate ?? (line.vatable ? 19 : 0),
      time_entry_id:  line.time_entry_id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateInvoiceLine(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('client_invoice_lines').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteInvoiceLine(id: number) {
    const { error } = await supabase.from('client_invoice_lines').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async createTimeEntry(data: {
    client_id?: number | null;
    entry_date: string;
    minutes: number;
    service: string;
    description?: string | null;
    billable?: boolean;
    appointment_id?: number | null;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error('Not authenticated');
    const { data: row, error } = await supabase.from('time_entries').insert({
      user_id:        session.user.id,
      client_id:      data.client_id || null,
      entry_date:     data.entry_date,
      minutes:        data.minutes,
      service:        data.service,
      description:    data.description || null,
      billable:       data.billable !== false,
      appointment_id: data.appointment_id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateTimeEntry(id: number, patch: {
    client_id?: number | null;
    entry_date?: string;
    minutes?: number;
    service?: string;
    description?: string | null;
    billable?: boolean;
    appointment_id?: number | null;
  }) {
    const { error } = await supabase.from('time_entries').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteTimeEntry(id: number) {
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async getActiveTimer() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const { data, error } = await supabase.from('active_timers')
      .select('*, client:clients(name, client_code)')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      ...data,
      client_name: data.client?.name || null,
      client_code: data.client?.client_code || null,
    };
  },

  async startTimer(data: {
    client_id?: number | null;
    service?: string | null;
    description?: string | null;
    appointment_id?: number | null;
    billable?: boolean;
  }) {
    const { error } = await supabase.rpc('start_timer', {
      p_client_id:      data.client_id || null,
      p_service:        data.service || null,
      p_description:    data.description || null,
      p_appointment_id: data.appointment_id || null,
      p_billable:       data.billable !== false,
    });
    if (error) throw new Error(error.message);
  },

  async stopTimer(data?: { description?: string | null; service?: string | null }) {
    const { data: id, error } = await supabase.rpc('stop_timer', {
      p_description: data?.description || null,
      p_service:     data?.service || null,
    });
    if (error) throw new Error(error.message);
    return id as number | null;
  },

  async cancelTimer() {
    const { error } = await supabase.rpc('cancel_timer');
    if (error) throw new Error(error.message);
  },

  async updateUserHourlyRate(userId: string, rate: number | null) {
    const { error } = await supabase.from('profiles')
      .update({ hourly_rate: rate })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  },

  // --------- Company Settings ---------
  async getCompanySettings() {
    const { data, error } = await supabase.from('company_settings')
      .select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    // Migration 046 seeds the row, but be defensive in case of older DBs
    return data || {
      id: 1, name: null, legal_name: null, registration_number: null,
      tax_id: null, vat_number: null,
      address_line1: null, address_line2: null, city: null, postal_code: null, country: null,
      phone: null, email: null, website: null,
      iban: null, bank_name: null,
      logo_url: null, tagline: null, report_footer: null,
      default_service_rates: {},
      autoreply_enabled: true, office_open_hour: 8, office_close_hour: 17,
      office_days: [1, 2, 3, 4, 5], office_timezone: 'Europe/Nicosia',
      autoreply_message: 'Thank you for your message. Our office is currently closed — a member of our team will get back to you during working hours.',
    };
  },

  async updateCompanySettings(patch: Record<string, any>) {
    const { error } = await supabase.from('company_settings')
      .update(patch).eq('id', 1);
    if (error) throw new Error(error.message);
  },

  // Upload a logo file to the public 'company-assets' bucket and return its
  // public URL. Caller is responsible for persisting the URL via
  // updateCompanySettings({ logo_url }).
  async uploadCompanyLogo(file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext) ? ext : 'png';
    // Bust browser/CDN caches by using a fresh timestamped key each upload.
    const key = `logo-${Date.now()}.${safeExt}`;
    const { error } = await supabase.storage
      .from('company-assets')
      .upload(key, file, { upsert: true, contentType: file.type || 'image/png' });
    if (error) throw new Error(error.message);
    const { data: pub } = supabase.storage.from('company-assets').getPublicUrl(key);
    return pub.publicUrl;
  },

  // --------- Per-staff service rates ---------
  async getStaffServiceRates(userId: string) {
    const { data, error } = await supabase.from('staff_service_rates')
      .select('*').eq('user_id', userId);
    if (error) throw new Error(error.message);
    return (data || []) as { user_id: string; service: string; rate: number }[];
  },

  // Upsert one service's rate for a user. Pass rate = null to clear (delete).
  async setStaffServiceRate(userId: string, service: string, rate: number | null) {
    if (rate === null) {
      const { error } = await supabase.from('staff_service_rates')
        .delete().eq('user_id', userId).eq('service', service);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await supabase.from('staff_service_rates')
      .upsert({ user_id: userId, service, rate }, { onConflict: 'user_id,service' });
    if (error) throw new Error(error.message);
  },

  // --------- Task Templates ---------
  async getTaskTemplates() {
    const { data, error } = await supabase.from('task_templates').select('*').order('name');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getTaskTemplate(id: number) {
    const [tplR, itemsR] = await Promise.all([
      supabase.from('task_templates').select('*').eq('id', id).single(),
      supabase.from('task_template_items').select('*').eq('template_id', id)
        .order('ordinal', { ascending: true })
        .order('id', { ascending: true }),
    ]);
    if (tplR.error)   throw new Error(tplR.error.message);
    if (itemsR.error) throw new Error(itemsR.error.message);
    return { ...tplR.data, items: itemsR.data || [] };
  },

  async createTaskTemplate(data: { name: string; description?: string }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('task_templates').insert({
      name: data.name,
      description: data.description || null,
      created_by: session?.user?.id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateTaskTemplate(id: number, patch: { name?: string; description?: string | null }) {
    const { error } = await supabase.from('task_templates').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteTaskTemplate(id: number) {
    const { error } = await supabase.from('task_templates').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async createTaskTemplateItem(templateId: number, data: {
    title: string; description?: string | null;
    default_priority?: 'low' | 'medium' | 'high' | 'urgent';
    days_offset?: number | null; default_assignee?: string | null;
    ordinal?: number;
  }) {
    const { data: row, error } = await supabase.from('task_template_items').insert({
      template_id: templateId,
      ordinal:          data.ordinal ?? 0,
      title:            data.title,
      description:      data.description || null,
      default_priority: data.default_priority || 'medium',
      days_offset:      data.days_offset ?? null,
      default_assignee: data.default_assignee || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateTaskTemplateItem(id: number, patch: any) {
    const { error } = await supabase.from('task_template_items').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteTaskTemplateItem(id: number) {
    const { error } = await supabase.from('task_template_items').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async applyTaskTemplate(
    templateId: number,
    opts: { client_id?: number | null; apply_date?: string; assignee?: string | null } = {}
  ) {
    const { data, error } = await supabase.rpc('apply_task_template', {
      p_template_id:       templateId,
      p_client_id:         opts.client_id || null,
      p_apply_date:        opts.apply_date || null,
      p_assignee_override: opts.assignee || null,
    });
    if (error) throw new Error(error.message);
    return { count: Number(data || 0) };
  },

  // --------- Staff Tasks ---------
  async getStaffTasks(params?: {
    assignee?: string;
    status?: string;
    priority?: string;
    client_id?: number;
    from?: string;
    to?: string;
    category?: string;
    // Migration 102: defaults to live rows only. Pass 'deleted' for the
    // trash view, 'all' to include both.
    deleted?: 'live' | 'deleted' | 'all';
  }) {
    let q = supabase.from('staff_tasks')
      .select('*, client:clients(name, client_code), stage:service_stages(key, label, service:service_definitions(key, label))')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (params?.assignee)  q = q.eq('assigned_to', params.assignee);
    if (params?.status)    q = q.eq('status', params.status);
    if (params?.priority)  q = q.eq('priority', params.priority);
    if (params?.client_id) q = q.eq('client_id', params.client_id);
    if (params?.category)  q = q.eq('category', params.category);
    if (params?.from)      q = q.gte('due_date', params.from);
    if (params?.to)        q = q.lte('due_date', params.to);
    if (!params?.deleted || params.deleted === 'live') q = q.is('deleted_at', null);
    else if (params.deleted === 'deleted')             q = q.not('deleted_at', 'is', null);
    // 'all' adds no filter.
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((t: any) => ({
      ...t,
      client_name: t.client?.name || null,
      client_code: t.client?.client_code || null,
      stage_key:     t.stage?.key || null,
      stage_label:   t.stage?.label || null,
      service_key:   t.stage?.service?.key || null,
      service_label: t.stage?.service?.label || null,
    }));
  },

  async createStaffTask(data: {
    title: string;
    description?: string;
    client_id?: number | null;
    assigned_to?: string | null;
    due_date?: string | null;
    priority?: string;
    status?: string;
    category?: string;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data: row, error } = await supabase.from('staff_tasks').insert({
      title:        data.title,
      description:  data.description || null,
      client_id:    data.client_id || null,
      assigned_to:  data.assigned_to || null,
      created_by:   session?.user?.id || null,
      due_date:     data.due_date || null,
      priority:     data.priority || 'medium',
      status:       data.status || 'open',
      category:     data.category || 'general',
    }).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateStaffTask(id: number, patch: any) {
    // Auto-stamp completed_at when status flips to 'done'
    const finalPatch: any = { ...patch };
    if (patch.status === 'done' && patch.completed_at === undefined) {
      finalPatch.completed_at = new Date().toISOString();
    }
    if (patch.status && patch.status !== 'done' && patch.completed_at === undefined) {
      finalPatch.completed_at = null;
    }
    const { error } = await supabase.from('staff_tasks').update(finalPatch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Soft delete (migration 102 + 109). Supervisor-only on the DB side via
  // SECURITY DEFINER RPCs — the UI hides the button too, but this is the
  // defence in depth. The row stays in the table; the "Show: Deleted"
  // filter brings it back. Use purgeStaffTask for a real hard delete
  // (admin-only flow, not wired into the default UI).
  async deleteStaffTask(id: number) {
    const { error } = await supabase.rpc('soft_delete_staff_task', { p_id: id });
    if (error) throw new Error(error.message);
  },
  async restoreStaffTask(id: number) {
    const { error } = await supabase.rpc('restore_staff_task', { p_id: id });
    if (error) throw new Error(error.message);
  },
  async purgeStaffTask(id: number) {
    const { error } = await supabase.from('staff_tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // For the sidebar badge: count of new (still-open) tasks assigned to me
  // that were created after I last viewed the Tasks page.
  async countNewTasksForUser(userId: string, sinceIso: string) {
    const { count, error } = await supabase
      .from('staff_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', userId)
      .in('status', ['open', 'in_progress', 'blocked'])
      .gt('created_at', sinceIso);
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // --------- Audit logging ---------
  async getAuditLog(filters?: {
    actor?: string;
    action?: string;
    target_type?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    let q = supabase.from('audit_log').select('*').order('ts', { ascending: false });
    if (filters?.actor)       q = q.eq('actor_email', filters.actor);
    if (filters?.action)      q = q.eq('action', filters.action);
    if (filters?.target_type) q = q.eq('target_type', filters.target_type);
    if (filters?.from)        q = q.gte('ts', filters.from);
    if (filters?.to)          q = q.lte('ts', filters.to + 'T23:59:59');
    const limit  = filters?.limit  ?? 200;
    const offset = filters?.offset ?? 0;
    q = q.range(offset, offset + limit - 1);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  // --------- View preferences (per-user, cross-device) ---------
  async getMyViewPreferences(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return {};
    const { data, error } = await supabase
      .from('profiles')
      .select('view_preferences')
      .eq('id', session.user.id)
      .single();
    if (error || !data) return {};
    return (data.view_preferences as Record<string, string>) || {};
  },

  async setMyViewPreference(page: string, mode: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    // Read-modify-write so we don't clobber other preferences in the same JSONB.
    const { data: row } = await supabase
      .from('profiles')
      .select('view_preferences')
      .eq('id', session.user.id)
      .single();
    const next = { ...(row?.view_preferences || {}), [page]: mode };
    const { error } = await supabase
      .from('profiles')
      .update({ view_preferences: next })
      .eq('id', session.user.id);
    if (error) throw new Error(error.message);
  },

  // --------- Bulk operations on clients (Phase 6 E5) ---------
  async bulkUpdateClientStatus(ids: number[], clientStatus: string) {
    if (ids.length === 0) return 0;
    const isActive = clientStatus === 'active';
    const { error, count } = await supabase
      .from('clients')
      .update({ client_status: clientStatus, is_active: isActive, status: isActive ? 'active' : 'inactive' }, { count: 'exact' })
      .in('id', ids);
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // Part 6D — bulk set/clear the vendor flag.
  async bulkSetVendor(ids: number[], isVendor: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const { error, count } = await supabase
      .from('clients')
      .update({ is_vendor: isVendor }, { count: 'exact' })
      .in('id', ids);
    if (error) throw new Error(error.message);
    return count || 0;
  },

  async bulkAddTagToClients(ids: number[], tag: string): Promise<number> {
    const { data, error } = await supabase.rpc('bulk_add_tag_to_clients', { p_ids: ids, p_tag: tag });
    if (error) throw new Error(error.message);
    return (data as number) || 0;
  },

  // --------- Bulk wipe / code-gen v2 (Phase 1-3 of clients v2) ---------
  async estimateWipeTestClients(): Promise<Record<string, number>> {
    const { data, error } = await supabase.rpc('estimate_wipe_test_clients');
    if (error) throw new Error(error.message);
    return (data || {}) as Record<string, number>;
  },

  async wipeTestClients(confirmation: string): Promise<Record<string, number>> {
    const { data, error } = await supabase.rpc('wipe_test_clients', { p_confirmation: confirmation });
    if (error) throw new Error(error.message);
    return (data || {}) as Record<string, number>;
  },


  // Standalone Passwords/Credentials page — all credentials across all clients
  // plus firm-owned (client_id IS NULL) ones with an owner_label.
  async getAllCredentials() {
    const { data, error } = await supabase
      .from('platform_credentials')
      .select('id, client_id, platform, sub_type, username, notes, owner_label, url, site:platform_sites(url), client:clients(name, client_code, deleted_at)')
      .order('platform', { ascending: true })
      .order('sub_type', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((r: any) => !r.client?.deleted_at)
      .map((r: any) => ({
        ...r,
        client_name: r.client?.name || null,
        client_code: r.client?.client_code || null,
        // Same rule as getCredentials: a per-credential URL overrides the
        // platform site's default. The vault had no URL at all before this.
        effective_url: r.url || r.site?.url || null,
      }));
  },

  async createCredentialV2(row: {
    client_id?: number | null;
    owner_label?: string;
    platform: string;
    sub_type?: string;
    username?: string;
    password?: string;
    notes?: string;
  }) {
    const insertRow: any = {
      client_id:   row.client_id || null,
      owner_label: row.owner_label || null,
      platform:    row.platform,
      sub_type:    row.sub_type || null,
      username:    row.username || null,
      notes:       row.notes || null,
    };
    const { data, error } = await supabase
      .from('platform_credentials')
      .insert(insertRow)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    if (row.password) {
      const { error: pwErr } = await supabase.rpc('set_credential_password', {
        p_id: (data as any).id, p_password: row.password,
      });
      if (pwErr) throw new Error(pwErr.message);
    }
    return data;
  },

  async updateCredentialV2(id: number, patch: any) {
    const { password, ...rest } = patch;
    if (Object.keys(rest).length > 0) {
      const cleaned: any = { ...rest };
      if (cleaned.client_id === '' || cleaned.client_id === undefined) cleaned.client_id = null;
      for (const k of ['owner_label', 'sub_type', 'username', 'notes']) {
        if (cleaned[k] === '') cleaned[k] = null;
      }
      const { error } = await supabase
        .from('platform_credentials')
        .update(cleaned)
        .eq('id', id);
      if (error) throw new Error(error.message);
    }
    if (password !== undefined && password !== null) {
      const { error: pwErr } = await supabase.rpc('set_credential_password', {
        p_id: id, p_password: password,
      });
      if (pwErr) throw new Error(pwErr.message);
    }
  },

  async deleteCredentialV2(id: number) {
    const { error } = await supabase
      .from('platform_credentials')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async upsertCredentialForClient(clientId: number, row: { platform: string; username?: string; password?: string; notes?: string }) {
    // Insert a credential row, then encrypt the password via the existing
    // set_credential_password RPC (audit-logged + permission-gated).
    const { data, error } = await supabase
      .from('platform_credentials')
      .insert({
        client_id: clientId,
        platform: row.platform,
        username: row.username || '',
        notes: row.notes || '',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    if (row.password) {
      const { error: pwErr } = await supabase.rpc('set_credential_password', {
        p_id: (data as any).id,
        p_password: row.password,
      });
      if (pwErr) throw new Error(pwErr.message);
    }
    return data;
  },

  // --------- Client directors (Phase 1B of clients v2) ---------
  async getClientDirectors(clientId: number) {
    const { data, error } = await supabase
      .from('client_directors')
      .select('*')
      .eq('client_id', clientId)
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Unlinked directors — name present but director_client_id is null.
  // Used by the /admin/unlinked-directors page.
  async getUnlinkedDirectors() {
    const { data, error } = await supabase
      .from('client_directors')
      .select('*, company:clients!client_id(id, name, client_code, deleted_at)')
      .is('director_client_id', null)
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((d: any) => !d.company?.deleted_at)
      .map((d: any) => ({
        ...d,
        company_id:   d.company?.id || null,
        company_name: d.company?.name || null,
        company_code: d.company?.client_code || null,
      }));
  },

  async countUnlinkedDirectors(): Promise<number> {
    const { count, error } = await supabase
      .from('client_directors')
      .select('id', { count: 'exact', head: true })
      .is('director_client_id', null);
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // Create a new individual client from a director name, then link the
  // director row to it. Two sequential calls — the new client gets its code,
  // then the director row is updated to point at it.
  //
  // This used generate_client_code_v3, which issued PC-IN-NNN from a global
  // per-type counter and ignored the name entirely. It now goes through the
  // same generator as the Add Client form, so a director-created client is
  // numbered like any other individual.
  async createClientFromDirector(directorId: number, directorName: string) {
    const { code } = await api.getNextClientCode(directorName, 'individual');
    const { data: newClient, error: cErr } = await supabase
      .from('clients')
      .insert({
        client_code: code,
        name:        directorName,
        client_category: 'individual',
        client_status:   'active',
        is_active:       true,
        status:          'active',
      })
      .select('id, client_code, name')
      .single();
    if (cErr) throw new Error('Create client failed: ' + cErr.message);
    const { error: linkErr } = await supabase
      .from('client_directors')
      .update({ director_client_id: (newClient as any).id })
      .eq('id', directorId);
    if (linkErr) throw new Error('Linked client created but link failed: ' + linkErr.message);
    return newClient;
  },

  // generateClientCodeV2 / V3 wrappers removed: getNextClientCode is now the
  // single generator. The SQL functions still exist in the database but
  // nothing calls them — v2 issued 3-letter+number codes, v3 issued
  // PC-IN/CO/PA-NNN from a global per-type counter.

  // Reverse lookup: which companies/clients list this client as a director / UBO etc.
  async getDirectorshipsForClient(linkedClientId: number) {
    const { data, error } = await supabase
      .from('client_directors')
      .select('*, company:clients!client_id(id, name, client_code)')
      .eq('director_client_id', linkedClientId)
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((d: any) => ({
      ...d,
      company_name: d.company?.name || null,
      company_code: d.company?.client_code || null,
    }));
  },

  async createClientDirector(row: any) {
    const { data, error } = await supabase
      .from('client_directors')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateClientDirector(id: number, patch: any) {
    const { error } = await supabase
      .from('client_directors')
      .update(patch)
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteClientDirector(id: number) {
    const { error } = await supabase
      .from('client_directors')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Tax filings (clients-v3 Part C) ---------
  async getClientTaxFilings(clientId: number) {
    const { data, error } = await supabase
      .from('client_tax_filings')
      .select('*')
      .eq('client_id', clientId)
      .order('tax_year', { ascending: false })
      .order('filing_type', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getAllTaxFilings(filters?: {
    year?: number;
    filing_type?: string;
    status?: string;
    client_id?: number;
    filed_by?: string;
    due_from?: string;
    due_to?: string;
    overdue_only?: boolean;
    due_this_month?: boolean;
  }) {
    let q = supabase
      .from('client_tax_filings')
      .select('*, client:clients(name, client_code, deleted_at)')
      .order('tax_year', { ascending: false })
      .order('due_date', { ascending: true, nullsFirst: false });
    if (filters?.year)        q = q.eq('tax_year', filters.year);
    if (filters?.filing_type) q = q.eq('filing_type', filters.filing_type);
    if (filters?.status)      q = q.eq('status', filters.status);
    if (filters?.client_id)   q = q.eq('client_id', filters.client_id);
    if (filters?.filed_by)    q = q.eq('filed_by_user_id', filters.filed_by);
    if (filters?.due_from)    q = q.gte('due_date', filters.due_from);
    if (filters?.due_to)      q = q.lte('due_date', filters.due_to);
    if (filters?.overdue_only) {
      const today = new Date().toISOString().slice(0, 10);
      q = q.lt('due_date', today).in('status', ['pending', 'in_progress', 'overdue']);
    }
    if (filters?.due_this_month) {
      const d = new Date();
      const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
      const lastOfMonth  = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      q = q.gte('due_date', firstOfMonth).lte('due_date', lastOfMonth);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || [])
      // Hide orphans (missing client) + soft-deleted clients
      .filter((r: any) => r.client && !r.client.deleted_at)
      .map((r: any) => ({
        ...r,
        client_name: r.client?.name || null,
        client_code: r.client?.client_code || null,
      }));
  },

  async countOrphanTaxFilings(): Promise<number> {
    // Filings whose client doesn't exist OR is soft-deleted
    const { data, error } = await supabase
      .from('client_tax_filings')
      .select('id, client:clients(deleted_at)');
    if (error) throw new Error(error.message);
    return (data || []).filter((r: any) => !r.client || r.client.deleted_at).length;
  },

  async cleanupOrphanTaxFilings(): Promise<number> {
    const { data, error } = await supabase.rpc('cleanup_orphan_tax_filings');
    if (error) throw new Error(error.message);
    return (data as any)?.deleted ?? 0;
  },

  async createTaxFiling(row: any) {
    const { data, error } = await supabase
      .from('client_tax_filings')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateTaxFiling(id: number, patch: any) {
    const { error } = await supabase
      .from('client_tax_filings')
      .update(patch)
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteTaxFiling(id: number) {
    const { error } = await supabase
      .from('client_tax_filings')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async bulkUpdateTaxFilings(ids: number[], patch: any) {
    if (ids.length === 0) return;
    const { error } = await supabase
      .from('client_tax_filings')
      .update(patch)
      .in('id', ids);
    if (error) throw new Error(error.message);
  },

  async countTaxFilings(filters: { overdue_only?: boolean; due_this_month?: boolean } = {}) {
    let q = supabase.from('client_tax_filings').select('id', { count: 'exact', head: true });
    if (filters.overdue_only) {
      const today = new Date().toISOString().slice(0, 10);
      q = q.lt('due_date', today).in('status', ['pending', 'in_progress', 'overdue']);
    }
    if (filters.due_this_month) {
      const d = new Date();
      const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
      const lastOfMonth  = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      q = q.gte('due_date', firstOfMonth).lte('due_date', lastOfMonth)
           .in('status', ['pending', 'in_progress', 'overdue']);
    }
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // --------- Saved filters (clients-v3 B4) ---------
  async getSavedFilters(scope: 'clients' | 'tax_filings') {
    const { data, error } = await supabase
      .from('user_saved_filters')
      .select('*')
      .eq('scope', scope)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async createSavedFilter(row: { name: string; scope: string; filter_config: any }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('user_saved_filters')
      .insert({ ...row, user_id: session.user.id, is_default: false })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteSavedFilter(id: number) {
    const { error } = await supabase
      .from('user_saved_filters')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Client emails (inbound + outbound captured via Mailgun) ---------
  async getClientEmails(clientId: number) {
    const { data, error } = await supabase
      .from('client_emails')
      .select('id, client_id, direction, sender_email, sender_name, recipient_emails, cc_emails, subject, received_at, attachment_count')
      .eq('client_id', clientId)
      .order('received_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getClientEmailDetail(id: number) {
    const { data, error } = await supabase
      .from('client_emails')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    // Log the view — sensitive content, want a trail.
    api.logAction('client_emails.view', 'client_emails', id, { subject: (data as any)?.subject }).catch(() => {});
    return data;
  },

  async getClientEmailAttachments(emailId: number) {
    const { data, error } = await supabase
      .from('client_email_attachments')
      .select('*')
      .eq('email_id', emailId)
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Record an outbound firm email on a client's record so it shows in their
  // portal Inbox (read-only). Best-effort — callers shouldn't fail a send if
  // logging fails. (migration 121)
  async logOutboundClientEmail(clientId: number, p: { subject?: string; html?: string; plain?: string; recipients?: string[] }) {
    const { error } = await supabase.rpc('log_outbound_client_email', {
      p_client_id: clientId,
      p_subject: p.subject ?? null,
      p_html: p.html ?? null,
      p_plain: p.plain ?? null,
      p_recipients: p.recipients ?? [],
    });
    if (error) throw new Error(error.message);
  },

  // --------- Custom email templates (migration 122) ---------
  async listEmailTemplates() {
    const { data, error } = await supabase.from('email_templates')
      .select('id, name, category, subject, body').eq('is_active', true)
      .order('category', { ascending: true }).order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async createEmailTemplate(t: { name: string; category?: string; subject: string; body: string }) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('email_templates')
      .insert({ name: t.name, category: t.category || 'My templates', subject: t.subject, body: t.body, created_by: session?.user?.id || null })
      .select('id').single();
    if (error) throw new Error(error.message);
    return data.id as number;
  },
  async updateEmailTemplate(id: number, patch: Record<string, any>) {
    const { error } = await supabase.from('email_templates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async deleteEmailTemplate(id: number) {
    const { error } = await supabase.from('email_templates').update({ is_active: false }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // Client-portal: list the signed-in client's own emails (RLS scopes to theirs).
  async getMyEmails() {
    const { data, error } = await supabase
      .from('client_emails')
      .select('id, client_id, direction, sender_email, sender_name, subject, received_at, attachment_count')
      .order('received_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getClientEmailAttachmentSignedUrl(storagePath: string, expiresInSeconds = 60): Promise<string> {
    const { data, error } = await supabase.storage
      .from('client-email-attachments')
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Failed to sign URL');
    return data.signedUrl;
  },

  // --------- Column visibility preferences (per-user, per-page) ---------
  // Stored in profiles.column_preferences jsonb (added in migration 036).
  // Shape: { clients: ["client_code", "name", ...], invoices: [...] }
  async getColumnPreferences(): Promise<Record<string, string[]>> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return {};
    const { data, error } = await supabase
      .from('profiles')
      .select('column_preferences')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error || !data) return {};
    return (data.column_preferences as Record<string, string[]>) || {};
  },

  async setColumnPreferences(page: string, columnIds: string[]) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    const { data: row } = await supabase
      .from('profiles')
      .select('column_preferences')
      .eq('id', session.user.id)
      .maybeSingle();
    const next = { ...((row?.column_preferences as any) || {}), [page]: columnIds };
    const { error } = await supabase
      .from('profiles')
      .update({ column_preferences: next })
      .eq('id', session.user.id);
    if (error) throw new Error(error.message);
  },

  // --------- Dashboard layout preferences ---------
  async getMyDashboardLayout(): Promise<{ widgets: any[] } | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const { data, error } = await supabase
      .from('user_dashboard_preferences')
      .select('layout')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return (data.layout as { widgets: any[] }) || null;
  },

  async setMyDashboardLayout(layout: { widgets: any[] }): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    const { error } = await supabase
      .from('user_dashboard_preferences')
      .upsert(
        { user_id: session.user.id, layout },
        { onConflict: 'user_id' }
      );
    if (error) throw new Error(error.message);
  },

  // --------- Sidebar collapse/expand state (UI polish part 1) ---------
  async getMySidebarState(): Promise<{ groups?: Record<string, 'expanded' | 'collapsed'> } | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const { data, error } = await supabase
      .from('user_dashboard_preferences')
      .select('sidebar_state')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return (data.sidebar_state as any) || null;
  },

  async setMySidebarState(state: { groups?: Record<string, 'expanded' | 'collapsed'> }): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    const { error } = await supabase
      .from('user_dashboard_preferences')
      .upsert(
        { user_id: session.user.id, sidebar_state: state },
        { onConflict: 'user_id' }
      );
    if (error) throw new Error(error.message);
  },

  // --------- Favourites (UI polish part 3) ---------
  async getMyFavourites() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return [];
    const { data, error } = await supabase
      .from('user_favourites')
      .select('*')
      .eq('user_id', session.user.id)
      .order('favourite_type', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async pinFavourite(favouriteType: 'menu_item' | 'client', targetId: string, label?: string) {
    const { data, error } = await supabase.rpc('pin_favourite', {
      p_favourite_type: favouriteType,
      p_target_id:      targetId,
      p_label:          label || null,
    });
    if (error) throw new Error(error.message);
    return data as number;
  },

  async unpinFavourite(id: number) {
    const { error } = await supabase.from('user_favourites').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async reorderFavourite(id: number, newSortOrder: number) {
    const { error } = await supabase.from('user_favourites')
      .update({ sort_order: newSortOrder }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Client addresses (UI polish part 5) ---------
  async getClientAddresses(clientId: number) {
    const { data, error } = await supabase.from('client_addresses')
      .select('*').eq('client_id', clientId);
    if (error) throw new Error(error.message);
    return (data || []) as ClientAddress[];
  },

  async upsertClientAddress(addr: {
    id?: number;
    client_id: number;
    address_type: 'registered' | 'trading' | 'postal' | 'home';
    line1?: string | null;
    line2?: string | null;
    line3?: string | null;
    office?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country?: string | null;
    notes?: string | null;
    is_linked_to_registered?: boolean;
  }) {
    const payload = {
      client_id:    addr.client_id,
      address_type: addr.address_type,
      line1:        addr.line1 || null,
      line2:        addr.line2 || null,
      line3:        addr.line3 || null,
      office:       addr.office || null,
      city:         addr.city || null,
      postal_code:  addr.postal_code || null,
      country:      addr.country || 'Cyprus',
      notes:        addr.notes || null,
      is_linked_to_registered: !!addr.is_linked_to_registered,
    };
    if (addr.id) {
      const { error } = await supabase.from('client_addresses').update(payload).eq('id', addr.id);
      if (error) throw new Error(error.message);
      return addr.id;
    }
    const { data, error } = await supabase.from('client_addresses')
      .upsert(payload, { onConflict: 'client_id,address_type' })
      .select().single();
    if (error) throw new Error(error.message);
    return (data as any).id as number;
  },

  async deleteClientAddress(id: number) {
    const { error } = await supabase.from('client_addresses').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Audit alerts (security banner) ---------
  async getAuditAlerts(opts?: { open_only?: boolean; limit?: number }) {
    const limit = opts?.limit ?? 20;
    let q = supabase.from('audit_alerts')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(limit);
    if (opts?.open_only !== false) q = q.is('acknowledged_at', null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async acknowledgeAuditAlert(id: number) {
    const { error } = await supabase.rpc('acknowledge_audit_alert', { p_id: id });
    if (error) throw new Error(error.message);
  },

  async logAction(action: string, targetType?: string, targetId?: string | number, summary?: any) {
    try {
      await supabase.rpc('log_action', {
        p_action: action,
        p_target_type: targetType ?? null,
        p_target_id: targetId != null ? String(targetId) : null,
        p_summary: summary ?? null,
      });
    } catch {
      // Audit failures must never block the calling action — the
      // server-side function also swallows errors as a safety net.
    }
  },

  // --------- Vendor patterns ---------
  async matchVendorPattern(clientId: number, vendorName: string) {
    const norm = normalizeVendor(vendorName);
    if (!norm) return { match: null };
    const { data } = await supabase.from('vendor_patterns').select('*')
      .eq('client_id', clientId).eq('vendor_name_normalized', norm).maybeSingle();
    return { match: data || null };
  },
  async getVendorPatterns(clientId: number) {
    const { data, error } = await supabase.from('vendor_patterns').select('*')
      .eq('client_id', clientId).order('last_used', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async deleteVendorPattern(id: number) {
    const { error } = await supabase.from('vendor_patterns').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
  async updateVendorPattern(id: number, data: any) {
    const { error } = await supabase.from('vendor_patterns').update(data).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // --------- Compliance ---------
  async getComplianceTasks(params?: { client_id?: number; status?: string; from?: string; to?: string; kind?: string }) {
    let q = supabase.from('compliance_tasks')
      .select('*, client:clients(name, client_code)')
      .order('due_date', { ascending: true });
    if (params?.client_id) q = q.eq('client_id', params.client_id);
    if (params?.status) q = q.eq('status', params.status);
    if (params?.kind) q = q.eq('kind', params.kind);
    if (params?.from) q = q.gte('due_date', params.from);
    if (params?.to) q = q.lte('due_date', params.to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((t: any) => ({
      ...t,
      client_name: t.client?.name || '',
      client_code: t.client?.client_code || '',
    }));
  },

  async updateComplianceTask(id: number, patch: any) {
    const { error } = await supabase.from('compliance_tasks').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteComplianceTask(id: number) {
    const { error } = await supabase.from('compliance_tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async generateVatTasks(opts: { lookbackQuarters?: number; lookaheadQuarters?: number; asOf?: Date; dueOnOrBefore?: string } = {}) {
    const asOf      = opts.asOf || new Date();
    const lookback  = opts.lookbackQuarters  ?? 1;
    const lookahead = opts.lookaheadQuarters ?? 4;
    const { data: vatClients, error } = await supabase
      .from('clients')
      .select('id, vat_period_group')
      .eq('vat_registered', true)
      .not('vat_period_group', 'is', null);
    if (error) throw new Error(error.message);

    const rows: any[] = [];
    for (const c of vatClients || []) {
      const group = c.vat_period_group as 1 | 2 | 3;
      for (const p of computeVatPeriods(group, asOf, lookback, lookahead)) {
        if (opts.dueOnOrBefore && p.due > opts.dueOnOrBefore) continue;
        rows.push({
          client_id: c.id,
          kind: 'vat_quarterly',
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          due_date: p.due,
          status: 'not_started',
        });
      }
    }
    if (rows.length === 0) return { created: 0, attempted: 0, eligible_clients: 0 };
    const { data, error: insErr } = await supabase
      .from('compliance_tasks')
      .upsert(rows, { onConflict: 'client_id,kind,period_start', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error(insErr.message);
    return { created: data?.length || 0, attempted: rows.length, eligible_clients: (vatClients || []).length };
  },

  async generateSocialInsuranceTasks(opts: { lookbackMonths?: number; lookaheadMonths?: number; asOf?: Date; dueOnOrBefore?: string } = {}) {
    const asOf      = opts.asOf || new Date();
    const lookback  = opts.lookbackMonths  ?? 1;
    const lookahead = opts.lookaheadMonths ?? 6;
    // Employers = clients with an employer_number set (Cyprus SI registration).
    const { data: employers, error } = await supabase
      .from('clients')
      .select('id, employer_number')
      .not('employer_number', 'is', null)
      .neq('employer_number', '');
    if (error) throw new Error(error.message);

    const periods = computeSocialInsurancePeriods(asOf, lookback, lookahead);
    const rows: any[] = [];
    for (const c of employers || []) {
      for (const p of periods) {
        if (opts.dueOnOrBefore && p.due > opts.dueOnOrBefore) continue;
        rows.push({
          client_id: c.id,
          kind: 'social_insurance_monthly',
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          due_date: p.due,
          status: 'not_started',
        });
      }
    }
    if (rows.length === 0) return { created: 0, attempted: 0, eligible_clients: 0 };
    const { data, error: insErr } = await supabase
      .from('compliance_tasks')
      .upsert(rows, { onConflict: 'client_id,kind,period_start', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error(insErr.message);
    return { created: data?.length || 0, attempted: rows.length, eligible_clients: (employers || []).length };
  },

  async generateIR7Tasks(opts: { lookbackYears?: number; lookaheadYears?: number; asOf?: Date; dueOnOrBefore?: string } = {}) {
    const asOf      = opts.asOf || new Date();
    const lookback  = opts.lookbackYears  ?? 1;
    const lookahead = opts.lookaheadYears ?? 1;
    const { data: employers, error } = await supabase
      .from('clients')
      .select('id, employer_number')
      .not('employer_number', 'is', null)
      .neq('employer_number', '');
    if (error) throw new Error(error.message);

    const periods = computeIR7Periods(asOf, lookback, lookahead);
    const rows: any[] = [];
    for (const c of employers || []) {
      for (const p of periods) {
        if (opts.dueOnOrBefore && p.due > opts.dueOnOrBefore) continue;
        rows.push({
          client_id: c.id,
          kind: 'ir7_annual',
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          due_date: p.due,
          status: 'not_started',
        });
      }
    }
    if (rows.length === 0) return { created: 0, attempted: 0, eligible_clients: 0 };
    const { data, error: insErr } = await supabase
      .from('compliance_tasks')
      .upsert(rows, { onConflict: 'client_id,kind,period_start', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error(insErr.message);
    return { created: data?.length || 0, attempted: rows.length, eligible_clients: (employers || []).length };
  },

  async generateAllComplianceTasks() {
    const [vat, si, ir7] = await Promise.all([
      api.generateVatTasks(),
      api.generateSocialInsuranceTasks(),
      api.generateIR7Tasks(),
    ]);
    return { vat, si, ir7 };
  },

  // -- New "important" generators -------------------------------

  async generateProvisionalTaxTasks(opts: { asOf?: Date; lookbackYears?: number; lookaheadYears?: number } = {}) {
    const asOf      = opts.asOf || new Date();
    const lookback  = opts.lookbackYears  ?? 0;
    const lookahead = opts.lookaheadYears ?? 1;

    // Eligible: VAT-registered clients OR clients with an employer_number
    // (proxy for "has business income subject to provisional tax").
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, vat_registered, employer_number');
    if (error) throw new Error(error.message);
    const eligible = (clients || []).filter(c =>
      c.vat_registered === true || (c.employer_number && String(c.employer_number).trim() !== '')
    );

    const periods = computeProvisionalTaxPeriods(asOf, lookback, lookahead);
    const rows: any[] = [];
    for (const c of eligible) {
      for (const p of periods) {
        rows.push({
          client_id: c.id,
          kind: 'provisional_tax',
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          due_date: p.due,
          status: 'not_started',
        });
      }
    }
    if (rows.length === 0) return { created: 0, attempted: 0, eligible_clients: eligible.length };
    const { data, error: insErr } = await supabase
      .from('compliance_tasks')
      .upsert(rows, { onConflict: 'client_id,kind,period_start', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error(insErr.message);
    return { created: data?.length || 0, attempted: rows.length, eligible_clients: eligible.length };
  },

  async generateHE32Tasks(opts: { asOf?: Date; lookbackYears?: number; lookaheadYears?: number } = {}) {
    const asOf      = opts.asOf || new Date();
    const lookback  = opts.lookbackYears  ?? 0;
    const lookahead = opts.lookaheadYears ?? 1;

    // Eligible: clients with an incorporation_date (used as the anniversary anchor).
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, incorporation_date')
      .not('incorporation_date', 'is', null);
    if (error) throw new Error(error.message);

    const rows: any[] = [];
    for (const c of clients || []) {
      const inc = new Date(c.incorporation_date as string);
      if (isNaN(inc.getTime())) continue;
      for (const p of computeHE32Periods(asOf, inc, lookback, lookahead)) {
        rows.push({
          client_id: c.id,
          kind: 'he32_annual',
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          due_date: p.due,
          status: 'not_started',
        });
      }
    }
    if (rows.length === 0) return { created: 0, attempted: 0, eligible_clients: (clients || []).length };
    const { data, error: insErr } = await supabase
      .from('compliance_tasks')
      .upsert(rows, { onConflict: 'client_id,kind,period_start', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error(insErr.message);
    return { created: data?.length || 0, attempted: rows.length, eligible_clients: (clients || []).length };
  },

  async generateUboTasks(opts: { asOf?: Date; lookbackYears?: number; lookaheadYears?: number } = {}) {
    const asOf      = opts.asOf || new Date();
    const lookback  = opts.lookbackYears  ?? 0;
    const lookahead = opts.lookaheadYears ?? 1;

    // Eligible: clients with a registration_number (HE for ltd companies,
    // S/LP for partnerships) OR business_type matching /partnership/.
    // Individual clients without a company structure are skipped.
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, registration_number, business_type');
    if (error) throw new Error(error.message);
    const eligible = (clients || []).filter(c => {
      const hasReg       = c.registration_number && String(c.registration_number).trim() !== '';
      const isPartnership = (c.business_type || '').toLowerCase().includes('partnership');
      return hasReg || isPartnership;
    });

    const periods = computeUboPeriods(asOf, lookback, lookahead);
    const rows: any[] = [];
    for (const c of eligible) {
      for (const p of periods) {
        rows.push({
          client_id: c.id,
          kind: 'ubo_annual',
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          due_date: p.due,
          status: 'not_started',
        });
      }
    }
    if (rows.length === 0) return { created: 0, attempted: 0, eligible_clients: eligible.length };
    const { data, error: insErr } = await supabase
      .from('compliance_tasks')
      .upsert(rows, { onConflict: 'client_id,kind,period_start', ignoreDuplicates: true })
      .select('id');
    if (insErr) throw new Error(insErr.message);
    return { created: data?.length || 0, attempted: rows.length, eligible_clients: eligible.length };
  },

  // -- Unified orchestrator --------------------------------------
  // Picks generators tuned for the focus month:
  //   Routine (VAT / SI / IR7): only periods due ON OR BEFORE end of yyyymm.
  //   Important (Provisional Tax / HE32): always current + next year.
  async generateForMonth(yyyymm: string) {
    const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
    if (!m) throw new Error('Expected YYYY-MM, got: ' + yyyymm);
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const endOfMonth      = new Date(y, mo + 1, 0);
    const endOfMonthIso   = toIsoDate(endOfMonth);

    const [vat, si, ir7, ptax, he32, ubo] = await Promise.all([
      api.generateVatTasks({ asOf: endOfMonth, lookbackQuarters: 8, lookaheadQuarters: 2, dueOnOrBefore: endOfMonthIso }),
      api.generateSocialInsuranceTasks({ asOf: endOfMonth, lookbackMonths: 24, lookaheadMonths: 2, dueOnOrBefore: endOfMonthIso }),
      api.generateIR7Tasks({ asOf: endOfMonth, lookbackYears: 3, lookaheadYears: 1, dueOnOrBefore: endOfMonthIso }),
      api.generateProvisionalTaxTasks({ asOf: endOfMonth, lookbackYears: 0, lookaheadYears: 1 }),
      api.generateHE32Tasks({ asOf: endOfMonth, lookbackYears: 0, lookaheadYears: 1 }),
      api.generateUboTasks({ asOf: endOfMonth, lookbackYears: 0, lookaheadYears: 1 }),
    ]);

    const total = vat.created + si.created + ir7.created + ptax.created + he32.created + ubo.created;
    return { vat, si, ir7, ptax, he32, ubo, total, focus_month: yyyymm };
  },

  // --------- Journal types ---------
  async getJournalTypes() {
    const { data, error } = await supabase.from('journal_types').select('*').order('code');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async createJournalType(data: any) {
    const { data: row, error } = await supabase.from('journal_types').insert(data).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },
};
