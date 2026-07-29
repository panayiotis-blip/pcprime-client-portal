// One-off build: Greson_Management_Dashboard.html → CSP-clean index.html +
// app.js for embedding. Moves the code verbatim, applies surgical transforms
// (each asserted). Not shipped — kept for reproducibility. Original file +
// its data are never modified.
const fs = require('fs');
const SRC = 'C:/data/PCPrimeAPP/Greson_Management_Dashboard.html';
const OUT = 'C:/data/PCPrimeAPP/public/mgmt-app';

let html = fs.readFileSync(SRC, 'utf8');
function must(c, m) { if (!c) throw new Error('ASSERT FAILED: ' + m); }
function once(s, find, rep, label) { must(s.includes(find), 'missing: ' + label); return s.split(find).join(rep); }

// --- vendor the CDN libs ---
html = once(html, 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', './vendor/chart.umd.min.js', 'chart cdn');
html = once(html, 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', './vendor/xlsx.full.min.js', 'xlsx cdn');

// --- strip the two embedded-data script blocks (data comes from the portal) ---
html = html.replace(/<script id="embedded-data">[\s\S]*?<\/script>\s*/g, '');
html = html.replace(/<script id="div-data">[\s\S]*?<\/script>\s*/g, '');
must(!/<script id="embedded-data"/.test(html) && !/<script id="div-data"/.test(html), 'data blocks not stripped');

// --- split head/body from the main inline <script> ---
const parts = html.split(/<script>\r?\n/);
must(parts.length === 2, 'expected exactly one bare <script> (got ' + parts.length + ')');
let headBody = parts[0];
let js = parts[1].slice(0, parts[1].lastIndexOf('</script>'));
must(!js.includes('</script>'), 'unexpected </script> left in script body');

headBody = once(headBody, '<head>\n<meta charset="UTF-8">', '<head>\n<base href="/mgmt-app/">\n<meta charset="UTF-8">', 'base tag');

// ===== transforms on the script body =====
// 1) inline handlers -> data-* attributes (delegated; JS .onclick= is untouched)
js = js.split('onclick="').join('data-h="');
js = js.split('onchange="').join('data-hc="');
js = js.split('onkeydown="').join('data-hk="');
js = js.split('oninput="').join('data-hi="');

// 2) persist(): autosave to the portal instead of localStorage.
js = once(js, 'try{localStorage.setItem(LS_KEY,JSON.stringify(DATA));}catch(e){}', 'postSave();', 'persist storage');

// 3) logout tells the portal.
js = once(js, 'window.logout=function(){ user=null; showLogin("Signed out."); };',
  'window.logout=function(){ if(window.parent!==window) window.parent.postMessage({type:"logout"},"*"); };', 'logout');

// 4) drop the app's own Users tab (auth is the portal's).
js = once(js, 'function visibleTabs(){ return TABS.filter(t=>t[0]!=="users"||isAdmin()); }',
  'function visibleTabs(){ return TABS.filter(t=>t[0]!=="users"); }', 'users tab');

// 5) boot: wait for the portal's init message instead of auto-login.
js = once(js, 'ensureUsers(); showLogin("");', [
  'window.addEventListener("message", function(ev){ var m=ev.data||{}; if(m.type!=="init")return;',
  '  DATA = normalize(m.data && Object.keys(m.data).length ? JSON.parse(JSON.stringify(m.data)) : {});',
  '  user = { username:m.username||"portal", name:m.name||"", role:m.role||"viewer" };',
  '  activeTab="summary"; initShell();',
  '  var ty=String(new Date().getFullYear()); var sy=document.getElementById("selYear");',
  '  if(sy&&years().indexOf(ty)>=0){ sy.value=ty; var sm=document.getElementById("selMonth"); if(sm)sm.value=(new Date().getMonth()); }',
  '  render();',
  '});',
  'if(window.parent!==window) window.parent.postMessage({type:"ready"}, "*");',
].join('\n'), 'boot');

// 6) stub __EMBEDDED_DATA__ so load() works before the portal injects real data.
js = 'window.__EMBEDDED_DATA__ = window.__EMBEDDED_DATA__ || {meta:{savedAt:""}};\n' + js;

// 7) bridge: delegated dispatcher (click/change/input/keydown) + debounced autosave.
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
document.addEventListener("input",function(e){ var el=e.target.closest?e.target.closest("[data-hi]"):null; if(el)__run(el.getAttribute("data-hi"),e); });
document.addEventListener("keydown",function(e){ var el=e.target.closest?e.target.closest("[data-hk]"):null; if(el)__run(el.getAttribute("data-hk"),e); });
function postSave(){ if(__SUPPRESS_SAVE||window.parent===window)return; clearTimeout(__saveT); __saveT=setTimeout(function(){ try{ window.parent.postMessage({type:"save",data:DATA},"*"); }catch(e){} }, 700); }
`;

const indexHtml = headBody + '<script src="./app.js"></script>\n</body>\n</html>\n';
fs.writeFileSync(OUT + '/index.html', indexHtml);
fs.writeFileSync(OUT + '/app.js', js);
console.log('wrote index.html (' + indexHtml.length + ' b) + app.js (' + js.length + ' b)');
console.log('inline handlers left (should be 0):', (js.match(/on(click|change|input|keydown)="/g) || []).length);
console.log('data-h:', (js.match(/data-h="/g) || []).length, 'data-hc:', (js.match(/data-hc="/g) || []).length, 'data-hi:', (js.match(/data-hi="/g) || []).length, 'data-hk:', (js.match(/data-hk="/g) || []).length);
