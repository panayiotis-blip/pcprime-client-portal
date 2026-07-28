// One-off build: split the standalone Greson_Property_Rentals.html into a
// CSP-clean index.html + app.js for embedding in the portal. Moves the code
// verbatim, then applies surgical transforms (each asserted so any drift on
// re-run fails loudly). Not shipped — kept for reproducibility.
const fs = require('fs');
const SRC = 'C:/data/PCPrimeAPP/Greson_Property_Rentals.html';
const OUT = 'C:/data/PCPrimeAPP/public/rental-app';

let html = fs.readFileSync(SRC, 'utf8');
function must(cond, msg){ if(!cond) throw new Error('ASSERT FAILED: ' + msg); }
function replaceOnce(s, find, rep, label){ must(s.includes(find), 'missing: ' + label); return s.split(find).join(rep); }

// --- rewrite CDN libs to local vendored copies ---
html = replaceOnce(html, 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', './vendor/chart.umd.min.js', 'chart cdn');
html = replaceOnce(html, 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', './vendor/xlsx.full.min.js', 'xlsx cdn');

// --- strip embedded data + ledger blobs (data now comes from the portal) ---
html = html.replace(/<script id="(embedded-data|ledger-data|ledger-data-2)">[\s\S]*?<\/script>\s*/g, '');
must(!/<script id="embedded-data"/.test(html) && !/<script id="ledger-data"/.test(html), 'data blocks not stripped from head');

// --- split head/body (before main script) from the inline script body ---
const parts = html.split(/<script>\r?\n/);
must(parts.length === 2, 'expected exactly one bare <script> (got ' + parts.length + ')');
let headBody = parts[0];
// Cut the closing </script></body></html> tail (there's markup after the tag,
// so an end-anchored strip misses it; the last </script> is the real close).
let js = parts[1].slice(0, parts[1].lastIndexOf('</script>'));
must(!js.includes('</script>'), 'unexpected literal </script> left in script body');

// Base tag so relative asset URLs resolve when the page is embedded via srcdoc.
headBody = replaceOnce(headBody, '<html lang="en"><head>', '<html lang="en"><head>\n<base href="/rental-app/">', 'base tag');

// ============ transforms on the script body (js) ============

// 1) Inline HTML handlers -> data-* attributes (dispatched by delegation).
//    Only the string-attribute form ('onclick="') is touched; JS property
//    assignments ('.onclick=(') have no '="' and are left alone.
js = js.split('onclick="').join('data-h="');
js = js.split('onchange="').join('data-hc="');
js = js.split('onkeydown="').join('data-hk="');

// 2) load(): start empty; the portal injects real data via the init message.
js = replaceOnce(js,
  'function load(){ try{const s=localStorage.getItem(LS); if(s)return norm(JSON.parse(s));}catch(e){} return norm(JSON.parse(JSON.stringify(window.__EMBEDDED_DATA__))); }',
  'function load(){ return norm({meta:{},tenants:[],properties:[],users:[],audit:[]}); }',
  'load()');

// 3) persist(): autosave to the portal instead of localStorage.
js = replaceOnce(js,
  'try{localStorage.setItem(LS,JSON.stringify(DATA));}catch(e){ flash("⚠ Storage full — PDFs are large. Use Save/share to keep a copy."); }',
  'postSave();',
  'persist() storage');

// 4) Drop the app's own Users tab (auth is the portal's).
js = replaceOnce(js, 'if(user&&user.role==="admin")t.push(["users","Users"]); ', '', 'users tab');

// 4b) "Save / share" rebuilt a standalone HTML from the embedded-data blocks,
//     which no longer exist. Repoint it to a JSON backup download instead.
js = replaceOnce(js,
  'document.getElementById("btnSave").onclick=saveSnapshot;',
  'document.getElementById("btnSave").onclick=function(){ try{ dl(new Blob([JSON.stringify(DATA,null,2)],{type:"application/json"}), "greson-rentals-"+stamp(new Date()).replace(/[: ]/g,"-")+".json"); flash("Backup downloaded."); }catch(e){} };',
  'btnSave repoint');

// 5) logout: tell the portal instead of showing the app login.
js = replaceOnce(js,
  'window.logout=function(){ user=null; showLogin("Signed out."); };',
  'window.logout=function(){ if(window.parent!==window) window.parent.postMessage({type:"logout"},"*"); };',
  'logout');

// 6) Boot: wait for the portal's init message instead of auto-login.
js = replaceOnce(js,
  'ensureUsers(); applyLedger(); seedUnits(); showLogin("");',
  [
    'window.addEventListener("message", function(ev){ var m=ev.data||{}; if(m.type!=="init")return;',
    '  DATA = norm(m.data && Object.keys(m.data).length ? JSON.parse(JSON.stringify(m.data)) : {meta:{},tenants:[],properties:[],users:[],audit:[]});',
    '  user = { username: m.username||"portal", name: m.name||"", role: m.role||"viewer" };',
    '  __SUPPRESS_SAVE=true; try{ applyLedger(); }catch(e){} try{ seedUnits(); }catch(e){} __SUPPRESS_SAVE=false;',
    '  document.getElementById("app").classList.remove("hidden");',
    '  initShell(); render();',
    '});',
    'if(window.parent!==window) window.parent.postMessage({type:"ready"}, "*");',
  ].join('\n'),
  'boot');

// 7) Append the bridge: delegated dispatcher + debounced autosave.
js += `

/* ---- portal bridge: event delegation (replaces inline handlers) + autosave ---- */
var __SUPPRESS_SAVE=false, __saveT=null;
function __parseArgs(s){ s=(s||"").trim(); if(!s)return[]; var parts=[],cur="",q=null,depth=0;
  for(var i=0;i<s.length;i++){ var c=s[i];
    if(q){ cur+=c; if(c===q)q=null; continue; }
    if(c==="'"||c==='"'){ q=c; cur+=c; continue; }
    if(c==="("||c==="["){depth++;cur+=c;continue;}
    if(c===")"||c==="]"){depth--;cur+=c;continue;}
    if(c===","&&depth===0){ parts.push(cur); cur=""; continue; }
    cur+=c; }
  if(cur.trim()!=="")parts.push(cur);
  return parts.map(function(p){ p=p.trim();
    if(/^-?\\d+(\\.\\d+)?$/.test(p))return Number(p);
    if((p[0]==="'"&&p.slice(-1)==="'")||(p[0]==='"'&&p.slice(-1)==='"'))return p.slice(1,-1);
    if(p==="null")return null; if(p==="true")return true; if(p==="false")return false;
    return p; }); }
function __resolve(name){ var parts=name.split("."); var o=window; for(var i=0;i<parts.length;i++){ o=o&&o[parts[i]]; } return o; }
function __run(expr,ev){ if(!expr)return; var ret=/;\\s*return\\s+false;?\\s*$/.test(expr); expr=expr.replace(/;\\s*return\\s+false;?\\s*$/,"").trim();
  var m=expr.match(/^([\\w.]+)\\(([\\s\\S]*)\\)$/); if(!m)return; var fn=__resolve(m[1]); if(typeof fn!=="function")return;
  if(ret&&ev)ev.preventDefault(); fn.apply(null,__parseArgs(m[2])); }
document.addEventListener("click",function(e){ var el=e.target.closest?e.target.closest("[data-h]"):null; if(el)__run(el.getAttribute("data-h"),e); });
document.addEventListener("change",function(e){ var el=e.target.closest?e.target.closest("[data-hc]"):null; if(el)__run(el.getAttribute("data-hc"),e); });
document.addEventListener("keydown",function(e){ var el=e.target.closest?e.target.closest("[data-hk]"):null; if(el)__run(el.getAttribute("data-hk"),e); });
function postSave(){ if(__SUPPRESS_SAVE||window.parent===window)return; clearTimeout(__saveT); __saveT=setTimeout(function(){ try{ window.parent.postMessage({type:"save",data:DATA},"*"); }catch(e){} }, 700); }
`;

// ============ assemble index.html ============
const indexHtml = headBody + '<script src="./app.js"></script>\n</body></html>\n';

fs.writeFileSync(OUT + '/index.html', indexHtml);
fs.writeFileSync(OUT + '/app.js', js);
console.log('wrote index.html (' + indexHtml.length + ' b) + app.js (' + js.length + ' b)');
console.log('handlers remaining inline in app.js (should be 0):', (js.match(/on(click|change|keydown)="/g)||[]).length);
console.log('data-h count:', (js.match(/data-h="/g)||[]).length, ' data-hc:', (js.match(/data-hc="/g)||[]).length);
