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

// ---- patch 3: the Upload button does what it says ---------------------
//
// The template's Data import table already tells a person what is loaded: the
// feed, what it is for, how often it is wanted, the last file, when it arrived,
// how old that is, what it covers and whether it is there. The Action column
// beside it held an Upload button per feed, and the button was a stub — it
// raised an alert saying the wiring was "build phase P1".
//
// That column was cut out for a while, on the reasoning that a button which
// cannot do the thing it names is worse than no button. True as far as it goes,
// and the wrong conclusion: the partner asked for one application he can upload
// in. So the button comes back and is wired, rather than removed.
//
// It carries the feed's own name — the first column of the row it sits in —
// because that name is what the host turns back into a feed, a period control
// and an importer (src/reporting/upload/feeds.ts). Sending the row index
// instead would break the day a feed is added in the middle.

{
  // Both are left exactly as the template writes them; what changes is what
  // the button does. Checked here so a template that moved them fails the
  // build rather than shipping a column of buttons that post nothing.
  const th = '<th>Status</th><th class="num">Action</th>';
  if (!script.includes(th)) throw new Error('the feed table Action column is not where it was.');

  const td = '`<td class="num"><button class="sgn" data-up="${n}">Upload</button></td></tr>`;});';
  if (!script.includes(td)) throw new Error('the Upload cell is not where it was.');

  // The stub handler becomes a message to the host, which owns the file
  // chooser, the period, the checks and the folder.
  const open = "document.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',()=>{";
  const shut = 'build phase P1.");}));';
  const a = script.indexOf(open);
  const b = script.indexOf(shut, a);
  if (a < 0 || b < 0) throw new Error('the Upload handler is not where it was.');
  script =
    script.slice(0, a) +
    "document.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',function(){" +
    // Opened on its own, with no portal behind it, there is nobody to ask.
    "if(parent===window){alert('Uploading works inside the portal.');return;}" +
    "parent.postMessage({type:'pcp-upload',feed:this.dataset.up,key:CID},'*');" +
    '}));' +
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

// ---- patch 6: the budget belongs to the client, and to the database ----
//
// BUILD.md §4 names the template a prototype in exactly two respects: its data
// is embedded JSON, and its per-user state is in browser storage. The budget is
// the second of those, and it is worse than it looks:
//
//   const BKEY="pcp-budget-af";
//
// One key, "af", for every client. Key a budget against one client on this
// machine and it is the budget every other client shows — one client's figures
// under another client's name, which is the one thing this application must
// never do. It is also invisible to anyone else in the practice, and gone with
// the browser profile.
//
// So: the key carries the client, the figures are seeded from the payload, and
// saving posts them to the host, which writes reporting.budgets. Local storage
// stays as the immediate write, so typing still feels instant and a save that
// fails does not lose what was typed.

{
  const key = 'const BKEY="pcp-budget-af";';
  if (!script.includes(key)) throw new Error('the budget storage key is not where it was.');
  script = script.replace(key, 'const BKEY="pcp-budget-"+CID;');

  const seed = 'let BUD=(()=>{try{return JSON.parse(localStorage.getItem(BKEY)||"{}")}catch(e){return{}}})();';
  if (!script.includes(seed)) throw new Error('the budget initialiser is not where it was.');
  script = script.replace(seed, [
    '/* What the database holds is the budget; local storage is only the copy in',
    '   front of it, and is trusted only when the database has nothing yet. */',
    'let BUD=(()=>{',
    '  var held=(D.budget&&Object.keys(D.budget).length)?D.budget:null;',
    '  if(held)return JSON.parse(JSON.stringify(held));',
    '  try{return JSON.parse(localStorage.getItem(BKEY)||"{}")}catch(e){return{}}',
    '})();',
  ].join('\n'));

  const save = 'function bsave(){try{localStorage.setItem(BKEY,JSON.stringify(BUD))}catch(e){}}';
  if (!script.includes(save)) throw new Error('the budget save is not where it was.');
  script = script.replace(save, [
    'function bsave(){',
    '  try{localStorage.setItem(BKEY,JSON.stringify(BUD))}catch(e){}',
    '  /* Opened on its own there is nobody to tell, and the local copy is all',
    '     there is. Inside the portal the database is the record. */',
    '  if(parent!==window){',
    '    try{parent.postMessage({type:"pcp-budget-save",key:CID,months:M,budget:BUD},"*")}catch(e){}',
    '  }',
    '}',
  ].join('\n'));
}

// ---- patch 7: the monthly audit reads this client's years -------------
//
// This is the one screen the prototype wrote against A&F's own calendar:
//
//   const R=AU.res, ys=["2024","2025","2026"];
//   const ann=R["2026"][k]/7*12;
//   ... eur(AU.res["2025"].rev) ... eur(AU.ga25)
//
// Three years named as literals, an annualisation over exactly seven months,
// and a materiality note computed on FY2025. A client whose books start in 2023
// would have found the screen reading a year it does not have — R["2024"] is
// undefined and the screen dies — or, worse, quietly labelling its columns with
// somebody else's years.
//
// So the years come from the data: AU.years, AU.partial (months held in the
// last of them) and AU.basis (the year the materiality is computed on, which is
// the last COMPLETE one — a threshold set on part of a year's trading is too
// low, and every posting looks material).

{
  const swaps = [
    // The three columns, and the label on the part year.
    [
      'const R=AU.res, ys=["2024","2025","2026"];',
      'const R=AU.res, ys=AU.years;',
    ],
    [
      '${y}${y==="2026"?" (7m)":""}',
      '${y}${(y===ys[ys.length-1]&&AU.partial<12)?" ("+AU.partial+"m)":""}',
    ],
    [
      '<th class="num">2025 on 2024</th><th class="num">2026 annualised</th>',
      '<th class="num">${ys[1]} on ${ys[0]}</th><th class="num">${ys[ys.length-1]} annualised</th>',
    ],
    // Declared alongside v, so there is no `const` in front of it.
    [
      'ann=R["2026"][k]/7*12;',
      'ann=R[ys[ys.length-1]][k]/(AU.partial||12)*12;',
    ],
    // The gross margin movement, on the same two years as the column above it.
    [
      '${(R["2025"].gpp-R["2024"].gpp>0?"+":"")+(R["2025"].gpp-R["2024"].gpp).toFixed(1)} pts',
      '${(R[ys[1]].gpp-R[ys[0]].gpp>0?"+":"")+(R[ys[1]].gpp-R[ys[0]].gpp).toFixed(1)} pts',
    ],
    // The ratio tile, on the latest year against the one before it.
    [
      '["Margin movement",(R["2026"].gpp-R["2025"].gpp>0?"+":"")+(R["2026"].gpp-R["2025"].gpp).toFixed(1)+" pts","2026 to date against FY2025"]',
      '["Margin movement",(R[ys[ys.length-1]].gpp-R[ys[ys.length-2]].gpp>0?"+":"")+(R[ys[ys.length-1]].gpp-R[ys[ys.length-2]].gpp).toFixed(1)+" pts",ys[ys.length-1]+" against FY"+ys[ys.length-2]]',
    ],
    // The materiality note, on the year it was actually computed on.
    [
      '"Computed on FY2025: revenue "+eur(AU.res["2025"].rev)+", profit before tax "+eur(AU.res["2025"].pbt)+", gross assets "+eur(AU.ga25)+". Change the benchmark to see the effect on the sample."',
      '"Computed on FY"+AU.basis+": revenue "+eur(AU.res[AU.basis].rev)+", profit before tax "+eur(AU.res[AU.basis].pbt)+", gross assets "+eur(AU.ga)+". Change the benchmark to see the effect on the sample."',
    ],
  ];
  for (const [from, to] of swaps) {
    if (!script.includes(from)) {
      throw new Error(`the audit screen has changed shape: ${from.slice(0, 48)}…`);
    }
    script = script.split(from).join(to);
  }

  // The journals note ends on a claim about A&F's own books — that the manual
  // journals are "substantially all quarterly VAT transfers". True of that
  // client and asserted about every other. The counted facts before it stay;
  // the claim goes.
  const claim = 'Read by value they are';
  const rest = 'The largest are listed below';
  const a = script.indexOf(claim);
  const b = script.indexOf(rest, a);
  if (a < 0 || b < 0) throw new Error('the journals note is not where it was.');
  script = script.slice(0, a) + script.slice(b);
}

// ---- patch 8: a sign-off is not browser storage -----------------------
//
// Two things are signed in this template: an exception on Needs attention, and
// a step on the monthly audit's working-paper programme. Both were kept in
// localStorage, and the working papers under one key for every client —
//
//   const WPKEY="pcp-wp-af";
//
// the same fault the budget had. Sign a step off against one client and it read
// signed against every other.
//
// A sign-off is somebody putting their name to work having been done. It cannot
// live in one person's browser: the reviewer is not the preparer, and neither of
// them is on the machine the other used. Both now seed from the payload and post
// every change to the host, which writes reporting.exception_signoff. Local
// storage stays as the immediate write so the screen still responds at once.

{
  const key = 'const WPKEY="pcp-wp-af";';
  if (!script.includes(key)) throw new Error('the working-paper key is not where it was.');
  script = script.replace(key, 'const WPKEY=()=>"pcp-wp-"+CID;');

  const load = 'function wpLoad(){try{return JSON.parse(localStorage.getItem(WPKEY)||"{}")}catch(e){return{}}}';
  if (!script.includes(load)) throw new Error('wpLoad is not where it was.');
  script = script.replace(load, [
    'function wpLoad(){',
    '  try{var raw=localStorage.getItem(WPKEY());if(raw)return JSON.parse(raw);}catch(e){}',
    '  /* Nothing on this machine: what the database holds is what was signed. */',
    '  var seed=(D.wp&&Object.keys(D.wp).length)?JSON.parse(JSON.stringify(D.wp)):{};',
    '  try{localStorage.setItem(WPKEY(),JSON.stringify(seed))}catch(e){}',
    '  return seed;',
    '}',
  ].join('\n'));

  const save = 'function wpSave(o){try{localStorage.setItem(WPKEY,JSON.stringify(o))}catch(e){}}';
  if (!script.includes(save)) throw new Error('wpSave is not where it was.');
  script = script.replace(save, [
    'function wpSave(o){',
    '  try{localStorage.setItem(WPKEY(),JSON.stringify(o))}catch(e){}',
    '  if(parent!==window){',
    '    try{parent.postMessage({type:"pcp-wp-save",key:CID,wp:o},"*")}catch(e){}',
    '  }',
    '}',
  ].join('\n'));

  const rload = 'function rload(){try{return JSON.parse(localStorage.getItem(RKEY())||"{}")}catch(e){return{}}}';
  if (!script.includes(rload)) throw new Error('rload is not where it was.');
  script = script.replace(rload, [
    'function rload(){',
    '  try{var raw=localStorage.getItem(RKEY());if(raw)return JSON.parse(raw);}catch(e){}',
    '  var seed=(D.review&&Object.keys(D.review).length)?JSON.parse(JSON.stringify(D.review)):{};',
    '  try{localStorage.setItem(RKEY(),JSON.stringify(seed))}catch(e){}',
    '  return seed;',
    '}',
  ].join('\n'));

  const rsave = 'function rsave(o){try{localStorage.setItem(RKEY(),JSON.stringify(o))}catch(e){}}';
  if (!script.includes(rsave)) throw new Error('rsave is not where it was.');
  script = script.replace(rsave, [
    'function rsave(o){',
    '  try{localStorage.setItem(RKEY(),JSON.stringify(o))}catch(e){}',
    '  if(parent!==window){',
    '    try{parent.postMessage({type:"pcp-review-save",key:CID,review:o},"*")}catch(e){}',
    '  }',
    '}',
  ].join('\n'));
}

// ---- patch 9: the folder, against what has been read ------------------
//
// The partner's words: the app "looks in that folder for changes or updates".
// The folder is the record of what was received and the ledger is what has been
// read; this puts the difference between the two at the top of the Data import
// screen, where the person is already looking to see what is loaded.
//
// The comparison is by sha256 and is done when the client is opened
// (folderDiff.ts). Only the counts and the list come across; the button hands
// the work back to the host, which owns the importers.
//
// Nothing is imported without being asked for. A file appearing in the folder
// is not consent to read it — somebody filed it, and somebody decides it goes
// into the ledger.

{
  // Anchored on DATAAGE, which only the feed table sets. `h+="</tbody></table>";`
  // on its own closes six other tables, and the first of them is the profit and
  // loss — this block landed on it once already.
  const anchor = 'h+="</tbody></table>";\n  DATAAGE=';
  if (!script.includes(anchor)) throw new Error('the feed table close is not where it was.');

  const block = [
    'h+="</tbody></table>";',
    '{var FD=D.folder||{items:[],fresh:0,changed:0,loaded:0,evidence:0};',
    ' var pend=(FD.items||[]).filter(function(x){return x.state!=="loaded"});',
    ' var g="";',
    ' if(pend.length){',
    '   g+=\'<div class="note" style="border-color:var(--warn)">\';',
    '   g+="<b>In the folder, not yet read into the ledger</b>";',
    '   g+="These files are in the client\'s BTMS folder and have not been imported. ";',
    '   g+="The comparison is by content, not by name \\u2014 so a file re-exported after a ";',
    '   g+="correction reads as changed even though its name and period did not.";',
    '   g+=\'<table style="margin-top:8px"><thead><tr><th>File</th><th>Period</th><th>State</th></tr></thead><tbody>\';',
    '   pend.forEach(function(x){',
    '     g+="<tr><td><b>"+x.label+"</b>"+',
    '        (x.original&&x.original!==x.label',
    '          ? \'<div style="font-size:.82em;color:var(--ink-3)">\'+x.original+"</div>" : "")+"</td>"+',
    '        "<td>"+(x.periodLabel||"\\u2014")+"</td>"+',
    '        \'<td><span class="chip \'+(x.state==="new"?"s-med":"s-high")+\'">\'+x.state+"</span></td></tr>";});',
    '   g+="</tbody></table>";',
    '   g+=\'<p style="margin:10px 0 0"><button class="sgn" id="pcpReadFolder">Read the new and changed files</button>\';',
    '   g+=\' <span id="pcpFolderMsg" style="margin-left:8px"></span></p>\';',
    '   g+="</div>";',
    ' } else if(FD.loaded){',
    '   g+=\'<div class="note"><b>The folder is fully read</b>All \'+FD.loaded+" file"+(FD.loaded===1?"":"s")+',
    '      " in this client\'s BTMS folder "+(FD.loaded===1?"has":"have")+" been imported"+',
    '      (FD.evidence?", and "+FD.evidence+" more "+(FD.evidence===1?"is":"are")+" kept for the review.":".")+"</div>";',
    ' }',
    ' h=g+h;}',
    '  DATAAGE=',
  ].join('\n');
  script = script.replace(anchor, block);

  // The kind's name used to be looked up here, from a copy of the list. It is
  // not any more: folderDiff sends the label already made, so the panel, the
  // portal's document cards and the backfilled file names all read the same
  // words because they are all made in the same place.

  // One button, handed straight back to the host.
  const handler = [
    '',
    '{var RF=document.getElementById("pcpReadFolder");',
    ' if(RF&&parent!==window)RF.addEventListener("click",function(){',
    '   RF.disabled=true;RF.textContent="Reading\\u2026";',
    '   parent.postMessage({type:"pcp-read-folder",key:CID},"*");});}',
  ].join('\n');
  const after = "document.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click',function(){";
  const at = script.indexOf(after);
  if (at < 0) throw new Error('the Upload handler is not where it was.');
  script = script.slice(0, at) + handler.trimStart() + '\n' + script.slice(at);
}

// ---- patch 10: the folder read says what it did -----------------------
//
// The template's only listener for progress from the host lives inside ask(),
// which runs at sign-in and removes it again the moment the client arrives. So
// everything the host said during a folder read after sign-in was posted into a
// window that had stopped listening: the button sat on "Reading…" for ever and
// the outcome never appeared.
//
// This listener is added once, at load, and stays. It belongs to the folder
// panel and touches nothing else.

script += `

/* ---------- appended by tools/build-reporting-app.mjs ---------- */
(function(){
  if (parent === window) return;
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.key !== CID) return;
    var btn = document.getElementById('pcpReadFolder');
    var msg = document.getElementById('pcpFolderMsg');
    if (d.type === 'pcp-progress') {
      if (msg) msg.textContent = d.text || '';
      return;
    }
    if (d.type !== 'pcp-folder-done') return;
    if (btn) { btn.disabled = false; btn.textContent = 'Read the new and changed files'; }
    if (msg) {
      msg.textContent = d.text || '';
      msg.style.color = d.ok ? 'var(--good)' : 'var(--crit)';
    }
    // What was read is in the ledger now, so the panel above is out of date.
    // Saying so is honest; redrawing it from a payload built before the read
    // would show the same files still waiting.
    if (d.ok && msg) msg.textContent = (d.text || '') + ' Sign in again to see them in the report.';
  });
})();
`;

// ---- patch 11: numbers with decimals print two full stops -------------
//
// The template formats money as
//
//   toLocaleString("en-GB", {minimumFractionDigits:dp}).replace(/,/g,".")
//
// en-GB gives 516,283.99 and the replace turns every comma into a full stop —
// so the thousands separator is converted and the decimal point never is, and
// the figure reads 516.283.99. Whole numbers happen to come out right, which is
// why it survived: 1,820 becomes 1.820, which is what the practice writes.
//
// The bug is in the method, not in one call. Rather than patch a separator,
// format in a locale that writes numbers the way the practice does. de-DE gives
// 516.283,99 and 1.820 directly, and there is nothing left to replace.
//
// DATES ARE NOT TOUCHED. new Date().toLocaleString("en-GB") is a timestamp and
// toLocaleDateString("en-GB") is a date; both stay as they are, and neither
// carries the .replace that identifies a number here.

{
  const money = 'toLocaleString("en-GB",{minimumFractionDigits:dp,maximumFractionDigits:dp}).replace(/,/g,".")';
  if (!script.includes(money)) throw new Error('eur() is not where it was.');
  script = script.split(money).join('toLocaleString("de-DE",{minimumFractionDigits:dp,maximumFractionDigits:dp})');

  // The counts. Integers, so the old way happened to be right — but leaving two
  // number formats in one application is how the next decimal bug gets written.
  const count = 'toLocaleString("en-GB").replace(/,/g,".")';
  const before = script.split(count).length - 1;
  if (before < 10) throw new Error(`expected the counts to be formatted the old way, found ${before}.`);
  script = script.split(count).join('toLocaleString("de-DE")');

  if (script.includes('replace(/,/g,".")')) {
    throw new Error('a number is still being formatted by replacing its commas.');
  }
}

// ---- patch 12: the Client setup switches are a decision ---------------
//
// The ON/OFF column read back what the payload builder had worked out from the
// data. It has to be the other way round: the person decides which sections a
// client gets, when the client is set up and before a single file is imported,
// and the data never argues with them afterwards.
//
// So the chip becomes a button. Pressing it tells the host, which writes
// reporting.client_settings.section_overrides; the section appears or
// disappears at once rather than after a rebuild, because a switch that takes
// effect later is a switch nobody trusts.
//
// The optimistic update is deliberate and safe: if the write fails the host
// says so in the notice strip, and the next sign-in reads the stored value —
// which is the truth — rather than this one.

{
  const chip = 'h+=`<tr><td><b>${n}</b></td><td>${d}</td><td class="num">'
    + '<span class="chip" style="color:${v?"var(--good)":"var(--ink-3)"}">${v?"on":"off"}</span></td></tr>`;});';
  if (!script.includes(chip)) throw new Error('the Client setup switches are not where they were.');
  script = script.replace(chip, [
    'h+=`<tr><td><b>${n}</b></td><td>${d}</td><td class="num">'
      + '<button class="sgn" data-feat="${k}" style="color:${v?"var(--good)":"var(--ink-3)"}">'
      + '${v?"on":"off"}</button></td></tr>`;});',
  ].join(''));

  // Wired after the table is written, as the feed table's buttons are.
  const close = "document.getElementById('tblSetup').innerHTML=h;";
  if (!script.includes(close)) throw new Error('the Client setup table close is not where it was.');
  script = script.replace(close, close + [
    '',
    "  document.querySelectorAll('[data-feat]').forEach(function(b){",
    "    b.addEventListener('click',function(){",
    '      var k=this.dataset.feat, now=!D.cfg.features[k];',
    '      if(parent===window){alert("Setting sections works inside the portal.");return;}',
    '      D.cfg.features[k]=now?1:0;',
    '      applyFeatures();',
    '      renderSetup();',
    '      parent.postMessage({type:"pcp-feature",key:CID,feature:k,on:now},"*");',
    '    });',
    '  });',
  ].join('\n'));
}

// ---- patch 13: VAT — three figures for every box ----------------------
//
// The screen compared two: what this application rebuilds from the journal, and
// what was filed. BTMS's own computation was missing, because nothing read the
// VAT figures summary — it was stored and never opened, and the row sat at
// OUTSTANDING as though the upload had failed.
//
// There are three, and the point of the screen is that they are three. On A&F
// Q2 2026 the rebuild gives box 4 of 64.100,43 against BTMS's 64.914,16 — which
// is exactly what was filed. Without the middle column the 813,73 looks like an
// argument between this application and the tax office; with it, the ledger is
// the odd one out and the question becomes what the journal is missing.

{
  const found = 'const C=QS.find(x=>x.q===q), FI=(D.vatFiled||[]).find(x=>x.q===q);';
  if (!script.includes(found)) throw new Error('the VAT quarter lookup is not where it was.');
  script = script.replace(found,
    found + '\n  const BT=(D.vatBtms||[]).find(x=>x.q===q);');

  const head = '`<table><thead><tr><th>Box</th><th>What it holds</th><th class="num">Computed from the ledger</th>`+';
  if (!script.includes(head)) throw new Error('the VAT box header is not where it was.');
  script = script.replace(head, head
    + '\n    (BT?`<th class="num">BTMS computed</th><th class="num">Ledger vs BTMS</th>`:"")+');

  const cell = 'let cells=`<td class="num"><b>${eur(cv,2)}</b></td>`;';
  if (!script.includes(cell)) throw new Error('the VAT box cell is not where it was.');
  script = script.replace(cell, cell + [
    '',
    '    if(BT){const bv=BT[k],db=cv-bv,okb=Math.abs(db)<0.005;',
    '      cells+=`<td class="num">${eur(bv,2)}</td>`+',
    '        `<td class="num"${okb?"":\' style="color:var(--crit)"\'}>${okb?"\\u2014":eur(db,2)}</td>`;}',
  ].join('\n'));
}

// ---- patch 14: attaching the filed return does something --------------
//
// vatAttachTo took a file, wrote its NAME into browser storage, and said the
// figures would be read "on the next import run — reading a newly attached file
// is build phase P1". So the return was never anywhere, and the comparison
// against it could never happen.
//
// It now asks the host, which takes the file and the five boxes together. The
// boxes are keyed rather than parsed because a filed return is usually the PDF
// the tax office gave back, and there is nothing in it this application can
// read — the file is the evidence for what was keyed, not the source of it.

{
  const open = 'function vatAttachTo(q){';
  const shut = '\n  inp.click();\n}';
  const a = script.indexOf(open);
  const b = script.indexOf(shut, a);
  if (a < 0 || b < 0) throw new Error('vatAttachTo is not where it was.');
  script = script.slice(0, a) + [
    'function vatAttachTo(q){',
    '  if(parent===window){alert("Attaching a return works inside the portal.");return;}',
    '  parent.postMessage({type:"pcp-vat-filed",key:CID,q:q},"*");',
    '}',
  ].join('\n') + script.slice(b + shut.length);
}

// ---- patch 15: a stored file is not outstanding -----------------------
//
// A feed held for the review rather than read showed OUTSTANDING once its file
// had been loaded, which reads as a failed import. It gets its own state.

{
  const chip = '`<td><span class="chip" style="color:${got?(late?"var(--warn)":"var(--good)"):"var(--warn)"}">'
    + '${got?(late?"overdue":"loaded"):"outstanding"}</span></td>`';
  if (!script.includes(chip)) throw new Error('the feed status chip is not where it was.');
  script = script.replace(chip,
    '`<td><span class="chip" style="color:${got?(read===0?"var(--ink-3)":(late?"var(--warn)":"var(--good)")):"var(--warn)"}">'
    + '${got?(read===0?"stored":(late?"overdue":"loaded")):"outstanding"}</span></td>`');

  // The eighth column of a feed row says whether the app reads it at all.
  const loop = '(D.feeds&&D.feeds.length?D.feeds:FEEDS).forEach(([n,why,fr,file,when,covers,got])=>{';
  if (!script.includes(loop)) throw new Error('the feed loop is not where it was.');
  script = script.replace(loop,
    '(D.feeds&&D.feeds.length?D.feeds:FEEDS).forEach(([n,why,fr,file,when,covers,got,read])=>{');
}

// ---- patch 16: the coverage grid is this client's, and asks only what it needs
//
// renderCov ticked months from literals:
//
//   ["Trial balance, monthly", m => m === "2026-07"]
//   ["Stock valuation", m => ["2024-12","2025-12","2026-01", … ].includes(m)]
//
// A&F's own coverage, shown under every client's name — the same leak as the
// hardcoded feed table, and the same fix: read what THIS client has loaded.
//
// And it asked for everything of everything. A closed year showed Trial balance
// monthly 0/12 in a wall of dashes, when the annual trial balance is all that is
// wanted for a closed year and the row beneath already said it was loaded. A
// grid of blanks reads as failure; a grid should ask for what is actually due.
//
// So: a feed appears only if that section is on for this client, the monthly
// trial balance is not asked for in a year whose annual one is in, and the
// legend says what a blank means rather than leaving it to be guessed.

{
  const open = 'function renderCov(){';
  const shut = "\n  document.getElementById('tblCov').innerHTML=h;\n}";
  const a = script.indexOf(open);
  const b = script.indexOf(shut, a);
  if (a < 0 || b < 0) throw new Error('renderCov is not where it was.');

  script = script.slice(0, a) + [
    'function renderCov(){',
    '  var CV=D.coverage||{}, F=D.cfg.features||{};',
    '  var has=function(k,m){return (CV[k]||[]).indexOf(m)>=0;};',
    '  /* Only what this client is actually expected to file. */',
    '  var feeds=[["Analytical journal listing","ledger",true]];',
    '  feeds.push(["Trial balance, monthly","trial_balance_monthly",true]);',
    '  if(F.stock)   feeds.push(["Stock valuation","stock",true]);',
    '  if(F.vat)     feeds.push(["VAT figures summary","vat_summary",false]);',
    '  if(F.payroll) feeds.push(["Payroll","payroll",true]);',
    '  var yrs=[...new Set(M.map(function(m){return m.slice(0,4)}))];',
    '  var h=`<table><thead><tr><th>Feed</th>${MN.map(function(x){return `<th class="num">${x}</th>`}).join("")}<th class="num">Done</th></tr></thead><tbody>`;',
    '  yrs.forEach(function(y){',
    '    var closed=(CV.trial_balance_annual||[]).some(function(p){return p.slice(0,4)===y});',
    '    h+=`<tr class="sec"><td colspan="14">${y}${closed?" \\u2014 closed":""}</td></tr>`;',
    '    feeds.forEach(function(fd){',
    '      var n=fd[0], key=fd[1], monthly=fd[2];',
    '      /* A closed year wants its annual trial balance and not twelve monthly',
    '         ones. Asking anyway is what produced the wall of dashes. */',
    '      if(key==="trial_balance_monthly"&&closed){',
    '        h+=`<tr><td>${n}</td><td colspan="12" style="color:var(--ink-3)">Not wanted for a closed year \\u2014 the annual trial balance below proves it.</td><td class="num mono">n/a</td></tr>`;',
    '        return;}',
    '      var got=0,due=0;',
    '      var cells=MN.map(function(_,k){',
    '        var m=y+"-"+String(k+1).padStart(2,"0");',
    '        if(idx(m)<0)return `<td class="num"><span class="cell c-miss">\\u00b7</span></td>`;',
    '        /* A quarterly feed is due in the month its quarter ends, not every month. */',
    '        if(!monthly&&(k+1)%3!==0)return `<td class="num"><span class="cell c-miss">\\u00b7</span></td>`;',
    '        due++;',
    '        var ok=key==="vat_summary"?has(key,y+" Q"+Math.ceil((k+1)/3)):has(key,m);',
    '        if(ok)got++;',
    '        return `<td class="num"><span class="cell ${ok?"c-ok":"c-miss"}">${ok?"\\u2713":"\\u2014"}</span></td>`});',
    '      h+=`<tr><td>${n}</td>`+cells.join("")+`<td class="num mono">${got}/${due}</td></tr>`;});',
    '    h+=`<tr><td>Chart of accounts</td><td colspan="12" style="color:var(--ink-3)">Loaded once and re-imported only when the client adds an account &#8212; not a monthly feed.</td><td class="num mono">n/a</td></tr>`;',
    '    h+=`<tr><td>Trial balance, annual</td><td colspan="12" style="color:var(--ink-3)">${closed?"Loaded for the closed year.":"Not due until the year is closed."}</td><td class="num mono">${closed?"1/1":"n/a"}</td></tr>`;',
    '  });',
    '  h+="</tbody></table>";',
    '  h+=`<p class="cap" style="margin-top:8px">A dash is a month this client is expected to file and has not; a dot is a month outside the ledger, or one the feed is not due in. Only the feeds switched on for this client are asked for.</p>`;',
    "  document.getElementById('tblCov').innerHTML=h;",
    '}',
  ].join('\n') + script.slice(b + shut.length);
}

// ---- patch 17: the reconciliation leads with the point ----------------
//
// "The journal balances on its own" is a result, not an explanation, and the
// instruction under it — "Import the BTMS trial balance for the period" — was a
// sentence asking a person to go and find the right screen.
//
// It is the completeness control and the reason a month can be signed off: the
// journal balancing proves it is internally consistent, and only agreeing it to
// the trial balance BTMS produced for the same period proves nothing is
// missing. Lead with that, then make it act.

{
  const note = '`<b>No trial balance for this period</b>The journal balances on its own, which proves it is internally consistent \\u2014 but not that it is complete. Import the BTMS trial balance for the period to prove nothing is missing.`';
  if (!script.includes(note)) throw new Error('the reconciliation note is not where it was.');
  script = script.replace(note, [
    '`<b>Nothing here proves the month is complete yet</b>`+',
    '`The journal balances on its own, which proves it is internally consistent \\u2014 that every `+',
    '`posting has its contra. It cannot prove nothing is MISSING: a month that never reached `+',
    '`this app balances just as well as one that did. Only the trial balance BTMS produced for `+',
    '`the same period can settle that.`+',
    '(parent!==window?`<p style="margin:10px 0 0"><button class="sgn" id="rcGetTb">Import the BTMS trial balance for ${lbl(M[b])}</button></p>`:"")',
  ].join('\n      '));

  // Wired after the note is written, with the feed and the period already known.
  const set = "  const n=document.getElementById('rcNote');";
  if (!script.includes(set)) throw new Error('the reconciliation note element is not where it was.');
  script = script.replace(
    "}\n\n/* ---------- sales analysis ---------- */",
    [
      '  {var gb=document.getElementById("rcGetTb");',
      '   if(gb)gb.addEventListener("click",function(){',
      '     parent.postMessage({type:"pcp-upload",feed:"Trial balance, monthly",key:CID,period:M[b]},"*");});}',
      '}',
      '',
      '/* ---------- sales analysis ---------- */',
    ].join('\n'));
}

// ---- patch 18: the period controls ------------------------------------
//
// Two dropdowns that argued with each other. REPORTING PERIOD offered Quarter
// and PERIOD ENDING offered any month, so Quarter with a period ending of Jul 26
// produced a quarter ending in July — three months that are not one of the
// client's quarters and never were. The screen also opened on Jul 26 with the
// ledger running to Aug 26, and said nothing about why.
//
// Four changes, as REVIEW-2 §1d sets them out:
//
//   * one row of buttons, and the month picker only where it is needed;
//   * Quarter snaps to the client's own quarters, from vat_quarter_offset —
//     the same cycle the VAT return is filed on, because a quarter that is not
//     one of the client's quarters is not a period they have ever reported;
//   * the resolved range is always printed in full, with the comparative it is
//     measured against beside it;
//   * it opens on the latest COMPLETE month and says that is what it did.
//
// This is one control shared by most screens, so the old modes are kept as the
// state underneath — the buttons set them, and periodRange still answers.

{
  const open = 'function periodCtl(id,host,onchange,opts){';
  const shut = '\n}\nfunction periodRange(id){';
  const a = script.indexOf(open);
  const b = script.indexOf(shut, a);
  if (a < 0 || b < 0) throw new Error('periodCtl is not where it was.');

  script = script.slice(0, a) + [
    '/* FIX-3 1e — the months offered run to the end of the year even where the',
    '   ledger stops, so the partner can look at December and at what it would take',
    '   to get there. Selecting one is never refused; what it resolves to is clamped',
    '   to what is posted, and the line underneath says which months are missing. */',
    'function monthChoices(){',
    '  var out=M.slice(), last=M[NM-1], y=+last.slice(0,4);',
    '  for(var n=+last.slice(5,7)+1;n<=12;n++) out.push(y+"-"+String(n).padStart(2,"0"));',
    '  return out;',
    '}',
    '/* The latest posted month at or before this one. A month beyond the ledger',
    '   resolves to the last one that has figures rather than to nothing. */',
    'function clampIdx(m){',
    '  if(M.indexOf(m)>=0)return M.indexOf(m);',
    '  for(var i=NM-1;i>=0;i--) if(M[i]<=m) return i;',
    '  return 0;',
    '}',
    '/* Months chosen but not posted, as the partner would say them. */',
    'function gapNote(to){',
    '  var last=M[NM-1];',
    '  if(!(to>last))return "";',
    '  var a=M.slice(-1)[0], y=+a.slice(0,4), n=+a.slice(5,7)+1;',
    '  var from=y+"-"+String(n).padStart(2,"0");',
    '  return lbl(from)+" to "+lbl(to)+" not yet posted";',
    '}',
    '','/* The last month that has actually ended. The ledger can hold the month in',
    '   progress, and opening a report on a part month invites a comparison',
    '   nobody meant to make. */',
    'function latestComplete(){',
    '  var now=new Date(), cur=now.getUTCFullYear()+"-"+String(now.getUTCMonth()+1).padStart(2,"0");',
    '  for(var i=NM-1;i>=0;i--) if(M[i]<cur) return M[i];',
    '  return M[NM-1];',
    '}',
    'const MFULL=["January","February","March","April","May","June","July",',
    '  "August","September","October","November","December"];',
    'function firstDay(m){return "1 "+MFULL[+m.slice(5,7)-1]+" "+m.slice(0,4);}',
    'function lastDay(m){var y=+m.slice(0,4),n=+m.slice(5,7);',
    '  return new Date(Date.UTC(y,n,0)).getUTCDate()+" "+MFULL[n-1]+" "+y;}',
    'function fullRange(a,b){return firstDay(M[a])+" to "+lastDay(M[b]);}',
    '',
    "/* The client's own quarter ends. Offset 0 is Mar/Jun/Sep/Dec; 1 is",
    '   Jan/Apr/Jul/Oct; 2 is Feb/May/Aug/Nov — the same rule migration 201 uses',
    '   to decide which quarter a posting falls in. */',
    'function quarterEnds(){',
    '  var o=(D.cfg&&D.cfg.vatOffset)||0;',
    '  return o===0?[3,6,9,12]:[o,o+3,o+6,o+9];',
    '}',
    '/* The quarter the anchor month belongs to, as [startMonthIndex,endIndex]. */',
    'function quarterOf(bi){',
    '  var ends=quarterEnds(), y=+M[bi].slice(0,4), m=+M[bi].slice(5,7), e=null, ey=y;',
    '  for(var i=0;i<ends.length;i++) if(ends[i]>=m){e=ends[i];break;}',
    '  if(e===null){e=ends[0];ey=y+1;}',
    '  var end=new Date(Date.UTC(ey,e-1,1)), start=new Date(Date.UTC(ey,e-3,1));',
    '  var key=function(d){return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");};',
    '  var si=M.indexOf(key(start)), ei=M.indexOf(key(end));',
    '  /* A quarter can run past what is loaded, or start before it. Clip to the',
    '     ledger and let the printed range say what was actually covered. */',
    '  if(si<0)si=0; if(ei<0)ei=NM-1;',
    '  return [Math.min(si,ei),Math.max(si,ei)];',
    '}',
    '',
    'function periodCtl(id,host,onchange,opts){',
    '  opts=opts||{};',
    '  var st=PER[id]||(PER[id]={mode:opts.mode||(opts.asAt?"month":"ytd"),',
    '    from:M[0],to:latestComplete(),pick:opts.asAt?null:"this"});',
    '  if(M.indexOf(st.from)<0)st.from=M[0];',
    '  if(M.indexOf(st.to)<0)st.to=latestComplete();',
    '  /* This month and Last month resolve their anchor on every render, so they',
    '     stay right as new months arrive rather than sticking where they were. */',
    '  if(st.pick==="this")st.to=latestComplete();',
    '  if(st.pick==="last")st.to=M[Math.max(0,M.indexOf(latestComplete())-1)];',
    '  var el=document.getElementById(host); if(!el)return;',
    '  var btns=opts.asAt',
    '    ?[["Month end","month",null],["Year end","yearend",null]]',
    '    :[["This month","month","this"],["Last month","month","last"],',
    '      ["Quarter","quarter",null],["Year to date","ytd",null],',
    '      ["Full year","year",null],["Custom","range",null]];',
    '  var needsMonth=st.mode!=="range"&&!(st.mode==="month"&&st.pick);',
    '  var h=\'<div class="perbtns">\'+btns.map(function(x,i){',
    '    var on=st.mode===x[1]&&(st.pick||null)===x[2];',
    '    return \'<button class="perbtn\'+(on?" on":"")+\'" data-i="\'+i+\'">\'+x[0]+"</button>";',
    '  }).join("")+"</div>";',
    '  if(st.mode==="range"){',
    '    h+=\'<span><label class="ctl">From</label><select data-k="from">\'+',
    '      M.map(function(m){return \'<option value="\'+m+\'"\'+(st.from===m?" selected":"")+">"+lbl(m)+"</option>"}).join("")+',
    '      \'</select></span><span><label class="ctl">To</label><select data-k="to">\'+',
    '      monthChoices().map(function(m){return \'<option value="\'+m+\'"\'+(st.to===m?" selected":"")+">"+lbl(m)+"</option>"}).join("")+',
    '      "</select></span>";',
    '  } else if(needsMonth){',
    '    h+=\'<span><label class="ctl">\'+(opts.asAt?"At":"Ending")+\'</label><select data-k="to">\'+',
    '      monthChoices().map(function(m){return \'<option value="\'+m+\'"\'+(st.to===m?" selected":"")+">"+lbl(m)+"</option>"}).join("")+',
    '      "</select></span>";',
    '  }',
    '  h+=\'<div class="perwhat" data-r="desc"></div>\';',
    '  el.innerHTML=h;',
    '  el.querySelectorAll(".perbtn").forEach(function(bt){',
    '    bt.addEventListener("click",function(){',
    '      var x=btns[+bt.dataset.i];',
    '      st.mode=x[1]; st.pick=x[2];',
    '      periodCtl(id,host,onchange,opts); onchange();});});',
    '  el.querySelectorAll("select").forEach(function(sel){',
    '    sel.addEventListener("change",function(e){',
    '      st[e.target.dataset.k]=e.target.value;',
    '      /* Choosing a month by hand is no longer "this month". */',
    '      if(e.target.dataset.k==="to")st.pick=null;',
    '      if(st.mode==="range"&&M.indexOf(st.from)>M.indexOf(st.to))st.from=st.to;',
    '      periodCtl(id,host,onchange,opts); onchange();});});',
    '  /* Say what the buttons resolved to, in full, and what it is measured',
    '     against. The old control printed "Jan 26 to Jul 26" and left the rest to',
    '     be inferred. */',
    '  var r=periodRange(id), pr=priorRange(id);',
    '  /* FIX-3 1c: the resolved range is the most important fact on the',
    '     screen and it was grey small print. It is the headline now. */',
    '  var main=opts.asAt?("At "+lastDay(M[r[1]])):fullRange(r[0],r[1]);',
    '  var side=[];',
    '  if(!opts.asAt)side.push(pr?("against "+fullRange(pr[0],pr[1])):"no comparative loaded");',
    '  if(st.mode==="quarter")side.push("the client\\u2019s own quarter");',
    '  /* FIX-3 1d: say WHY it opened where it did, not merely that it did. */',
    '  if(st.pick==="this"){',
    '    var lc=latestComplete();',
    '    side.push(M[NM-1]>lc',
    '      ? MFULL[+M[NM-1].slice(5,7)-1]+" is not closed \\u2014 showing "+MFULL[+lc.slice(5,7)-1]',
    '      : "the latest complete month");}',
    '  var gap=gapNote(st.to);',
    '  if(gap)side.push(gap);',
    '  var dsc=el.querySelector(\'[data-r="desc"]\');',
    '  dsc.innerHTML=\'<span class="perrange">\'+main+"</span>"+',
    '    (side.length?\'<span class="perside">\'+side.join(" \\u00b7 ")+"</span>":"");',
    '}',
  ].join('\n') + script.slice(b + 2);   // keep "function periodRange(id){"

  // A month past the ledger is a legal choice now (1e), so the anchor is
  // clamped to what is posted rather than looked up and found missing.
  const anchor2 = 'const st=PER[id]; const b=M.indexOf(st.to); const y=M[b].slice(0,4);';
  if (!script.includes(anchor2)) throw new Error('periodRange anchor is not where it was.');
  script = script.replace(anchor2,
    'const st=PER[id]; const b=clampIdx(st.to); const y=(st.to||M[b]).slice(0,4);');

  // Quarter no longer means "the calendar quarter the anchor happens to sit in".
  const q = 'if(st.mode==="quarter"){const q=Math.floor((+M[b].slice(5,7)-1)/3)*3+1;\n    const s=M.indexOf(y+"-"+String(q).padStart(2,"0")); return [s<0?b:s,b];}';
  if (!script.includes(q)) throw new Error('the quarter branch is not where it was.');
  script = script.replace(q, 'if(st.mode==="quarter") return quarterOf(b);');
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

  // Something was imported, so what is on screen predates it. The report
  // refreshes itself rather than asking a person to know when to press a
  // button — which is what the Rebuild button was, and why it is gone.
  //
  // Registered before the sign-in guard below, which returns early when the
  // sign-in elements are missing. A refresh has nothing to do with signing in.
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.type !== 'pcp-refresh' || d.key !== CID) return;
    ask(CID).then(function(block){
      if (!block) return;
      ALL.clients[CID] = block;
      bindClient();
      // Redraw whatever the person is looking at, and nothing else.
      var sel = document.querySelector('nav.tabs button[aria-selected="true"]');
      applyFeatures();
      if (sel && RENDER[sel.dataset.v]) RENDER[sel.dataset.v]();
      setStatus();
    }).catch(function(){ /* the host has already said so in its own strip */ });
  });

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

// ---- the stylesheet patch --------------------------------------------
//
// Everything above rewrites the template's SCRIPT. This is the one thing that
// rewrites its LOOK, and it is a different kind of change: the screens are the
// specification, and their design moves when the partner moves the prototype.
// These are here because he asked for them in REVIEW-2 and the prototype is not
// mine to redraw — so they are appended as overrides rather than edited into
// his rules, and dropping this block puts the template back exactly as it was.
//
// Appended last so they win on equal specificity without !important.

const STYLE_PATCH = `
/* ---------- appended by tools/build-reporting-app.mjs ---------- */

/* REVIEW-2 1a and 2a — use the width. The page was boxed at 1280px, which left
   a wide empty margin down the right on any ordinary screen, on the two screens
   where horizontal room matters most: the management summary has the months
   across it and the overview has the charts. Prose is capped on its own so the
   lines stay readable at any window width. */
.wrap{max-width:1880px}
.sub,.cap,.note,#ovPeriodNote{max-width:96ch}

/* REVIEW-2 1b — sales by month is the important chart, so it gets the width
   rather than half of it. Gross margin follows underneath. The charts carry a
   viewBox and no fixed width, so they grow into whatever they are given. */
#v-overview .grid2{display:block}
#v-overview .grid2 > .card{margin-bottom:16px}

/* REVIEW-2 1d — the period control is a row of buttons and, where it needs
   one, a month. The resolved range is printed underneath in full, because
   "Jan 26 to Jul 26" left the rest to be inferred. */
.perbtns{display:flex;flex-wrap:wrap;gap:6px;margin-right:10px}
.perbtn{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--rule);
  background:var(--surface);color:var(--ink-2);border-radius:4px;cursor:pointer}
.perbtn:hover{border-color:var(--ink-3);color:var(--ink)}
.perbtn.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.perwhat{flex-basis:100%;font-size:12.5px;color:var(--ink-2);margin-top:6px}

/* REVIEW-2 3a — headings a step bigger and bolder. They sat close enough to the
   body text in size and weight that a long table read as one undifferentiated
   block. */
h2{font-size:1.6rem;font-weight:700}
h3{font-size:1.16rem;font-weight:700}

/* REVIEW-2 3b — one family and one size for everything that is data. The
   monospace face was carrying two jobs: a typographic one nobody asked for, and
   lining the digits up. Tabular figures do the second without a second font, so
   the face goes and the columns still line up. */
table, th, td, .mono, td.clr, .tile .k, .tile .v, tr.sec td, .note b, nav.tabs .grp{
  font-family:"Source Sans 3",system-ui,sans-serif;
}
table, .tile .v, .mono{font-variant-numeric:tabular-nums}
table{font-size:14px}
.mono, td.clr{font-size:14px}
/* A column heading is a label rather than data: it keeps its small uppercase
   treatment, in the one face, one step up in size now that it is not monospace. */
th{font-size:11px}
`;

// The slicing below uses offsets measured on `html`, so the stylesheet is
// patched AFTER the shell is assembled and never before. Inserting it into
// `html` first shifts every one of those offsets by its own length — and
// </style> sits before the afdata block, so the payload marker landed in the
// middle of a paragraph's style attribute and the afdata tag disappeared
// altogether. The shell still built, and still weighed about the right amount.
const assembled =
  head +
  html.slice(0, dataStart) +            // everything up to and including the afdata open tag
  '__PAYLOAD__' +
  html.slice(dataEnd, appOpen) +        // </script> and whatever sits between the two
  '<script src="__APP_JS__"></script>' +
  html.slice(appEnd + '</script>'.length);

if (!assembled.includes('</style>')) throw new Error('the template has no stylesheet to patch.');
const shell = assembled.replace('</style>', STYLE_PATCH + '</style>');

// Cheap proof that the assembly is intact, because the failure above was
// silent: the payload marker has to sit inside the afdata tag it replaces.
if (!/<script id="afdata" type="application\/json">__PAYLOAD__/.test(shell)) {
  throw new Error('the payload marker is not inside the afdata block — the shell is misassembled.');
}

writeFileSync(SHELL, shell, 'utf8');
writeFileSync(APP, script, 'utf8');

const kb = (n) => Math.round(n / 1024).toLocaleString('en-GB') + ' KB';
console.log(`reporting shell  ${kb(shell.length)}  ->  public/reporting-shell.html`);
console.log(`reporting app    ${kb(script.length)}  ->  public/reporting-app.js`);
