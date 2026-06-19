// =============================================================
// Supabase Edge Function: assign-inbox-email
// =============================================================
// Files a message from the shared Inbox (info@) against a client, for future
// reference. Copies it BOTH ways:
//   • client_emails  → shows on the client's Emails tab (body + attachments)
//   • documents      → each attachment lands in the client's Documents folder
// Attachments are copied across Storage buckets server-side (service role),
// which the browser can't do directly.
//
// Deploy with gateway "Verify JWT" OFF — the function authenticates the caller
// itself (staff only).
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const safe = (s: string) => (s || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'file';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const authToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!authToken) return json({ ok: false, error: 'Unauthorized.' }, 401);

  const userClient = createClient(supaUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);

  const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!prof || !['owner', 'supervisor', 'admin', 'staff'].includes(prof.role)) {
    return json({ ok: false, error: 'Staff only.' }, 403);
  }

  let payload: { inbox_email_id?: number; client_id?: number };
  try { payload = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const inboxId = Number(payload.inbox_email_id);
  const clientId = Number(payload.client_id);
  if (!inboxId || !clientId) return json({ ok: false, error: 'inbox_email_id and client_id are required.' }, 400);

  // ---- Load the inbox message ----
  const { data: msg, error: mErr } = await admin.from('inbox_emails').select('*').eq('id', inboxId).maybeSingle();
  if (mErr) return json({ ok: false, error: mErr.message }, 500);
  if (!msg) return json({ ok: false, error: 'Inbox message not found.' }, 404);

  const { data: client } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle();
  if (!client) return json({ ok: false, error: 'Client not found.' }, 404);

  // ---- 1. client_emails row (Emails tab). raw_message_id = the gmail id so a
  //         repeat assignment to the same client dedups instead of duplicating. ----
  const { data: ce, error: ceErr } = await admin.from('client_emails').insert({
    client_id:        clientId,
    direction:        'inbound',
    sender_email:     msg.from_email,
    sender_name:      msg.from_name,
    recipient_emails: msg.to_emails || [],
    cc_emails:        msg.cc_emails || [],
    subject:          msg.subject,
    body_html:        msg.body_html,
    body_plain:       msg.body_plain,
    received_at:      msg.received_at,
    attachment_count: 0,
    raw_message_id:   msg.gmail_message_id,
  }).select('id').single();

  if (ceErr) {
    if ((ceErr as any).code === '23505') return json({ ok: true, already: true });
    return json({ ok: false, error: 'Could not file the email: ' + ceErr.message }, 500);
  }
  const emailId = ce.id;

  // ---- 2. Copy attachments → Emails-tab bucket AND Documents ----
  const { data: atts } = await admin.from('inbox_email_attachments').select('*').eq('email_id', inboxId);
  const ym = (msg.received_at || new Date().toISOString()).slice(0, 7); // YYYY-MM
  let copied = 0;

  for (let i = 0; i < (atts || []).length; i++) {
    const att = atts![i];
    try {
      const dl = await admin.storage.from('inbox-attachments').download(att.storage_path);
      if (dl.error || !dl.data) { console.error('download failed:', att.storage_path, dl.error?.message); continue; }
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const name = safe(att.filename);
      const mime = att.mime_type || 'application/octet-stream';

      // (a) Emails-tab attachment
      const cePath = `${clientId}/${emailId}/${i + 1}__${name}`;
      const upA = await admin.storage.from('client-email-attachments').upload(cePath, bytes, { contentType: mime, upsert: false });
      if (!upA.error) {
        await admin.from('client_email_attachments').insert({
          email_id: emailId, filename: att.filename, mime_type: mime,
          size_bytes: att.size_bytes, storage_path: cePath,
        });
      }

      // (b) Documents folder (category "correspondence")
      const docPath = `${clientId}/correspondence/${Date.now()}_${i + 1}_${name}`;
      const upB = await admin.storage.from('documents').upload(docPath, bytes, { contentType: mime, upsert: false });
      if (!upB.error) {
        await admin.from('documents').insert({
          client_id: clientId, folder_id: null,
          doc_type: 'Email', category: 'correspondence',
          year: ym.slice(0, 4), month: ym,
          file_name: att.filename, mime_type: mime,
          storage_path: docPath, storage_bucket: 'documents',
          notes: `From email: ${msg.subject || '(no subject)'}`,
          uploaded_by: user.id,
        });
      }
      copied++;
    } catch (e) {
      console.error('attachment copy failed:', (e as Error).message);
    }
  }

  if (copied > 0) {
    await admin.from('client_emails').update({ attachment_count: copied }).eq('id', emailId);
  }

  return json({ ok: true, email_id: emailId, attachments_copied: copied });
});
