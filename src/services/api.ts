// Supabase-backed API layer. Preserves the shape of the old Express api
// so existing components keep working. All data access goes through the
// Supabase client with RLS enforcing per-client access.
import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ---- Email column boundary translation (migration 035 made clients.email text[]) ----
// Forms and display code work with a "; "-joined string; the DB stores text[].
// These two helpers translate at the API boundary so callers don't have to care.
function normaliseClientForRead(c: any): any {
  if (c && Array.isArray(c.email)) {
    return { ...c, email: c.email.join('; ') };
  }
  return c;
}
function normaliseClientForWrite(data: any): any {
  if (!data || typeof data !== 'object') return data;
  if (typeof data.email === 'string') {
    const parts = data.email.split(/[;,]+/).map((p: string) => p.trim()).filter(Boolean);
    return { ...data, email: parts.length === 0 ? null : parts };
  }
  return data;
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

export interface AuthUser {
  id: string;                 // auth.users.id (uuid)
  username: string;
  display_name: string;
  email: string;
  role: UserRole;
  client_id: number | null;   // convenience: first linked client
  client_ids: number[];
  permissions: string[];      // effective permissions (role defaults ± per-user overrides)
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

async function seedSystemFolders(clientId: number): Promise<void> {
  const existing = seedingPromises.get(clientId);
  if (existing) return existing;

  const p = (async () => {
    // Read what's already there and only insert the missing keys. Avoids the
    // upsert/partial-unique-index inference issue that was creating duplicates.
    const { data: existingRows } = await supabase.from('folders')
      .select('category_key')
      .eq('client_id', clientId)
      .eq('is_system', true);
    const existingKeys = new Set((existingRows || []).map((r: any) => r.category_key));

    const topRowsToInsert = SYSTEM_FOLDERS
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
      const subRowsToInsert = JOURNAL_SUBFOLDERS
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

async function getJournalFolderId(clientId: number, journalCode: string): Promise<number | null> {
  await seedSystemFolders(clientId);
  const key = `scanned_${journalCode}`;
  const known = JOURNAL_SUBFOLDERS.map(f => f.category_key);
  const lookup = known.includes(key) ? key : 'scanned';
  const { data } = await supabase.from('folders').select('id')
    .eq('client_id', clientId).eq('category_key', lookup).eq('is_system', true).single();
  return data?.id || null;
}

async function getClientIdsForUser(uid: string): Promise<number[]> {
  const { data } = await supabase.from('user_clients').select('client_id').eq('user_id', uid);
  return (data || []).map((r: any) => r.client_id);
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
const ALLOWED_TYPES_DESCRIPTION = 'PDF, JPG, PNG, or HEIC';

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
      },
    };
  },

  // Users admin — limited without service role key. Creating and deleting auth users requires
  // the admin to do it via Supabase dashboard for now. We expose listing + profile updates.
  async getUsers() {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    // Fold in linked client ids
    const out: any[] = [];
    for (const p of data || []) {
      const ids = await getClientIdsForUser(p.id);
      out.push({
        id: p.id, username: p.username, display_name: p.full_name || p.username,
        role: p.role, active: p.active, created_at: p.created_at, client_ids: ids,
      });
    }
    return out;
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
    const { data: row, error } = await supabase.from('clients').insert(data).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
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

  async mergeClient(_targetId: number, _sourceId: number, _fields?: Record<string, string>) {
    throw new Error('Merge clients: deferred — will port from Express soon.');
  },

  async getNextClientCode(name: string) {
    const prefix = '221' + (name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
    const { data } = await supabase.from('clients').select('client_code').like('client_code', `${prefix}%`);
    const max = (data || []).reduce((m: number, r: any) => {
      const n = parseInt((r.client_code || '').slice(6), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return { code: `${prefix}${String(max + 1).padStart(3, '0')}` };
  },

  async generateMissingCodes() {
    const { data } = await supabase.from('clients').select('id, name, client_code').or('client_code.is.null,client_code.eq.');
    let updated = 0;
    for (const c of data || []) {
      const { code } = await api.getNextClientCode(c.name);
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
    const { data } = await supabase.from('accounts').select('code, description, category').eq('client_id', sourceId);
    if (!data?.length) return { copied: 0 };
    await supabase.from('accounts').insert(data.map((a: any) => ({ ...a, client_id: targetId })));
    return { copied: data.length };
  },

  // --------- Platform Credentials ---------
  // Passwords are encrypted at rest via migration 011. They never appear in the
  // table response — use getCredentialPassword(id) to decrypt (and audit-log).
  async getCredentials(clientId: number) {
    const { data, error } = await supabase.from('platform_credentials')
      .select('id, client_id, platform, username, notes, password_enc')
      .eq('client_id', clientId);
    if (error) throw new Error(error.message);
    return (data || []).map((r: any) => ({
      ...r,
      // Convenience flag for the UI: was a password ever set?
      has_password: !!r.password_enc,
      password_enc: undefined, // strip raw bytea from the response
    }));
  },

  async createCredential(clientId: number, data: { platform: string; username?: string; notes?: string; password?: string }) {
    const { data: row, error } = await supabase.from('platform_credentials').insert({
      client_id: clientId,
      platform: data.platform,
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

  async updateCredential(_clientId: number, credId: number, data: { platform?: string; username?: string; notes?: string; password?: string }) {
    const patch: any = {};
    if (data.platform !== undefined) patch.platform = data.platform;
    if (data.username !== undefined) patch.username = data.username;
    if (data.notes    !== undefined) patch.notes    = data.notes;
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
  async getInvoices(params?: Record<string, string>) {
    let q = supabase.from('invoices')
      .select('*, client:clients(name), journal_lines(*)')
      .order('created_at', { ascending: false });
    if (params?.client_id) q = q.eq('client_id', Number(params.client_id));
    if (params?.status === 'not-exported') q = q.neq('status', 'exported');
    else if (params?.status) q = q.eq('status', params.status);
    if (params?.batch_month) q = q.eq('batch_month', params.batch_month);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((i: any) => ({ ...i, client_name: i.client?.name || null }));
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

  // --------- Folders ---------
  async getFolders(clientId: number) {
    await seedSystemFolders(clientId);
    const { data, error } = await supabase.from('folders').select('*')
      .eq('client_id', clientId).order('is_system', { ascending: false }).order('name');
    if (error) throw new Error(error.message);

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

    // Attach doc count
    const out: any[] = [];
    for (const f of deduped) {
      const { count } = await supabase.from('documents')
        .select('*', { count: 'exact', head: true }).eq('folder_id', f.id);
      out.push({ ...f, doc_count: count || 0 });
    }
    return out;
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
  }) {
    let q = supabase.from('staff_tasks')
      .select('*, client:clients(name, client_code)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (params?.assignee)  q = q.eq('assigned_to', params.assignee);
    if (params?.status)    q = q.eq('status', params.status);
    if (params?.priority)  q = q.eq('priority', params.priority);
    if (params?.client_id) q = q.eq('client_id', params.client_id);
    if (params?.category)  q = q.eq('category', params.category);
    if (params?.from)      q = q.gte('due_date', params.from);
    if (params?.to)        q = q.lte('due_date', params.to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map((t: any) => ({
      ...t,
      client_name: t.client?.name || null,
      client_code: t.client?.client_code || null,
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

  async deleteStaffTask(id: number) {
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

  async generateClientCodeV2(name: string): Promise<string> {
    const { data, error } = await supabase.rpc('generate_client_code_v2', { p_name: name });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async bulkImportClients(rows: any[]): Promise<{
    batch_id: string;
    inserted: number;
    errors: number;
    codes_to_ids: Record<string, number>;
    error_details: Array<{ row: number; client_code?: string; error: string }>;
  }> {
    const { data, error } = await supabase.rpc('bulk_import_clients', { p_rows: rows });
    if (error) throw new Error(error.message);
    return data as any;
  },

  async rollbackBulkImport(batchId: string): Promise<{ batch_id: string; rolled_back: number }> {
    const { data, error } = await supabase.rpc('rollback_bulk_import', { p_batch_id: batchId });
    if (error) throw new Error(error.message);
    return data as any;
  },

  async listRecentBulkImports(): Promise<Array<{
    batch_id: string;
    imported_at: string;
    client_count: number;
    active_count: number;
    age_hours: number;
    can_rollback: boolean;
  }>> {
    const { data, error } = await supabase.rpc('list_recent_bulk_imports');
    if (error) throw new Error(error.message);
    return (data || []) as any;
  },

  async bulkImportV3(payload: {
    clients:     any[];
    contacts:    any[];
    directors:   any[];
    credentials: any[];
    tax_filings: any[];
  }): Promise<{
    batch_id: string;
    clients: number;
    contacts: number;
    directors: number;
    credentials: number;
    tax_filings: number;
    errors: number;
    error_details: any[];
  }> {
    const { data, error } = await supabase.rpc('bulk_import_v3', { p_payload: payload });
    if (error) throw new Error(error.message);
    return data as any;
  },

  // Standalone Passwords/Credentials page — all credentials across all clients
  // plus firm-owned (client_id IS NULL) ones with an owner_label.
  async getAllCredentials() {
    const { data, error } = await supabase
      .from('platform_credentials')
      .select('id, client_id, platform, sub_type, username, notes, owner_label, client:clients(name, client_code, deleted_at)')
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
  // director row to it. Two sequential calls — the new client gets its
  // PC-IN-NNN code from generate_client_code_v3, then the director row is
  // updated to point at it.
  async createClientFromDirector(directorId: number, directorName: string) {
    const code = await api.generateClientCodeV3('IND');
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

  // We don't currently have generate_client_code_v3 wired to the JS API.
  // Add a thin wrapper here so the page above can call it cleanly.
  async generateClientCodeV3(type: 'IND' | 'CO' | 'PART'): Promise<string> {
    const { data, error } = await supabase.rpc('generate_client_code_v3', { p_type: type });
    if (error) throw new Error(error.message);
    return data as string;
  },

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
      .filter((r: any) => !r.client?.deleted_at)
      .map((r: any) => ({
        ...r,
        client_name: r.client?.name || null,
        client_code: r.client?.client_code || null,
      }));
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

  async getClientEmailAttachmentSignedUrl(storagePath: string, expiresInSeconds = 60): Promise<string> {
    const { data, error } = await supabase.storage
      .from('client-email-attachments')
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Failed to sign URL');
    return data.signedUrl;
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

  // --------- Bulk import ---------
  async importExcel(_file: File) {
    throw new Error('Excel import: deferred — can port to client-side with SheetJS.');
  },
  async importStructured(_file: File) {
    throw new Error('Structured import: deferred — can port to client-side with SheetJS.');
  },
  getImportTemplateUrl() { return ''; },

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
