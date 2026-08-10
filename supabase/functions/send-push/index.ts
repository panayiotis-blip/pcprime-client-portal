// =============================================================
// Supabase Edge Function: send-push
// =============================================================
// Drains public.push_outbox to Expo's push service, and cleans up after
// itself. Runs every minute from pg_cron (migration 178).
//
// Two passes per run:
//   1. SEND      — claim pending rows, look up each person's devices, post to
//                  Expo in chunks of 100, record the tickets.
//   2. RECEIPTS  — for rows sent a while ago, ask Expo what actually happened
//                  and delete any token it reports as DeviceNotRegistered.
//
// The second pass is the one that matters over time. A ticket only says Expo
// accepted the message; the receipt says whether the device took it. Without
// it, uninstalled apps stay in push_device forever and every send drags a
// longer tail of dead tokens behind it.
//
// Auth (either is accepted):
//   * x-cron-secret header == CRON_SECRET env  → the per-minute pg_cron job.
//   * a staff JWT in Authorization: Bearer …    → draining by hand while
//     debugging.
//
// Deploy with gateway "Verify JWT" OFF — auth is handled in-function so the
// cron (no JWT) can call it:
//     supabase functions deploy send-push --no-verify-jwt
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const STAFF_ROLES = ['owner', 'supervisor', 'admin', 'staff'];

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo's documented cap per request. */
const CHUNK = 100;
/** How many outbox rows one run will take on. */
const BATCH = 200;
/** Expo needs a moment before a receipt exists; asking too early gets null. */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

type OutboxRow = {
  id: number;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
  tickets: { token: string; id: string }[];
};

type Ticket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

type Receipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; details?: { error?: string } };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Expo accepts unauthenticated sends unless the project enables enhanced security. */
function expoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

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
      const userClient = createClient(supaUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${authToken}` } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (user) {
        const { data: prof } = await admin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (prof && STAFF_ROLES.includes(prof.role)) authorized = true;
      }
    }
  }
  if (!authorized) return json({ ok: false, error: 'Unauthorized.' }, 401);

  const sent = await drainOutbox(admin);
  const receipts = await checkReceipts(admin);

  return json({ ok: true, ...sent, ...receipts });
});

// -----------------------------------------------------------------
// Pass 1 — send
// -----------------------------------------------------------------
async function drainOutbox(admin: ReturnType<typeof createClient>) {
  const { data: claimed, error } = await admin.rpc('claim_push_outbox', { p_limit: BATCH });
  if (error) throw new Error('claim_push_outbox failed: ' + error.message);

  const rows = (claimed || []) as OutboxRow[];
  if (rows.length === 0) return { claimed: 0, sent: 0, skipped: 0, failed: 0 };

  // One lookup for every recipient in the batch, rather than per row.
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const { data: devices } = await admin
    .from('push_device')
    .select('token, user_id')
    .in('user_id', userIds);

  const tokensFor = new Map<string, string[]>();
  for (const device of (devices || []) as { token: string; user_id: string }[]) {
    const list = tokensFor.get(device.user_id) || [];
    list.push(device.token);
    tokensFor.set(device.user_id, list);
  }

  // Flatten to one Expo message per (row, device).
  type Addressed = { row: OutboxRow; token: string };
  const addressed: Addressed[] = [];
  const noDevice: OutboxRow[] = [];

  for (const row of rows) {
    const tokens = tokensFor.get(row.user_id) || [];
    if (tokens.length === 0) noDevice.push(row);
    else for (const token of tokens) addressed.push({ row, token });
  }

  // Nobody to tell. Not a failure — they simply have not installed the app.
  if (noDevice.length) {
    await admin
      .from('push_outbox')
      .update({ status: 'skipped', sent_at: new Date().toISOString() })
      .in('id', noDevice.map((row) => row.id));
  }

  const ticketsFor = new Map<number, { token: string; id: string }[]>();
  const errorFor = new Map<number, string>();
  const deadTokens = new Set<string>();

  for (const group of chunk(addressed, CHUNK)) {
    const payload = group.map(({ row, token }) => ({
      to: token,
      title: row.title,
      body: row.body,
      data: row.data,
      sound: 'default',
      // Matches the channel the app creates on Android at registration time.
      channelId: 'default',
    }));

    let tickets: Ticket[] = [];
    try {
      const response = await fetch(EXPO_SEND, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify(payload),
      });
      const parsed = await response.json();

      if (!response.ok || parsed?.errors) {
        // The whole chunk failed — a bad access token, or Expo is down. Leave
        // the rows to be retried on the next run.
        const message = parsed?.errors?.[0]?.message || `Expo returned ${response.status}`;
        for (const { row } of group) errorFor.set(row.id, message);
        continue;
      }
      tickets = (parsed?.data || []) as Ticket[];
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Expo request failed';
      for (const { row } of group) errorFor.set(row.id, message);
      continue;
    }

    group.forEach(({ row, token }, index) => {
      const ticket = tickets[index];
      if (!ticket) {
        errorFor.set(row.id, 'No ticket returned');
        return;
      }
      if (ticket.status === 'ok') {
        const list = ticketsFor.get(row.id) || [];
        list.push({ token, id: ticket.id });
        ticketsFor.set(row.id, list);
        return;
      }
      // A ticket-level error. DeviceNotRegistered here means the token is
      // already dead and there is no point keeping it.
      if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.add(token);
      errorFor.set(row.id, ticket.message);
    });
  }

  const now = new Date().toISOString();
  let sentCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    if (noDevice.includes(row)) continue;

    const tickets = ticketsFor.get(row.id);
    if (tickets?.length) {
      // At least one device took it. A partial failure across a person's two
      // phones is still a delivered notification.
      await admin
        .from('push_outbox')
        .update({ status: 'sent', sent_at: now, tickets, last_error: null })
        .eq('id', row.id);
      sentCount += 1;
    } else {
      const message = errorFor.get(row.id) || 'No device accepted the message';
      // attempts was incremented at claim time; four strikes and it stops.
      await admin
        .from('push_outbox')
        .update({
          status: row.attempts >= 4 ? 'failed' : 'pending',
          last_error: message,
        })
        .eq('id', row.id);
      failedCount += 1;
    }
  }

  await forgetTokens(admin, deadTokens);

  return {
    claimed: rows.length,
    sent: sentCount,
    skipped: noDevice.length,
    failed: failedCount,
  };
}

// -----------------------------------------------------------------
// Pass 2 — receipts
// -----------------------------------------------------------------
async function checkReceipts(admin: ReturnType<typeof createClient>) {
  const before = new Date(Date.now() - RECEIPT_DELAY_MS).toISOString();

  const { data } = await admin
    .from('push_outbox')
    .select('id, tickets')
    .eq('status', 'sent')
    .is('receipts_checked_at', null)
    .lt('sent_at', before)
    .limit(BATCH);

  const rows = (data || []) as { id: number; tickets: { token: string; id: string }[] }[];
  if (rows.length === 0) return { receiptsChecked: 0, tokensRemoved: 0 };

  // Ticket id → the device it went to, so an error can be traced back.
  const tokenFor = new Map<string, string>();
  for (const row of rows) for (const t of row.tickets || []) tokenFor.set(t.id, t.token);

  const ids = Array.from(tokenFor.keys());
  const deadTokens = new Set<string>();

  for (const group of chunk(ids, CHUNK * 10)) {
    try {
      const response = await fetch(EXPO_RECEIPTS, {
        method: 'POST',
        headers: expoHeaders(),
        body: JSON.stringify({ ids: group }),
      });
      const parsed = await response.json();
      const receipts = (parsed?.data || {}) as Record<string, Receipt>;

      for (const [ticketId, receipt] of Object.entries(receipts)) {
        if (receipt.status !== 'error') continue;
        if (receipt.details?.error !== 'DeviceNotRegistered') continue;
        const token = tokenFor.get(ticketId);
        if (token) deadTokens.add(token);
      }
    } catch {
      // Leave receipts_checked_at unset and try again next run.
      return { receiptsChecked: 0, tokensRemoved: 0 };
    }
  }

  await admin
    .from('push_outbox')
    .update({ receipts_checked_at: new Date().toISOString() })
    .in('id', rows.map((row) => row.id));

  const removed = await forgetTokens(admin, deadTokens);
  return { receiptsChecked: rows.length, tokensRemoved: removed };
}

/**
 * Drop tokens Expo says are gone. The app re-registers on its next launch, so
 * deleting is safe — and keeping them is not, because a dead token is retried
 * on every future send.
 */
async function forgetTokens(
  admin: ReturnType<typeof createClient>,
  tokens: Set<string>,
): Promise<number> {
  if (tokens.size === 0) return 0;
  const { error } = await admin.from('push_device').delete().in('token', Array.from(tokens));
  if (error) return 0;
  return tokens.size;
}
