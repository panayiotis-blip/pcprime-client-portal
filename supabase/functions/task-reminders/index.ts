// =============================================================
// Supabase Edge Function: task-reminders
// =============================================================
// Emails each staff member a once-a-day digest of THEIR tasks that are
// overdue or due soon, so scheduled compliance work doesn't slip.
//
//   * Recipients are STAFF (task assignees) only — never clients.
//   * One email per assignee that has at least one overdue / due-soon
//     task. Sent through the firm identity (info@), same SMTP path as
//     send-via-outlook.
//
// TWO MODES, one function, because they differ only in who gets grouped
// with what — the SMTP path, the sender identity and the failure handling
// are identical, and a second function would be the same 300 lines with two
// clauses changed.
//
//   { mode: "assignee" }    (default, daily)  — your tasks, overdue + due soon.
//   { mode: "supervisor" }  (weekly)          — everything overdue on the
//       clients YOU supervise, whoever it is assigned to, from
//       staff_tasks.escalated_to (migration 182). A supervisor asking "what
//       is late on my clients" could otherwise only find out by reading the
//       whole task list, which is how escalation turns into wallpaper.
//
// Auth (either is accepted):
//   * x-cron-secret header == CRON_SECRET env  → the nightly pg_cron job.
//   * a staff JWT in Authorization: Bearer …    → the "Send reminders now"
//     button in the task list (manual test).
//
// Deploy with gateway "Verify JWT" OFF — auth is handled in-function so
// the cron (no JWT) can call it.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const STAFF_ROLES = ['owner', 'supervisor', 'admin', 'staff'];
const DEFAULT_DAYS_AHEAD = 7;

// -----------------------------------------------------------------
// MIME + SMTP helpers (same approach as send-via-outlook, no attachments)
// -----------------------------------------------------------------
function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return `=?UTF-8?B?${b64}?=`;
}
function encodeAddress(addr: string): string {
  const m = addr.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return addr;
  const [, name, email] = m;
  if (!name) return `<${email}>`;
  return `${encodeHeader(name.trim())} <${email}>`;
}
function wrapBase64(b64: string): string {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.substring(i, i + 76));
  return out.join('\r\n');
}
function encodeBodyBase64(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  return wrapBase64(btoa(binary));
}
function buildMimeMessage(opts: { from: string; to: string; subject: string; html: string }): string {
  const CRLF = '\r\n';
  const out: string[] = [];
  out.push(`From: ${encodeAddress(opts.from)}`);
  out.push(`To: ${encodeAddress(opts.to)}`);
  out.push(`Subject: ${encodeHeader(opts.subject)}`);
  out.push(`Date: ${new Date().toUTCString()}`);
  out.push(`MIME-Version: 1.0`);
  out.push(`Content-Type: text/html; charset="UTF-8"`);
  out.push(`Content-Transfer-Encoding: base64`);
  out.push('');
  out.push(encodeBodyBase64(opts.html));
  return out.join(CRLF);
}

async function readResponse(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder): Promise<string> {
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) break;
    const lines = buf.split('\r\n');
    const last = lines.filter(l => l.length > 0).pop() || '';
    if (/^\d{3} /.test(last)) break;
  }
  return buf;
}
async function writeLine(writer: WritableStreamDefaultWriter<Uint8Array>, encoder: TextEncoder, s: string) {
  await writer.write(encoder.encode(s + '\r\n'));
}
function smtpCode(resp: string): number {
  const first = resp.split('\r\n').find(l => /^\d{3}/.test(l)) || '';
  return parseInt(first.substring(0, 3) || '0', 10);
}
function expect(resp: string, want: number, where: string) {
  const got = smtpCode(resp);
  if (got !== want) throw new Error(`SMTP ${where} expected ${want}, got ${got}: ${resp.trim()}`);
}
async function sendRawSmtp(opts: {
  host: string; port: number; secure: boolean; user: string; password: string;
  from: string; to: string; mimeMessage: string;
}): Promise<void> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  let conn: Deno.Conn | Deno.TlsConn = opts.secure
    ? await Deno.connectTls({ hostname: opts.host, port: opts.port })
    : await Deno.connect({ hostname: opts.host, port: opts.port });
  let reader = conn.readable.getReader();
  let writer = conn.writable.getWriter();
  expect(await readResponse(reader, decoder), 220, 'greeting');
  await writeLine(writer, encoder, 'EHLO localhost');
  expect(await readResponse(reader, decoder), 250, 'EHLO');
  if (!opts.secure) {
    await writeLine(writer, encoder, 'STARTTLS');
    expect(await readResponse(reader, decoder), 220, 'STARTTLS');
    reader.releaseLock(); writer.releaseLock();
    conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: opts.host });
    reader = conn.readable.getReader();
    writer = conn.writable.getWriter();
    await writeLine(writer, encoder, 'EHLO localhost');
    expect(await readResponse(reader, decoder), 250, 'EHLO (post-TLS)');
  }
  await writeLine(writer, encoder, 'AUTH LOGIN');
  expect(await readResponse(reader, decoder), 334, 'AUTH LOGIN');
  await writeLine(writer, encoder, btoa(opts.user));
  expect(await readResponse(reader, decoder), 334, 'AUTH user');
  await writeLine(writer, encoder, btoa(opts.password));
  expect(await readResponse(reader, decoder), 235, 'AUTH password');
  await writeLine(writer, encoder, `MAIL FROM:<${opts.from}>`);
  expect(await readResponse(reader, decoder), 250, 'MAIL FROM');
  await writeLine(writer, encoder, `RCPT TO:<${opts.to}>`);
  expect(await readResponse(reader, decoder), 250, 'RCPT TO');
  await writeLine(writer, encoder, 'DATA');
  expect(await readResponse(reader, decoder), 354, 'DATA');
  const safeMessage = opts.mimeMessage.replace(/\r\n\./g, '\r\n..');
  await writer.write(encoder.encode(safeMessage + '\r\n.\r\n'));
  expect(await readResponse(reader, decoder), 250, 'DATA end');
  await writeLine(writer, encoder, 'QUIT');
  try { reader.releaseLock(); } catch { /* */ }
  try { writer.releaseLock(); } catch { /* */ }
  try { conn.close(); } catch { /* */ }
}

// -----------------------------------------------------------------
// Digest building
// -----------------------------------------------------------------
type Task = {
  id: number; title: string; due_date: string; priority: string; status: string;
  assigned_to: string; client: { name: string } | null;
  escalated_to?: string | null;
  /** Filled in for the supervisor digest: who the task sits with. */
  assignee_name?: string;
};

const esc = (s: string) => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function buildDigestHtml(name: string, today: string, overdue: Task[], soon: Task[], firmName: string): string {
  const row = (t: Task) => {
    const d = daysBetween(today, t.due_date);
    const when = d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : `in ${d} day${d === 1 ? '' : 's'}`;
    const colour = d < 0 ? '#b91c1c' : d === 0 ? '#b45309' : '#475569';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;">${esc(t.title)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;color:#64748b;">${esc(t.client?.name || '')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;white-space:nowrap;">${esc(t.due_date)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;white-space:nowrap;color:${colour};font-weight:600;">${when}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;text-transform:capitalize;color:#64748b;">${esc(t.priority)}</td>
    </tr>`;
  };
  const table = (title: string, rows: Task[], accent: string) => rows.length === 0 ? '' :
    `<h3 style="margin:20px 0 6px;color:${accent};font-size:15px;">${title} (${rows.length})</h3>
     <table style="border-collapse:collapse;width:100%;font-size:13px;">
       <thead><tr style="text-align:left;color:#94a3b8;">
         <th style="padding:6px 10px;font-weight:600;">Task</th>
         <th style="padding:6px 10px;font-weight:600;">Client</th>
         <th style="padding:6px 10px;font-weight:600;">Due</th>
         <th style="padding:6px 10px;font-weight:600;">When</th>
         <th style="padding:6px 10px;font-weight:600;">Priority</th>
       </tr></thead>
       <tbody>${rows.map(row).join('')}</tbody>
     </table>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#1a365d;line-height:1.5;margin:0;padding:20px;background:#ffffff;">
    <p style="margin:0 0 4px;">Hi ${esc(name)},</p>
    <p style="margin:0 0 8px;color:#475569;">Here are your outstanding tasks as of ${esc(today)}.</p>
    ${table('⚠ Overdue', overdue, '#b91c1c')}
    ${table('Due soon', soon, '#1a365d')}
    <p style="margin:22px 0 0;color:#94a3b8;font-size:12px;">Open the portal to update, complete or reassign these. — ${esc(firmName || 'The office')}</p>
  </body></html>`;
}

/**
 * The supervisor's weekly view: everything late on their clients, and — the
 * column that makes it actionable — who it is sitting with. Grouped by client,
 * because "Kyriakou has four things late" is a conversation and four scattered
 * rows are not.
 */
function buildSupervisorHtml(name: string, today: string, tasks: Task[], firmName: string): string {
  const byClient = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.client?.name || 'No client';
    byClient.set(key, [...(byClient.get(key) || []), t]);
  }
  // Worst client first: the longest-overdue item decides the order.
  const groups = [...byClient.entries()].sort((a, b) => a[1][0].due_date.localeCompare(b[1][0].due_date));

  const row = (t: Task) => {
    const d = -daysBetween(today, t.due_date);
    return `<tr>
      <td style="padding:6px 10px;border-top:1px solid #e2e8f0;">${esc(t.title)}</td>
      <td style="padding:6px 10px;border-top:1px solid #e2e8f0;white-space:nowrap;">${esc(t.due_date)}</td>
      <td style="padding:6px 10px;border-top:1px solid #e2e8f0;white-space:nowrap;color:#b91c1c;">${d} day${d === 1 ? '' : 's'}</td>
      <td style="padding:6px 10px;border-top:1px solid #e2e8f0;">${esc(t.assignee_name || 'unassigned')}</td>
    </tr>`;
  };

  const section = ([client, rows]: [string, Task[]]) =>
    `<h3 style="margin:18px 0 4px;color:#1a365d;font-size:14px;">${esc(client)} <span style="color:#94a3b8;font-weight:400;">(${rows.length})</span></h3>
     <table style="border-collapse:collapse;width:100%;font-size:13px;">
       <thead><tr style="text-align:left;color:#94a3b8;">
         <th style="padding:6px 10px;font-weight:600;">Task</th>
         <th style="padding:6px 10px;font-weight:600;">Due</th>
         <th style="padding:6px 10px;font-weight:600;">Late by</th>
         <th style="padding:6px 10px;font-weight:600;">With</th>
       </tr></thead>
       <tbody>${rows.map(row).join('')}</tbody>
     </table>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#1a365d;line-height:1.5;margin:0;padding:20px;background:#ffffff;">
    <p style="margin:0 0 4px;">Hi ${esc(name)},</p>
    <p style="margin:0 0 8px;color:#475569;">
      <strong>${tasks.length}</strong> overdue task${tasks.length === 1 ? '' : 's'} across
      <strong>${groups.length}</strong> client${groups.length === 1 ? '' : 's'} you supervise, as of ${esc(today)}.
      These stay with the people they are assigned to — this is for your visibility.
    </p>
    ${groups.map(section).join('')}
    <p style="margin:22px 0 0;color:#94a3b8;font-size:12px;">Tasks → “Just mine” shows the same list in the portal. — ${esc(firmName || 'The office')}</p>
  </body></html>`;
}

// -----------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  // ----- Auth: cron secret OR staff JWT -----
  let authorized = false;
  const cronSecret = req.headers.get('x-cron-secret');
  const envSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && envSecret && cronSecret === envSecret) {
    authorized = true;
  } else {
    const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (authToken) {
      const userClient = createClient(supaUrl, anonKey, { global: { headers: { Authorization: `Bearer ${authToken}` } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (prof && STAFF_ROLES.includes(prof.role)) authorized = true;
      }
    }
  }
  if (!authorized) return json({ ok: false, error: 'Unauthorized.' }, 401);

  // Optional { days_ahead } override; default 7. Optional { mode }.
  let daysAhead = DEFAULT_DAYS_AHEAD;
  let mode: 'assignee' | 'supervisor' = 'assignee';
  try {
    const body = await req.json().catch(() => ({}));
    if (body && Number.isFinite(body.days_ahead)) daysAhead = Math.max(0, Math.min(60, Number(body.days_ahead)));
    if (body && body.mode === 'supervisor') mode = 'supervisor';
  } catch { /* no body */ }

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);

  // ----- Load the tasks this run is about -----
  // Assignee mode: mine, overdue or due within the horizon.
  // Supervisor mode: overdue on clients I supervise, whoever holds them —
  // grouped by escalated_to rather than assigned_to.
  let query = admin
    .from('staff_tasks')
    .select('id, title, due_date, priority, status, assigned_to, escalated_to, client:clients(name)')
    .not('due_date', 'is', null)
    .is('deleted_at', null)
    .in('status', ['open', 'in_progress', 'blocked'])
    .order('due_date', { ascending: true });

  query = mode === 'supervisor'
    ? query.not('escalated_to', 'is', null).lt('due_date', today)
    : query.not('assigned_to', 'is', null).lte('due_date', horizon);

  const { data: tasks, error: tErr } = await query;
  if (tErr) return json({ ok: false, error: 'Query failed: ' + tErr.message }, 500);

  const groupKey = (t: Task) => (mode === 'supervisor' ? (t.escalated_to || '') : t.assigned_to);
  const byUser = new Map<string, Task[]>();
  for (const t of (tasks || []) as Task[]) {
    const key = groupKey(t);
    if (!key) continue;
    byUser.set(key, [...(byUser.get(key) || []), t]);
  }
  if (byUser.size === 0) {
    return json({
      ok: true, mode, recipients: 0, sent: 0,
      message: mode === 'supervisor'
        ? 'Nothing overdue on any supervised client — nothing to send.'
        : 'No tasks due — nothing to send.',
    });
  }

  // Supervisor digests name the assignee, so resolve those in one query
  // rather than per row.
  if (mode === 'supervisor') {
    const ids = [...new Set((tasks || []).map((t: Task) => t.assigned_to).filter(Boolean))];
    if (ids.length) {
      const { data: profs } = await admin.from('profiles').select('id, full_name, username').in('id', ids);
      const nameById = new Map((profs || []).map((p: any) => [p.id, p.full_name || p.username || '']));
      for (const list of byUser.values()) {
        for (const t of list) t.assignee_name = nameById.get(t.assigned_to) || 'unassigned';
      }
    }
  }

  // ----- Firm sender identity -----
  const { data: fs, error: fErr } = await admin
    .from('firm_email_settings')
    .select('smtp_host, smtp_port, smtp_secure, smtp_user, from_name, is_active')
    .eq('id', 1).maybeSingle();
  if (fErr || !fs || !fs.smtp_user) return json({ ok: false, error: 'Firm email (info@) not configured.' }, 400);
  if (!fs.is_active) return json({ ok: false, error: 'Firm email account is inactive.' }, 400);
  const { data: pw } = await admin.rpc('get_firm_smtp_password_internal');
  const password = (pw as string | null) || '';
  if (!password) return json({ ok: false, error: 'No firm email app password on file.' }, 400);
  const fromAddress = fs.from_name ? `${fs.from_name} <${fs.smtp_user}>` : fs.smtp_user;

  // ----- Company name for the sign-off -----
  const { data: cs } = await admin.from('company_settings').select('name, legal_name').limit(1).maybeSingle();
  const firmName = (cs?.name || cs?.legal_name || fs.from_name || '') as string;

  // ----- Send one digest per assignee -----
  let sent = 0;
  const failures: string[] = [];
  for (const [uid, list] of byUser) {
    // Resolve email + display name.
    let email = '';
    try {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      email = u?.user?.email || '';
    } catch { /* skip */ }
    if (!email) { failures.push(`${uid}: no email`); continue; }
    const { data: prof } = await admin.from('profiles').select('full_name, username').eq('id', uid).maybeSingle();
    const name = prof?.full_name || prof?.username || 'there';

    const overdue = list.filter(t => t.due_date < today);
    const soon = list.filter(t => t.due_date >= today);
    const clientCount = new Set(list.map(t => t.client?.name || '—')).size;

    const subject = mode === 'supervisor'
      ? `Supervising: ${list.length} overdue across ${clientCount} client${clientCount === 1 ? '' : 's'}`
      : `Your tasks: ${overdue.length} overdue, ${soon.length} due soon`;
    const html = mode === 'supervisor'
      ? buildSupervisorHtml(name, today, list, firmName)
      : buildDigestHtml(name, today, overdue, soon, firmName);
    const mimeMessage = buildMimeMessage({ from: fromAddress, to: email, subject, html });
    try {
      await sendRawSmtp({
        host: fs.smtp_host, port: fs.smtp_port, secure: !!fs.smtp_secure,
        user: fs.smtp_user, password, from: fs.smtp_user, to: email, mimeMessage,
      });
      sent++;
    } catch (err) {
      failures.push(`${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return json({ ok: true, mode, recipients: byUser.size, sent, failures });
});
