// =============================================================
// Supabase Edge Function: inbox-action
// =============================================================
// Write-back for the shared info@ Inbox: mark read/unread, archive, trash,
// untrash — applied to Gmail via the Gmail API (gmail.modify) AND mirrored into
// public.inbox_emails so the portal reflects Gmail's true state. This is what
// makes the shared Inbox behave like Outlook (actions sync both ways).
//
// AUTH
//   - Caller: a logged-in staff member's JWT. Deploy with gateway "Verify JWT" OFF.
//   - Gmail: OAuth refresh-token grant for info@, scope gmail.modify. Same
//     GOOGLE_*/GMAIL_ADDRESS secrets as poll-inbox / inbox-send.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const GOOGLE_REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN') || '';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Action = 'read' | 'unread' | 'archive' | 'trash' | 'untrash';
const ACTIONS: Action[] = ['read', 'unread', 'archive', 'trash', 'untrash'];

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: GOOGLE_REFRESH_TOKEN,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  }
  return data.access_token as string;
}

// Apply one action to one Gmail message; returns the message's updated labelIds.
async function applyToGmail(token: string, gmailId: string, action: Action): Promise<string[]> {
  let path: string;
  let body: Record<string, unknown> | undefined;
  if (action === 'trash')        { path = `/messages/${gmailId}/trash`; }
  else if (action === 'untrash') { path = `/messages/${gmailId}/untrash`; }
  else {
    path = `/messages/${gmailId}/modify`;
    if (action === 'read')    body = { removeLabelIds: ['UNREAD'] };
    if (action === 'unread')  body = { addLabelIds: ['UNREAD'] };
    if (action === 'archive') body = { removeLabelIds: ['INBOX'] };
  }
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gmail ${action} failed (${res.status})`);
  return Array.isArray(data.labelIds) ? data.labelIds : [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  // --- staff auth ---
  const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!prof || !['owner', 'supervisor', 'admin', 'staff'].includes(prof.role)) {
    return json({ ok: false, error: 'Staff only.' }, 403);
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return json({ ok: false, error: 'Gmail is not configured — missing GOOGLE_* secrets.' }, 500);
  }

  // --- payload ---
  let p: { action?: string; inbox_email_id?: number; inbox_email_ids?: number[] };
  try { p = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const action = p.action as Action;
  if (!ACTIONS.includes(action)) return json({ ok: false, error: `action must be one of: ${ACTIONS.join(', ')}` }, 400);
  const ids = (p.inbox_email_ids && p.inbox_email_ids.length ? p.inbox_email_ids : [p.inbox_email_id])
    .map(Number).filter(Boolean);
  if (!ids.length) return json({ ok: false, error: 'inbox_email_id(s) required.' }, 400);

  try {
    const token = await getAccessToken();
    const { data: rows } = await admin.from('inbox_emails')
      .select('id, gmail_message_id').in('id', ids);

    const results: Array<{ id: number; label_ids: string[]; is_read: boolean }> = [];
    const errors: Array<{ id: number; error: string }> = [];

    for (const row of rows || []) {
      try {
        const labelIds = await applyToGmail(token, row.gmail_message_id, action);
        const is_read = !labelIds.includes('UNREAD');
        // Mirror Gmail's authoritative label set locally.
        await admin.from('inbox_emails')
          .update({ label_ids: labelIds, is_read })
          .eq('id', row.id);
        results.push({ id: row.id, label_ids: labelIds, is_read });
      } catch (e) {
        errors.push({ id: row.id, error: (e as Error).message });
      }
    }

    return json({ ok: errors.length === 0, action, results, errors });
  } catch (e) {
    return json({ ok: false, error: (e as Error)?.message || String(e) }, 500);
  }
});
