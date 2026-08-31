// Split the reporting template into a shell and an external script.
//
// Why this exists: the portal is served under
//
//   script-src 'self' 'wasm-unsafe-eval'
//
// with no 'unsafe-inline'. template-app.built_5.html is one 124KB INLINE
// script, and a blob: iframe inherits the parent's policy — so on the live
// site the browser silently refused to run it. The markup and CSS rendered
// (style-src allows inline), which is why the sign-in screen appeared, looked
// right, and had an empty client dropdown: the code that fills it never ran.
//
// Nothing in the console said so, because the violation is reported inside the
// blob frame rather than the page around it. It was found by evaluating the
// template's own script by hand inside the frame and reading what came back.
//
// An external script from the same origin IS allowed by 'self' — verified in
// the deployed page before this was written — so the script moves out of the
// document and the policy stays as strict as it was. The afdata block stays
// inline: type="application/json" is data, not script, and CSP does not touch
// it.
//
// The two patches the application used to apply when serving the template are
// applied here instead, once, at build time. They never depended on the client.
//
// Output (both generated, both gitignored):
//   public/reporting-shell.html   markup, the empty afdata block, __APP_JS__
//   public/reporting-app.js       the template's script, patched

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public', 'reporting-template.html');
const SHELL = join(root, 'public', 'reporting-shell.html');
const APP = join(root, 'public', 'reporting-app.js');

const html = readFileSync(SRC, 'utf8');

// ---- find the two script blocks -------------------------------------

const dataOpen = html.indexOf('<script id="afdata" type="application/json">');
if (dataOpen < 0) throw new Error('The template has no afdata block.');
const dataStart = html.indexOf('>', dataOpen) + 1;
const dataEnd = html.indexOf('</script>', dataStart);

// The application script is the next one after the data block.
const appOpen = html.indexOf('<script', dataEnd);
if (appOpen < 0) throw new Error('The template has no application script.');
const appStart = html.indexOf('>', appOpen) + 1;
const appEnd = html.indexOf('</script>', appStart);
if (appEnd < 0) throw new Error('The application script is not closed.');

let script = html.slice(appStart, appEnd);

// ---- patch 1: the Data import table reads this client's feeds --------
//
// The template's FEEDS is a hardcoded list of A&F's own file names, so it
// showed one client's ledger and chart of accounts, marked LOADED, to whoever
// was signed in. A filename is client information.

const call = 'FEEDS.forEach(([n,why,fr,file,when,covers,got])=>{';
if (script.includes(call)) {
  script = script.replace(call,
    '(D.feeds&&D.feeds.length?D.feeds:FEEDS).forEach(([n,why,fr,file,when,covers,got])=>{');
} else {
  throw new Error('FEEDS.forEach not found — the template has changed shape.');
}

// TODAY is what "how old" is measured from, and what turns a monthly feed
// overdue past 45 days. Hardcoded to the day the prototype was written, every
// file looks newer as the real date moves on and nothing ever goes overdue.
const today = script.match(/const TODAY="\d{4}-\d{2}-\d{2}";/);
if (today) {
  script = script.replace(today[0], 'const TODAY=new Date().toISOString().slice(0,10);');
} else {
  throw new Error('const TODAY not found — the template has changed shape.');
}

// ---- patch 3: the feed table states, it does not import ---------------
//
// There were two screens called Data import: this one, which could not import,
// and the portal's, which can. Pete named the overlap and chose to end it here
// — this becomes a statement of what is loaded, and all loading happens in one
// place.
//
// The Upload buttons were prototype stubs that raised an alert saying the
// wiring was "build phase P1". Wiring them to jump to the real importer only
// made it worse: it raced the router and put people back on the sign-in
// screen. A button that cannot do the thing it names is worse than no button,
// so the column goes and one link takes its place.

{
  // Anchored on Status, because another table has an Action column too and
  // an unanchored replace took that one instead.
  const th = '<th>Status</th><th class="num">Action</th>';
  if (!script.includes(th)) throw new Error('the feed table Action column is not where it was.');
  script = script.replace(th, '<th>Status</th>');

  const td = '`<td class="num"><button class="sgn" data-up="${n}">Upload</button></td></tr>`;});';
  if (!script.includes(td)) throw new Error('the Upload cell is not where it was.');
  script = script.replace(td, '`</tr>`;});');

  // One link, after the table, to the place that does the loading.
  const close = 'h+="</tbody></table>";';
  if (!script.includes(close)) throw new Error('the feed table close is not where it was.');
  const link = 'h+=' + JSON.stringify(
    '<p style="margin:10px 0 0;font-size:.82rem">'
    + '<a href="#" id="pcpLoadFiles">Load files in the portal \u2192</a></p>',
  ) + ';';
  script = script.replace(close, close + link);

  // The old per-button handler becomes one handler for that link.
  const open = "document.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>{";
  const shut = 'build phase P1.");}));';
  const a = script.indexOf(open);
  const b = script.indexOf(shut, a);
  if (a < 0 || b < 0) throw new Error('the Upload handler is not where it was.');
  script =
    script.slice(0, a) +
    "{const L=document.getElementById('pcpLoadFiles');" +
    "if(L)L.addEventListener('click',function(e){e.preventDefault();" +
    "parent.postMessage({type:'pcp-open-import',key:CID},'*');});}" +
    script.slice(b + shut.length);
}

// ---- patch 4: a ledger with no ageing says so -------------------------
//
// renderLedgers opens with A.deb.map(...) on D.agetot, and agetot is {} for
// every client — the debtor and creditor ageing is not something the builder
// produces yet. So Debtors & creditors threw
//
//   TypeError: Cannot read properties of undefined (reading 'map')
//
// on every client, A&F included, and the screen died instead of saying that
// nothing is loaded. The Overview already reads this honestly: its two tiles
// print an em dash against "no ageing loaded". This makes the ledgers screen
// agree with them rather than break.
//
// The table below is left to drawLedger, which is already safe on empty arrays
// and prints the ledger with its headings and no rows; drawLdHist already says
// "No history rebuilt for this ledger". Only the tiles, the two bar charts and
// the note needed guarding.

{
  const head = 'function renderLedgers(){\n  const A=D.agetot;\n';
  if (!script.includes(head)) throw new Error('renderLedgers is not where it was.');

  const tiles = '<div class="tile" style="grid-column:1/-1">'
    + '<div class="k">Debtors and creditors</div><div class="v">—</div>'
    + '<div class="d">No ageing has been loaded for this client, so there is nothing to age.</div>'
    + '</div>';
  const note = '<b>What this says</b>Nothing yet. The debtor and creditor ageing is not among '
    + 'the files loaded for this client, so this screen has nothing to show. That is not an error.';

  const guard = [
    '  if(!A||!Array.isArray(A.deb)||!Array.isArray(A.cre)){',
    "    var ldT=document.getElementById('ldTiles');",
    '    if(ldT)ldT.innerHTML=' + JSON.stringify(tiles) + ';',
    "    ['chDeb','chCre'].forEach(function(id){var e=document.getElementById(id);if(e)e.innerHTML='';});",
    "    var ldN=document.getElementById('ldNote');",
    '    if(ldN)ldN.innerHTML=' + JSON.stringify(note) + ';',
    '    drawLedger();',
    '    return;',
    '  }',
    '',
  ].join('\n');

  script = script.replace(head, head + guard);
}

// ---- patch 5: the cash flow note reads the period that is there --------
//
// renderCash ends on a sentence about "the 2026 operating inflow of ${C[2].ops}"
// — the third column, because the prototype had exactly three. A client with
// two financial years on the books has no C[2], and the screen would die on the
// last line of the function it had just drawn correctly. It reads the latest
// period instead, which is what the sentence is about in any case.

{
  const third = 'C[2].ops';
  if (!script.includes(third)) throw new Error('the cash flow note is not where it was.');
  script = script.split(third).join('C[C.length-1].ops');
}

// ---- patch 2: ask the portal for a client at sign-in -----------------
//
// The sign-in screen needs names, not figures. Sixty-three clients' postings
// cannot be read before it will open, so the payload carries names only and
// the chosen client is fetched when it is chosen. Nothing of the template is
// rewritten: a capture-phase listener on its own Sign in button runs first,
// then lets the click through to the template's own signIn().

script += `

/* ---------- appended by tools/build-reporting-app.mjs ---------- */
(function(){
  // Opened on its own, with no portal behind it, there is nobody to ask.
  if (parent === window) return;

  var loaded = {};

  function ask(key){
    return new Promise(function(resolve, reject){
      var timer = setTimeout(function(){
        window.removeEventListener('message', on);
        reject(new Error('the portal did not answer'));
      }, 600000);
      function on(e){
        var d = e.data;
        // Progress from the portal, shown where the person is actually looking.
        // The portal has always known how far it had got; it was reporting it
        // into its own footer strip, four hundred pixels below the button that
        // had just gone grey. A client with 174.026 postings takes a minute or
        // two, and a message that never changes reads as a hang.
        if(d && d.type === 'pcp-progress' && d.key === key){
          if(note) note.textContent = d.text;
          return;
        }
        if(!d || d.type !== 'pcp-client-data' || d.key !== key) return;
        clearTimeout(timer);
        window.removeEventListener('message', on);
        if(d.error) reject(new Error(d.error)); else resolve(d.block);
      }
      window.addEventListener('message', on);
      parent.postMessage({ type:'pcp-need-client', key:key }, '*');
    });
  }

  var note = document.getElementById('loginNote');
  var said = note ? note.textContent : '';
  var go = document.getElementById('loginGo');
  var sel = document.getElementById('loginClient');
  if (!go || !sel) return;

  function guard(e){
    var key = sel.value;
    if(loaded[key]) return;              // already here: let the real handler run
    e.stopImmediatePropagation();
    e.preventDefault();
    var who = (ALL.clients[key] && ALL.clients[key].cfg) ? ALL.clients[key].cfg.name : key;
    if(note) note.textContent = 'Reading ' + who + '\\u2026';
    go.disabled = true;
    ask(key).then(function(block){
      if(block) ALL.clients[key] = block;
      loaded[key] = true;
      go.disabled = false;
      if(note) note.textContent = said;
      go.click();                        // second pass falls through to signIn()
    }).catch(function(err){
      go.disabled = false;
      if(note) note.textContent = 'Could not read ' + who + ': ' + err.message;
    });
  }

  go.addEventListener('click', guard, true);
  var pass = document.getElementById('loginPass');
  if (pass) pass.addEventListener('keydown', function(e){
    if(e.key !== 'Enter') return;
    if(loaded[sel.value]) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    go.click();
  }, true);
})();
`;

// ---- write the two files --------------------------------------------

// The template begins at <title> with no <head> and no <meta charset>, which is
// harmless when a server sends the charset and wrong the moment it is opened
// from a blob: the browser guesses Latin-1 and every Greek client name in the
// register turns to mojibake.
const declaresCharset = /<meta[^>]+charset/i.test(html.slice(0, 4000));
const head = declaresCharset ? '' : '<meta charset="utf-8">\n';

const shell =
  head +
  html.slice(0, dataStart) +            // everything up to and including the afdata open tag
  '__PAYLOAD__' +
  html.slice(dataEnd, appOpen) +        // </script> and whatever sits between the two
  '<script src="__APP_JS__"></script>' +
  html.slice(appEnd + '</script>'.length);

writeFileSync(SHELL, shell, 'utf8');
writeFileSync(APP, script, 'utf8');

const kb = (n) => Math.round(n / 1024).toLocaleString('en-GB') + ' KB';
console.log(`reporting shell  ${kb(shell.length)}  ->  public/reporting-shell.html`);
console.log(`reporting app    ${kb(script.length)}  ->  public/reporting-app.js`);
