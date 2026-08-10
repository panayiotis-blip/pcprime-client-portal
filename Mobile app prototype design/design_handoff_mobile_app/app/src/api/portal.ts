/**
 * The portal API.
 *
 * The app talks to the same Supabase project as `portal.primeandcalculate.com`
 * and leans on the same row-level security, so it can only ever see what the
 * portal would show the same person. Nothing here re-decides access.
 *
 * This module is also the mapping layer: the database speaks in
 * `compliance_tasks` and `client_messages`, the screens speak in Filings and
 * Messages, and the translation lives here so neither has to know about the
 * other. Where the design asks for something the schema does not carry, the
 * derivation is written down next to it rather than hidden in a screen.
 */

import { supabase } from '../lib/supabase';
import {
  daysUntil,
  describeDue,
  formatDate,
  formatShortDate,
  formatTime,
  formatBookingDay,
  monthAbbreviation,
  parseDate,
} from '../lib/dates';
import {
  Account,
  Alert,
  ChaseTarget,
  Client,
  ClientDocument,
  ClientItem,
  Deadline,
  Filing,
  FilingProgress,
  Message,
  Profile,
  Role,
  Slot,
  StaffStat,
  StaffTask,
  Status,
} from '../data/types';

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * Supabase returns `{ data, error }`; screens want a value or a throw.
 *
 * A null with no error means row-level security filtered the row out — the
 * record exists but is not ours to see. "Not found" is the honest thing to
 * say: distinguishing the two would leak that it exists. List reads come back
 * as an empty array rather than null, so they pass straight through.
 */
function unwrap<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error('Not found.');
  return result.data;
}

/** "Kyriakou Trading Ltd" → "KT". Company suffixes are not initials. */
export function initialsFor(name: string): string {
  const words = (name || '')
    .split(/\s+/)
    .filter((word) => /^[A-Za-zΆ-ώ]/.test(word))
    .filter((word) => !/^(ltd|limited|plc|llc|sa|ae|ee|oe|co|inc|corp)\.?$/i.test(word));
  const letters = words.slice(0, 2).map((word) => word[0].toUpperCase());
  return letters.join('') || (name || '?').slice(0, 2).toUpperCase();
}

const STAFF_ROLES = ['owner', 'supervisor', 'admin', 'staff'];

function roleFor(profileRole: string | null | undefined): Role {
  return STAFF_ROLES.includes(String(profileRole)) ? 'staff' : 'client';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type SignInOutcome =
  | { ok: true; mfaRequired: boolean }
  | { ok: false; error: string };

/**
 * The portal lets people sign in with a bare username, mapping it onto a
 * placeholder address. Mirrored here so the same credentials work in both.
 */
export async function signIn(emailOrUsername: string, password: string): Promise<SignInOutcome> {
  const identifier = emailOrUsername.trim();
  if (!identifier) return { ok: false, error: 'Enter your email address.' };
  if (!password) return { ok: false, error: 'Enter your password.' };

  const email = identifier.includes('@') ? identifier : `${identifier}@placeholder.local`;
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase says "Invalid login credentials"; say it the way a person would.
    const message = /invalid login/i.test(error.message)
      ? 'That email and password do not match.'
      : error.message;
    return { ok: false, error: message };
  }

  return { ok: true, mfaRequired: await mfaChallengeRequired() };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function hasSession() {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

/** Who is signed in, and what the app should show them. */
export async function loadAccount(): Promise<Account | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;

  const uid = session.user.id;
  const [profile, links] = await Promise.all([
    supabase.from('profiles').select('username, full_name, role').eq('id', uid).maybeSingle(),
    supabase.from('user_clients').select('client_id').eq('user_id', uid),
  ]);

  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data) return null;

  const name = profile.data.full_name || profile.data.username || session.user.email || '';

  return {
    id: uid,
    email: session.user.email || '',
    name,
    initials: initialsFor(name),
    role: roleFor(profile.data.role),
    clientIds: (links.data || []).map((row: { client_id: number }) => row.client_id),
  };
}

// ---------------------------------------------------------------------------
// Multi-factor
// ---------------------------------------------------------------------------

/**
 * The portal enforces a second factor for enrolled users. A session that has
 * only cleared the password is `aal1` with `aal2` still required — until the
 * TOTP code is accepted, RLS treats the user as unverified and the data
 * screens would come back empty.
 */
export async function mfaChallengeRequired(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return false;
  return data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
}

export async function verifyTotp(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const digits = code.replace(/\s/g, '');
  if (digits.length < 6) return { ok: false, error: 'Enter the six-digit code.' };

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return { ok: false, error: factors.error.message };

  const totp = (factors.data.totp || []).find((factor) => factor.status === 'verified');
  if (!totp) return { ok: false, error: 'No authenticator is set up on this account.' };

  const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id });
  if (challenge.error) return { ok: false, error: challenge.error.message };

  const verify = await supabase.auth.mfa.verify({
    factorId: totp.id,
    challengeId: challenge.data.id,
    code: digits,
  });
  if (verify.error) {
    const message = /invalid/i.test(verify.error.message)
      ? 'That code was not accepted. Try the next one.'
      : verify.error.message;
    return { ok: false, error: message };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// The client's own record
// ---------------------------------------------------------------------------

export async function loadProfile(clientId: number): Promise<Profile> {
  const row = unwrap(
    await supabase
      .from('clients')
      .select('id, name, vat_number, tax_number')
      .eq('id', clientId)
      .single(),
  );

  return {
    id: row.id,
    name: row.name,
    taxLabel: row.vat_number
      ? `VAT ${row.vat_number}`
      : row.tax_number
        ? `TIC ${row.tax_number}`
        : '',
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

type DocumentRow = {
  id: number;
  file_name: string;
  category: string | null;
  created_at: string;
  uploaded_by: string | null;
  mime_type: string | null;
};

/** The short label in the file box: the extension, or the mime subtype. */
function kindOf(row: DocumentRow): string {
  const extension = row.file_name.includes('.') ? row.file_name.split('.').pop() || '' : '';
  if (extension) return extension.slice(0, 4).toUpperCase();
  const subtype = (row.mime_type || '').split('/')[1] || 'file';
  return subtype.slice(0, 4).toUpperCase();
}

/**
 * The design tags every document Received / In review / Filed / Sent, but the
 * schema has no review state. What it does know is who put the file there, so
 * the tag says that and nothing it cannot back up: the client sent it, or the
 * firm received it on their behalf.
 *
 * Add `documents.review_status` and this becomes a straight read.
 */
function documentStatus(row: DocumentRow, viewerId: string): Status {
  return row.uploaded_by === viewerId
    ? { label: 'Sent', tone: 'positive' }
    : { label: 'Received', tone: 'positive' };
}

export type DocumentPage = { documents: ClientDocument[]; categories: string[] };

export async function loadDocuments(clientId: number, viewerId: string): Promise<DocumentPage> {
  const rows = unwrap(
    await supabase
      .from('documents')
      .select('id, file_name, category, created_at, uploaded_by, mime_type')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ) as DocumentRow[];

  const documents = rows.map((row) => {
    const uploaded = parseDate(row.created_at);
    const category = row.category || 'Other';
    return {
      id: String(row.id),
      name: row.file_name,
      kind: kindOf(row),
      meta: [titleCase(category), uploaded ? formatShortDate(uploaded) : null]
        .filter(Boolean)
        .join(' · '),
      status: documentStatus(row, viewerId),
      category,
    };
  });

  // The filter row is built from what this client actually has, rather than
  // the design's fixed five — categories are configurable in the portal.
  const categories = Array.from(new Set(documents.map((doc) => doc.category))).sort();

  return { documents, categories };
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type UploadInput = {
  clientId: number;
  /** Local file URI from the camera or the file picker. */
  uri: string;
  name: string;
  mimeType: string;
  category: string;
};

/**
 * Uploads to the same bucket and path shape the portal uses, then inserts the
 * `documents` row. Storage first: an orphaned object is recoverable, a row
 * pointing at nothing is not.
 */
export async function uploadDocument(input: UploadInput): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id ?? null;

  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${input.clientId}/${safe(input.category)}/${Date.now()}_${safe(input.name)}`;

  // React Native has no File; fetch the local URI to get bytes.
  const response = await fetch(input.uri);
  const bytes = await response.arrayBuffer();

  const uploaded = await supabase.storage.from('documents').upload(path, bytes, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);

  const inserted = await supabase.from('documents').insert({
    client_id: input.clientId,
    doc_type: 'document',
    category: input.category,
    year: String(new Date().getFullYear()),
    month: new Date().toISOString().slice(0, 7),
    file_name: input.name,
    mime_type: input.mimeType,
    storage_path: path,
    storage_bucket: 'documents',
    uploaded_by: uid,
  });
  if (inserted.error) throw new Error(inserted.error.message);
}

/** A short-lived signed URL, for opening a document in the in-app browser. */
export async function documentUrl(documentId: string): Promise<string> {
  const row = unwrap(
    await supabase
      .from('documents')
      .select('storage_path, storage_bucket')
      .eq('id', Number(documentId))
      .single(),
  );
  const signed = await supabase.storage
    .from(row.storage_bucket || 'documents')
    .createSignedUrl(row.storage_path, 300);
  if (signed.error) throw new Error(signed.error.message);
  return signed.data.signedUrl;
}

// ---------------------------------------------------------------------------
// Filings — compliance_tasks
// ---------------------------------------------------------------------------

type ComplianceRow = {
  id: number;
  client_id: number;
  kind: string;
  period_label: string | null;
  period_end: string;
  due_date: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at: string | null;
  submitted_at: string | null;
};

/** The portal's `kind` keys, said the way a client would read them. */
const KIND_LABELS: Record<string, string> = {
  vat_quarterly: 'VAT return',
  vat: 'VAT return',
  social_insurance: 'Social insurance',
  payroll: 'Payroll',
  provisional_tax: 'Provisional tax',
  income_tax: 'Income tax',
  corporate_tax: 'Corporate income tax',
  ubo: 'UBO register',
  annual_return: 'Annual return',
  vies: 'VIES return',
};

function kindLabel(kind: string) {
  return KIND_LABELS[kind] || titleCase(kind.replace(/_/g, ' '));
}

function filingTitle(row: ComplianceRow) {
  return row.period_label ? `${kindLabel(row.kind)} ${row.period_label}` : kindLabel(row.kind);
}

/**
 * The bar has no column behind it — `compliance_tasks` records a status, not a
 * percentage. Done and cancelled are unambiguous; work in progress reads as
 * mid-way; anything still pending grows as its due date approaches, which is
 * the one honest thing a bar can say about a task nobody has started.
 */
function filingProgress(row: ComplianceRow): { percent: number; progress: FilingProgress } {
  if (row.status === 'completed') return { percent: 100, progress: 'filed' };
  if (row.status === 'cancelled') return { percent: 0, progress: 'idle' };
  if (row.status === 'in_progress') return { percent: 60, progress: 'in-progress' };

  const periodEnd = parseDate(row.period_end);
  const due = parseDate(row.due_date);
  if (!periodEnd || !due) return { percent: 5, progress: 'idle' };

  const span = due.getTime() - periodEnd.getTime();
  const elapsed = Date.now() - periodEnd.getTime();
  const fraction = span > 0 ? elapsed / span : 0;
  return { percent: Math.min(95, Math.max(5, Math.round(fraction * 100))), progress: 'idle' };
}

/** Gold means someone must do something — here, that it is due soon or late. */
function filingStatus(row: ComplianceRow): Status {
  if (row.status === 'completed') return { label: 'Filed', tone: 'positive' };
  if (row.status === 'cancelled') return { label: 'Cancelled', tone: 'inert' };
  if (row.status === 'in_progress') return { label: 'In progress', tone: 'action' };

  const due = parseDate(row.due_date);
  if (!due) return { label: 'Scheduled', tone: 'inert' };

  const days = daysUntil(due);
  if (days < 0) return { label: 'Overdue', tone: 'action' };
  if (days <= 14) return { label: 'Action', tone: 'action' };
  return { label: 'Scheduled', tone: 'inert' };
}

async function complianceRows(clientId: number): Promise<ComplianceRow[]> {
  return unwrap(
    await supabase
      .from('compliance_tasks')
      .select('id, client_id, kind, period_label, period_end, due_date, status, completed_at, submitted_at')
      .eq('client_id', clientId)
      .order('due_date', { ascending: true }),
  ) as ComplianceRow[];
}

export async function loadFilings(clientId: number): Promise<Filing[]> {
  const rows = await complianceRows(clientId);

  return rows.map((row) => {
    const filed = parseDate(row.completed_at || row.submitted_at);
    const due = parseDate(row.due_date);
    return {
      id: String(row.id),
      title: filingTitle(row),
      due:
        row.status === 'completed' && filed
          ? `Filed ${formatDate(filed)}`
          : due
            ? `Due ${formatDate(due)}`
            : '',
      status: filingStatus(row),
      ...filingProgress(row),
    };
  });
}

/** The three nearest things still to happen — Home's calendar card. */
export async function loadDeadlines(clientId: number): Promise<Deadline[]> {
  const rows = await complianceRows(clientId);

  return rows
    .filter((row) => row.status !== 'completed' && row.status !== 'cancelled')
    .slice(0, 3)
    .map((row) => {
      const due = parseDate(row.due_date);
      return {
        id: String(row.id),
        day: due ? String(due.getDate()) : '—',
        month: due ? monthAbbreviation(due) : '',
        title: filingTitle(row),
        sub: due ? titleCase(describeDue(due)) : '',
        status: filingStatus(row),
      };
    });
}

/**
 * The alert card carries the single most pressing thing, or nothing at all —
 * a client with everything in hand should see an empty space, not a
 * manufactured worry.
 */
export async function loadAlert(clientId: number): Promise<Alert> {
  const rows = await complianceRows(clientId);

  const next = rows.find((row) => {
    if (row.status === 'completed' || row.status === 'cancelled') return false;
    const due = parseDate(row.due_date);
    return !!due && daysUntil(due) <= 30;
  });
  if (!next) return null;

  const due = parseDate(next.due_date);
  return {
    title: `${filingTitle(next)} ${due ? describeDue(due) : ''}`.trim(),
    sub: next.period_label || kindLabel(next.kind),
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type ThreadRow = { id: number; subject: string; status: string; last_at: string | null };

/**
 * The portal gives each client several named topics; the app shows one thread.
 * It opens the most recently active one, and starts a "General" topic for a
 * client who has never written in.
 */
export async function openThread(clientId: number): Promise<number> {
  const threads = unwrap(
    await supabase.rpc('get_client_threads', { p_client_id: clientId }),
  ) as ThreadRow[];

  const open = threads.filter((thread) => thread.status === 'open');
  const chosen = (open.length ? open : threads)[0];
  if (chosen) return chosen.id;

  return unwrap(
    await supabase.rpc('create_message_thread', { p_client_id: clientId, p_subject: 'General' }),
  ) as number;
}

type MessageRow = { id: number; body: string; author_is_staff: boolean; created_at: string };

/**
 * `from` is relative to whoever is looking: the accountant's messages are
 * "mine" in staff mode and "theirs" in client mode.
 */
export async function loadMessages(threadId: number, viewerIsStaff: boolean): Promise<Message[]> {
  const rows = unwrap(
    await supabase
      .from('client_messages')
      .select('id, body, author_is_staff, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
  ) as MessageRow[];

  return rows.map((row) => ({
    id: String(row.id),
    from: row.author_is_staff === viewerIsStaff ? 'me' : 'them',
    text: row.body,
  }));
}

export async function sendMessage(threadId: number, body: string): Promise<void> {
  const { error } = await supabase.rpc('send_client_message', {
    p_thread_id: threadId,
    p_body: body,
  });
  if (error) throw new Error(error.message);
}

export async function markThreadRead(threadId: number): Promise<void> {
  // Best effort: failing to clear a read receipt must not break the screen.
  await supabase.rpc('mark_thread_read', { p_thread_id: threadId });
}

/** The accountant a client is writing to, for the Messages header. */
export async function loadAccountManager(
  clientId: number,
): Promise<{ name: string; status: string }> {
  const fallback = { name: 'Prime & Calculate', status: 'Your accounting team' };

  const client = await supabase
    .from('clients')
    .select('account_manager_id')
    .eq('id', clientId)
    .maybeSingle();
  const managerId = (client.data as { account_manager_id?: string } | null)?.account_manager_id;
  if (!managerId) return fallback;

  const profile = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', managerId)
    .maybeSingle();
  if (!profile.data?.full_name) return fallback;

  return {
    name: profile.data.full_name,
    status: `${titleCase(String(profile.data.role || 'accountant'))} · usually replies within an hour`,
  };
}

// ---------------------------------------------------------------------------
// Booking — migration 176
// ---------------------------------------------------------------------------

export async function loadSlots(): Promise<Slot[]> {
  const rows = unwrap(await supabase.rpc('consultation_slots', { p_days: 14 })) as {
    starts_at: string;
  }[];

  return rows.map((row) => {
    const at = new Date(row.starts_at);
    return {
      iso: row.starts_at,
      dayKey: at.toDateString(),
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()],
      dayNumber: at.getDate(),
      dayLabel: formatBookingDay(at),
      time: formatTime(at),
    };
  });
}

export async function requestConsultation(input: {
  clientId: number;
  topic: string;
  startsAt: string;
}): Promise<void> {
  const { error } = await supabase.rpc('request_consultation', {
    p_client_id: input.clientId,
    p_topic: input.topic,
    p_starts_at: input.startsAt,
    p_mode: 'office',
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

type StaffTaskRow = {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  client: { name: string } | null;
};

export async function loadStaffTasks(assignedTo: string): Promise<StaffTask[]> {
  const rows = unwrap(
    await supabase
      .from('staff_tasks')
      .select('id, title, status, due_date, client:clients(name)')
      .eq('assigned_to', assignedTo)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(25),
  ) as unknown as StaffTaskRow[];

  return rows.map((row) => {
    const due = parseDate(row.due_date);
    return {
      id: String(row.id),
      title: row.title,
      sub: [row.client?.name, due ? titleCase(describeDue(due)) : null].filter(Boolean).join(' · '),
      done: row.status === 'done',
    };
  });
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('staff_tasks')
    .update({
      status: done ? 'done' : 'open',
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', Number(id));
  if (error) throw new Error(error.message);
}

type ClientRow = {
  id: number;
  name: string;
  business_type: string | null;
  vat_number: string | null;
  tax_number: string | null;
  monthly_fee: number | null;
  created_at: string;
};

function clientStatus(items: ComplianceRow[]): Status {
  const live = items.filter((row) => row.status !== 'completed' && row.status !== 'cancelled');
  const overdue = live.some((row) => {
    const due = parseDate(row.due_date);
    return !!due && daysUntil(due) < 0;
  });
  if (overdue) return { label: 'Overdue', tone: 'action' };

  const soon = live.some((row) => {
    const due = parseDate(row.due_date);
    return !!due && daysUntil(due) <= 14;
  });
  if (soon) return { label: 'Due soon', tone: 'action' };

  return { label: 'Clear', tone: 'positive' };
}

function formatFee(amount: number | null): string {
  if (amount == null) return '—';
  return `€${amount.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function toClient(row: ClientRow, items: ComplianceRow[]): Client {
  const since = parseDate(row.created_at);
  return {
    id: String(row.id),
    name: row.name,
    initials: initialsFor(row.name),
    type: row.business_type || 'Client',
    vat: row.vat_number ? `VAT ${row.vat_number}` : row.tax_number ? `TIC ${row.tax_number}` : '',
    status: clientStatus(items),
    since: since ? `Client since ${since.getFullYear()}` : 'Client',
    fee: formatFee(row.monthly_fee),
    feeNote: row.monthly_fee == null ? 'No fee on record' : 'Monthly fee',
    items: items
      .filter((item) => item.status !== 'completed' || daysUntil(parseDate(item.due_date)!) > -60)
      .slice(0, 8)
      .map(toClientItem),
  };
}

function toClientItem(row: ComplianceRow): ClientItem {
  const due = parseDate(row.due_date);
  return {
    id: String(row.id),
    title: filingTitle(row),
    sub: due ? titleCase(describeDue(due)) : '',
    status: filingStatus(row),
  };
}

export async function loadClients(): Promise<Client[]> {
  const [clientRows, taskRows] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, business_type, vat_number, tax_number, monthly_fee, created_at')
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(500),
    supabase
      .from('compliance_tasks')
      .select('id, client_id, kind, period_label, period_end, due_date, status, completed_at, submitted_at')
      .neq('status', 'completed')
      .order('due_date', { ascending: true }),
  ]);

  const clients = unwrap(clientRows) as ClientRow[];
  const tasks = unwrap(taskRows) as ComplianceRow[];

  const byClient = new Map<number, ComplianceRow[]>();
  for (const task of tasks) {
    const list = byClient.get(task.client_id) || [];
    list.push(task);
    byClient.set(task.client_id, list);
  }

  return clients.map((row) => toClient(row, byClient.get(row.id) || []));
}

export async function loadClient(clientId: number): Promise<Client> {
  const [clientRow, taskRows] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, business_type, vat_number, tax_number, monthly_fee, created_at')
      .eq('id', clientId)
      .single(),
    supabase
      .from('compliance_tasks')
      .select('id, client_id, kind, period_label, period_end, due_date, status, completed_at, submitted_at')
      .eq('client_id', clientId)
      .order('due_date', { ascending: true }),
  ]);

  return toClient(unwrap(clientRow) as ClientRow, unwrap(taskRows) as ComplianceRow[]);
}

export type TodaySummary = { stats: StaffStat[]; chasing: ChaseTarget[] };

/**
 * The two stat blocks and the chasing list.
 *
 * The design's second stat reads "Clients missing docs", which nothing in the
 * schema knows — there is no record of what was asked for and not sent. It
 * counts clients with something overdue instead, which is the same worry
 * expressed in data the portal actually holds.
 */
export async function loadTodaySummary(): Promise<TodaySummary> {
  const [clientRows, taskRows] = await Promise.all([
    supabase.from('clients').select('id, name').eq('status', 'active').limit(500),
    supabase
      .from('compliance_tasks')
      .select('id, client_id, kind, period_label, period_end, due_date, status, completed_at, submitted_at')
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true }),
  ]);

  const clients = unwrap(clientRows) as { id: number; name: string }[];
  const tasks = unwrap(taskRows) as ComplianceRow[];
  const nameFor = new Map(clients.map((client) => [client.id, client.name]));

  const dueThisWeek = tasks.filter((task) => {
    const due = parseDate(task.due_date);
    if (!due) return false;
    const days = daysUntil(due);
    return days >= 0 && days <= 7;
  });

  const overdue = tasks.filter((task) => {
    const due = parseDate(task.due_date);
    return !!due && daysUntil(due) < 0;
  });

  const chasing: ChaseTarget[] = [];
  const seen = new Set<number>();
  for (const task of overdue) {
    if (seen.has(task.client_id)) continue;
    seen.add(task.client_id);
    const name = nameFor.get(task.client_id);
    if (!name) continue;
    const due = parseDate(task.due_date);
    chasing.push({
      id: String(task.id),
      clientId: String(task.client_id),
      name,
      initials: initialsFor(name),
      need: `${filingTitle(task)} · ${due ? describeDue(due) : 'overdue'}`,
    });
    if (chasing.length === 5) break;
  }

  return {
    stats: [
      { value: String(dueThisWeek.length), label: 'Filings due this week' },
      { value: String(seen.size), label: 'Clients with overdue items' },
    ],
    chasing,
  };
}

// ---------------------------------------------------------------------------
// Push — migration 177
// ---------------------------------------------------------------------------

export async function registerPushDevice(input: {
  token: string;
  platform: 'ios' | 'android';
  deviceName?: string | null;
  appVersion?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('register_push_device', {
    p_token: input.token,
    p_platform: input.platform,
    p_device_name: input.deviceName ?? null,
    p_app_version: input.appVersion ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function unregisterPushDevice(token: string): Promise<void> {
  await supabase.rpc('unregister_push_device', { p_token: token });
}
