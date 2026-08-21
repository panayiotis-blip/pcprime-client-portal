// =============================================================
// Supabase Edge Function: app-files
// =============================================================
// File storage for embedded client apps (migration 184). Replaces the old
// habit of stuffing base64 dataUrls into client_app_data.data, which took the
// Greson rentals document to 23 MB and broke saving outright.
//
// TWO AUDIENCES, ONE DOOR. An embedded app is opened either by firm staff
// (real Supabase JWT) or by an app-only client user (opaque HMAC session from
// app-session — invisible to RLS). Both arrive here; each is verified its own
// way, and both come out holding the same thing: a client_id + app_key the
// caller is allowed to touch. Everything downstream works off that pair, so
// there is one authorisation model rather than two.
//
// Actions (POST { action, ... }):
//   upload {session|client_id+app_key, name, mime, data}  → { ok, file:{name,path,size,uploaded} }
//   sign   {session|client_id+app_key, path, download?}   → { ok, url }   (60s)
//   remove {session|client_id+app_key, path}              → { ok }
//
// `data` is a base64 payload or a full data: URL — the browser reads files with
// FileReader, so it already holds one of those.
//
// PATH DISCIPLINE. Objects live at <client_id>/<app_key>/<uuid>.<ext>. Every
// action re-derives that prefix from the *verified* caller and refuses any path
// outside it, so a tampered path cannot reach another client's contracts. The
// bucket's read policy is a second lock; this is the first.
//
// Deploy with "Verify JWT" OFF — a staff JWT is validated in-function, and app
// users have no JWT at all.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'client-app-files';
const MAX_BYTES = 25 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlToBytes(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlFromBytes(b: Uint8Array): string {
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlFromBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
// Same scheme as app-session — a session this function accepts is one that
// function issued, and expiry is honoured here too.
async function verifySession(token: string, secret: string): Promise<any | null> {
  const dot = token.indexOf('.'); if (dot < 0) return null;
  const p = token.slice(0, dot), s = token.slice(dot + 1);
  if ((await hmac(p, secret)) !== s) return null;
  try {
    const obj = JSON.parse(dec.decode(b64urlToBytes(p)));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

// A file name from a browser is user input: it can carry paths, control
// characters and unicode that Storage will not accept. The extension is the
// only part worth keeping — the object is named by uuid, and the display name
// travels in the document, not the key.
function safeExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? '.' + m[1].toLowerCase() : '';
}
function bytesFromBase64(data: string): Uint8Array {
  const comma = data.indexOf(',');
  const raw = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  const bin = atob(raw.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(url, serviceKey);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
  const action = String(body.action || '');

  // ---- Who is calling, and for which client/app? ----
  let clientId: number | null = null;
  let appKey = '';
  let readOnly = false;

  if (body.session) {
    const s = await verifySession(String(body.session), serviceKey);
    if (!s) return json({ ok: false, error: 'Session expired — please sign in again.' }, 401);
    clientId = Number(s.cid); appKey = String(s.app);
    readOnly = s.role === 'viewer';
  } else {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, error: 'Unauthorized.' }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ ok: false, error: 'Unauthorized.' }, 401);

    clientId = Number(body.client_id); appKey = String(body.app_key || '');
    if (!clientId || !appKey) return json({ ok: false, error: 'client_id and app_key are required.' }, 400);
    // Reach is decided by the same function the rest of the portal uses, called
    // as the caller — not as the service role, which can reach everything.
    const { data: allowed, error: aErr } = await userClient
      .rpc('user_can_access_client', { cid: clientId });
    if (aErr) return json({ ok: false, error: aErr.message }, 500);
    if (!allowed) return json({ ok: false, error: 'Forbidden.' }, 403);
  }

  const prefix = `${clientId}/${appKey}/`;

  // A path is only ever accepted if it sits under the verified caller's own
  // prefix. Checked before the path reaches Storage, for every action.
  const ownPath = (p: unknown): string | null => {
    const s = String(p || '');
    if (!s.startsWith(prefix)) return null;
    if (s.includes('..')) return null;
    return s;
  };

  if (action === 'upload') {
    if (readOnly) return json({ ok: false, error: 'Read-only access.' }, 403);
    const name = String(body.name || 'file');
    const mime = String(body.mime || 'application/octet-stream');
    if (!body.data) return json({ ok: false, error: 'No file data.' }, 400);

    let bytes: Uint8Array;
    try { bytes = bytesFromBase64(String(body.data)); }
    catch { return json({ ok: false, error: 'File data was not readable.' }, 400); }
    if (!bytes.length) return json({ ok: false, error: 'That file is empty.' }, 400);
    if (bytes.length > MAX_BYTES) {
      return json({ ok: false, error: `That file is ${(bytes.length / 1048576).toFixed(1)} MB. The limit is 25 MB.` }, 413);
    }

    const path = `${prefix}${crypto.randomUUID()}${safeExt(name)}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime, upsert: false,
    });
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({
      ok: true,
      file: { name, path, size: bytes.length, mime, uploaded: new Date().toISOString() },
    });
  }

  if (action === 'sign') {
    const path = ownPath(body.path);
    if (!path) return json({ ok: false, error: 'Not found.' }, 404);
    const { data, error } = await admin.storage.from(BUCKET)
      .createSignedUrl(path, 60, body.download ? { download: String(body.download) } : undefined);
    if (error) return json({ ok: false, error: error.message }, 404);
    return json({ ok: true, url: data?.signedUrl });
  }

  if (action === 'remove') {
    if (readOnly) return json({ ok: false, error: 'Read-only access.' }, 403);
    const path = ownPath(body.path);
    if (!path) return json({ ok: false, error: 'Not found.' }, 404);
    const { error } = await admin.storage.from(BUCKET).remove([path]);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
});
