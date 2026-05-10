// Supabase-backed API layer. Preserves the shape of the old Express api
// so existing components keep working. All data access goes through the
// Supabase client with RLS enforcing per-client access.
import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

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

// Sanitize a single segment of a storage path so user-supplied input cannot
// escape the intended folder. Removes path separators, runs of dots
// (path traversal), control chars, and trims to a sensible length. Falls
// back to 'unnamed' if the result is empty.
function safeStorageSegment(input: unknown): string {
  const s = (input == null ? '' : String(input)).trim();
  if (!s) return 'unnamed';
  const cleaned = s
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return cleaned.slice(0, 200) || 'unnamed';
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

  // --------- Clients ---------
  async getClients() {
    const { data, error } = await supabase.from('clients').select('*').order('name');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getClient(id: number) {
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data;
  },

  async createClient(data: any) {
    const { data: row, error } = await supabase.from('clients').insert(data).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  },

  async updateClient(id: number, data: any) {
    const { error } = await supabase.from('clients').update(data).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async selfUpdateClient(id: number, data: any) {
    // Client role: whitelist of fields only
    const allowed = ['address','phone','email','mobile','contact_person','website','city','postal_code','country'];
    const patch: any = {};
    for (const k of allowed) if (k in data) patch[k] = data[k];
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
    const rows: any[] = [];
    for (const f of params.files) {
      const safeCategory = safeStorageSegment(params.category || 'other');
      const path = `${params.clientId}/${safeCategory}/${Date.now()}_${safeStorageSegment(f.name)}`;
      const up = await supabase.storage.from('documents').upload(path, f);
      if (up.error) throw new Error(up.error.message);
      rows.push({
        client_id: params.clientId, folder_id: params.folderId || null,
        doc_type: params.docType, category: params.category,
        year, month: params.month,
        file_name: f.name, mime_type: f.type || 'application/octet-stream',
        storage_path: path, notes: params.notes || '',
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
    const { data } = await supabase.from('documents').select('storage_path').eq('id', id).single();
    if (!data) throw new Error('Document not found');
    const signed = await supabase.storage.from('documents').createSignedUrl(data.storage_path, 300);
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

  // --------- Staff Tasks ---------
  async getStaffTasks(params?: {
    assignee?: string;
    status?: string;
    priority?: string;
    client_id?: number;
    from?: string;
    to?: string;
  }) {
    let q = supabase.from('staff_tasks')
      .select('*, client:clients(name, client_code)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (params?.assignee)  q = q.eq('assigned_to', params.assignee);
    if (params?.status)    q = q.eq('status', params.status);
    if (params?.priority)  q = q.eq('priority', params.priority);
    if (params?.client_id) q = q.eq('client_id', params.client_id);
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
