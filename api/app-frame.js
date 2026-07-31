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
//   GET /api/app-frame?key=<templateKey>  → 200 text/html (the app), or 404

export default async function handler(req, res) {
  const key = String((req.query && req.query.key) || '');
  const base = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const sendHtml = (status, html) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).send(html);
  };
  const notFound = (msg) =>
    sendHtml(404, `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px;color:#334155">${msg}</body>`);

  if (!key) return notFound('No app specified.');
  if (!base || !anon) return notFound('App hosting is not configured.');

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
