// Vercel serverless function — serves an uploaded app template's HTML for
// embedding in an iframe. Served SAME-ORIGIN (portal.primeandcalculate.com)
// with NO restrictive CSP and NO X-Frame-Options, so the app's own inline
// scripts run. (Supabase Functions/Storage force `default-src 'none'; sandbox`
// on everything they serve, and blob/srcdoc frames inherit the portal CSP —
// both block inline scripts. This route is exempted from the portal's strict
// headers in vercel.json.)
//
// It returns ONLY the template shell (UI code). Client data never passes
// through here — it flows in over postMessage from the portal parent. The
// embedding iframe is sandboxed (scripts only, no same-origin) for isolation.
//
// A client can be running its OWN copy of the app — customised for them, or
// pinned to the version they were on when the shared template moved on
// (migration 170). This request carries no session, so that copy is fetched by
// the client's unguessable variant token via the app_frame_html function; the
// shared template is the fallback whenever there is no variant behind it.
//
//   GET /api/app-frame?key=<templateKey>[&v=<variantToken>]  → 200 text/html, or 404

export default async function handler(req, res) {
  const key = String((req.query && req.query.key) || '');
  const variant = String((req.query && req.query.v) || '');
  const base = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const sendHtml = (status, html) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).send(html);
  };
  const notFound = (msg) =>
    sendHtml(404, `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px;color:#334155">${msg}</body>`);

  if (!key && !variant) return notFound('No app specified.');
  if (!base || !anon) return notFound('App hosting is not configured.');

  // A client's own copy first. If the token resolves to nothing — never
  // customised, or just reset back to the shared app — fall through to the
  // template rather than leaving them staring at an error.
  if (variant) {
    try {
      const r = await fetch(`${base}/rest/v1/rpc/app_frame_html`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_token: variant }),
      });
      const html = await r.json();
      if (typeof html === 'string' && html) return sendHtml(200, html);
    } catch (e) { /* fall back to the shared template */ }
    if (!key) return notFound('This app is not available.');
  }

  try {
    const url = `${base}/rest/v1/app_templates?key=eq.${encodeURIComponent(key)}&active=eq.true&select=html&limit=1`;
    const r = await fetch(url, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
    const rows = await r.json();
    const html = Array.isArray(rows) && rows[0] && rows[0].html;
    if (!html) return notFound('This app is not available.');
    return sendHtml(200, html);
  } catch (e) {
    return notFound('Failed to load the app.');
  }
}
