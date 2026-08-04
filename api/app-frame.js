// Vercel serverless function — serves an uploaded app's HTML for embedding in
// an iframe. Served SAME-ORIGIN (portal.primeandcalculate.com) with NO
// restrictive CSP and NO X-Frame-Options, so the app's own inline scripts run.
// (Supabase Functions/Storage force `default-src 'none'; sandbox` on everything
// they serve, and blob/srcdoc frames inherit the portal CSP — both block inline
// scripts. This route is exempted from the portal's strict headers in
// vercel.json.)
//
// An iframe GET carries no session, so the app is fetched by the VARIANT TOKEN
// of the client's allocation (migrations 170-172): an unguessable value the
// portal hands to the frame after it has authorised the user. app_frame_html()
// resolves it to that client's customised copy, else the version they were held
// on, else the shared template. Apps used to be fetched by key against a
// world-readable app_templates, which let anyone who guessed a key download the
// app; the token closes that.
//
// It returns ONLY app UI code. Client data never passes through here — it flows
// in over postMessage from the portal parent. The embedding iframe is sandboxed
// (scripts only, no same-origin) for isolation.
//
//   GET /api/app-frame?v=<variantToken>  → 200 text/html (the app), or 404

// Uploaded apps are written against a host that gives them `window.storage`
// (get/set/delete, promise-based). The portal speaks postMessage instead, so
// the shim below bridges the two: the app's key/value pairs live in the one
// JSON document the portal already keeps per (client, app), and a set() posts
// it back for saving. Injected ahead of the app's own code so it exists before
// anything calls it, and harmless for apps that never touch it.
//
// Without this an uploaded app appears to work and then loses everything on
// reload — its writes go nowhere.
const STORAGE_SHIM = `<script>(function(){
  var doc=null, ready=false, waiting=[], saveT=null;
  function flush(){ ready=true; var q=waiting; waiting=[]; q.forEach(function(f){ try{f();}catch(e){} }); }
  window.addEventListener("message", function(e){
    var m=e.data||{};
    if(m.type==="init"){
      doc=(m.data&&typeof m.data==="object")?m.data:{};
      // Who the portal says this is. An app that drops its own sign-in reads
      // identity from here, so a grant of 'viewer' cannot be edited around.
      window.__portalUser={ role:m.role||"viewer", name:m.name||"" };
      flush();
    }
  });
  function when(fn){ ready?fn():waiting.push(fn); }
  function persist(){
    clearTimeout(saveT);
    saveT=setTimeout(function(){ try{ window.parent.postMessage({type:"save",data:doc},"*"); }catch(e){} },300);
  }
  window.storage={
    get:function(k){ return new Promise(function(res){ when(function(){ var v=doc[k]; res(v===undefined||v===null?null:{value:v}); }); }); },
    set:function(k,v){ return new Promise(function(res){ when(function(){ doc[k]=v; persist(); res(true); }); }); },
    delete:function(k){ return new Promise(function(res){ when(function(){ delete doc[k]; persist(); res(true); }); }); },
    remove:function(k){ return window.storage.delete(k); },
    keys:function(){ return new Promise(function(res){ when(function(){ res(Object.keys(doc)); }); }); }
  };
  // Ask the portal for this client's document.
  if(window.parent!==window){ try{ window.parent.postMessage({type:"ready"},"*"); }catch(e){} }
  else { doc={}; flush(); }
})();<\/script>`;

export default async function handler(req, res) {
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

  // A page left open from before this change asks by key alone; it just needs
  // reloading to be handed a token.
  if (!variant) return notFound('This app needs reloading — please refresh the page.');
  if (!base || !anon) return notFound('App hosting is not configured.');

  try {
    const r = await fetch(`${base}/rest/v1/rpc/app_frame_html`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: variant }),
    });
    const html = await r.json();
    // The shim goes FIRST, so window.storage exists before the app's own code
    // runs. Without it an app that stores anything loads blank and saves into
    // nothing, with no error to show for it.
    if (typeof html === 'string' && html) return sendHtml(200, STORAGE_SHIM + html);
    return notFound('This app is not available.');
  } catch (e) {
    return notFound('Failed to load the app.');
  }
}
