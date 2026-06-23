// =============================================================
// Supabase Edge Function: intake-upload
// =============================================================
// Public (no-JWT) endpoint that lets the token-keyed onboarding form
// (migration 120/123) attach files — e.g. a scan of the client's ID.
// Anonymous browsers can't write to storage, so this validates the
// intake token with the service role, checks the file by magic number
// + size, writes it to the private `intake-attachments` bucket, and
// appends the metadata to the submission's `attachments` array.
// Deploy with "Verify JWT" OFF.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const ALLOWED = 'PDF, JPG, PNG or HEIC';

// Magic-number sniff — mirrors detectAllowedFileType in src/services/api.ts
// (kept in sync intentionally). Allows images + PDF only; XML isn't a thing a
// client would attach during onboarding, so it's excluded here.
function detectType(b: Uint8Array, name: string): { ok: boolean; type?: string; reason?: string } {
  if (b.length < 4) return { ok: false, reason: 'File is too small to identify.' };
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D) return { ok: true, type: 'application/pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { ok: true, type: 'image/png' };
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { ok: true, type: 'image/jpeg' };
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const sub = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'hevc', 'heis', 'avif'].includes(sub)) return { ok: true, type: 'image/heic' };
  }
  return { ok: false, reason: `File type not accepted. Allowed: ${ALLOWED}. (${name})` };
}

const safeSegment = (s: string) =>
  (s || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 120) || 'file';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: 'Expected multipart form data.' });

    const token = String(form.get('token') || '').trim();
    const kind = String(form.get('kind') || 'other').trim().slice(0, 40) || 'other';
    const file = form.get('file');
    if (!token) return json({ ok: false, error: 'Missing token.' });
    if (!(file instanceof File)) return json({ ok: false, error: 'No file provided.' });
    if (!file.size) return json({ ok: false, error: 'File is empty.' });
    if (file.size > MAX_BYTES) return json({ ok: false, error: 'File is larger than 10 MB.' });

    const supa = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Validate the token the same way the submit RPC does: row must exist,
    // still be open (pending/submitted) and not expired.
    const { data: sub, error: subErr } = await supa
      .from('client_intake_submissions')
      .select('id, status, expires_at, attachments')
      .eq('token', token)
      .maybeSingle();
    if (subErr) return json({ ok: false, error: subErr.message });
    if (!sub) return json({ ok: false, error: 'This link is not valid.' });
    if (sub.expires_at && new Date(sub.expires_at).getTime() <= Date.now()) {
      return json({ ok: false, error: 'This link has expired.' });
    }
    if (!['pending', 'submitted'].includes(sub.status)) {
      return json({ ok: false, error: 'This form is no longer open.' });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniff = detectType(bytes.subarray(0, 16), file.name);
    if (!sniff.ok) return json({ ok: false, error: sniff.reason });

    const storagePath = `${sub.id}/${Date.now()}__${safeSegment(file.name)}`;
    const up = await supa.storage.from('intake-attachments').upload(storagePath, bytes, {
      contentType: sniff.type || file.type || 'application/octet-stream',
      upsert: false,
    });
    if (up.error) return json({ ok: false, error: up.error.message });

    const entry = {
      name: file.name,
      mime: sniff.type || file.type || 'application/octet-stream',
      size: file.size,
      kind,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
    };
    const next = Array.isArray(sub.attachments) ? [...sub.attachments, entry] : [entry];
    const { error: updErr } = await supa
      .from('client_intake_submissions')
      .update({ attachments: next })
      .eq('id', sub.id);
    if (updErr) {
      // Roll back the orphaned object so we don't leave a file with no record.
      await supa.storage.from('intake-attachments').remove([storagePath]).catch(() => {});
      return json({ ok: false, error: updErr.message });
    }

    return json({ ok: true, file: entry });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
