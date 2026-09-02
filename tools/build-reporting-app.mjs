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

// ---- patch 19: comparison columns are a list --------------------------
//
// FIX-3 §2. Shared machinery: four screens want it, and building it per screen
// is how the period control came to disagree with itself. Appended whole rather
// than spliced, because it is new code and not a rewrite of the template’s.

script += "\n/* ---------- comparison columns (FIX-3 §2) ---------- */\n/*\n * COMPARE WITH was one dropdown and one answer: last year, the preceding\n * period, or nothing. The partner wants a list — August 2026 beside December\n * 2025 AND December 2024, the current position against the last two audited\n * year ends, which is what a conversation with a client actually needs.\n *\n * So a screen holds a LIST of comparison columns and this resolves it. It is\n * built once here because four screens want it, and building it per screen is\n * how the period control came to disagree with itself.\n */\nconst CMP={};\nfunction cmpList(id){ if(!CMP[id])CMP[id]=[{kind:\"py\"}]; return CMP[id]; }\nfunction spanLbl(r){ return r[0]===r[1]?lbl(M[r[1]]):lbl(M[r[0]])+\"–\"+lbl(M[r[1]]); }\n\n/* Year ends first in the picker: they are the common case, and the reason the\n   list exists at all. Taken from the client's own year end, not December. */\nfunction yearEndMonths(){\n  var ye=(D.cfg&&D.cfg.yearEnd)||12, out=[];\n  for(var i=NM-1;i>=0;i--) if(+M[i].slice(5,7)===ye) out.push(M[i]);\n  return out;\n}\n\n/* One column, resolved against the period the screen is showing. */\nfunction cmpCols(id,opts){\n  opts=opts||{};\n  var r=periodRange(id), a=r[0], b=r[1], n=b-a+1;\n  return cmpList(id).map(function(c){\n    if(c.kind===\"budget\"){\n      /* Chosen deliberately and never a default (§2c). Where nothing is\n         keyed for the period the column says so, rather than showing a\n         column of noughts and calling the whole period a variance. */\n      return BUsum(BLINES(),a,b)===null\n        ?{label:\"Budget\",missing:\"none keyed for this period\"}\n        :{label:\"Budget\",budget:true,keyed:true};\n    }\n    if(c.kind===\"hand\"){\n      /* Only the profit and loss keys columns. Anywhere else says so,\n         rather than leaving a chip that quietly answers nothing. */\n      if(!opts.hand)return {label:c.name,missing:\"keyed columns are on the profit and loss\"};\n      var kc=keyFind(id,c.name);\n      return kc?{label:c.name,hand:true,keyed:true,col:kc}\n               :{label:c.name,missing:\"not keyed for this period\"};\n    }\n    if(c.kind===\"py\"){\n      var p=priorRange(id);\n      return p?{label:spanLbl(p),range:p}\n              :{label:\"Same period last year\",missing:\"not in the ledger\"};\n    }\n    if(c.kind===\"prev\"){\n      var pb=a-1, pa=pb-n+1;\n      return pa>=0?{label:spanLbl([pa,pb]),range:[pa,pb]}\n                  :{label:\"Preceding period\",missing:\"not enough history\"};\n    }\n    /* An \"at\" column ends where it says and runs the same length as the period\n       on screen, so a year-to-date sits against a year-to-date rather than\n       against a single month. A balance sheet is one month either way. */\n    var ei=clampIdx(c.to), si=opts.asAt?ei:Math.max(0,ei-n+1);\n    return {label:spanLbl([si,ei]),range:[si,ei]};\n  });\n}\n\n/* What a column is worth for a set of report lines. Null means it cannot be\n   answered — no ledger behind it, or no budget keyed — and null is printed as\n   such rather than as a nought, because a nought is a figure and this is not. */\nfunction cmpValue(col,ids,sum){\n  if(col.missing)return null;\n  if(col.budget){ var v=BUsum(ids,CMPA,CMPB); return v; }\n  return sum(ids,col.range[0],col.range[1]);\n}\nvar CMPA=0,CMPB=0;   /* the period on screen, for the budget column */\n\nfunction cmpCtl(id,host,onchange,opts){\n  opts=opts||{};\n  var el=document.getElementById(host); if(!el)return;\n  var list=cmpList(id), cols=cmpCols(id,opts);\n  var h='<label class=\"ctl\">Compare with</label><div class=\"cmpchips\">';\n  cols.forEach(function(c,k){\n    if(c.hand){\n      /* The name is an input because the partner names it — Target,\n         Discussed 3 Sep — and marked keyed because a figure somebody typed\n         must never be mistaken for one out of the ledger. */\n      h+='<span class=\"cmpchip hand\">'\n        +'<input class=\"cmpname\" data-k=\"'+k+'\" value=\"'+attrq(c.label)+'\" title=\"What to call this column\">'\n        +'<em>keyed by hand</em>'\n        +'<button class=\"cmpsave\" data-k=\"'+k+'\">Save</button>'\n        +(c.col.saved?'<button class=\"cmpforget\" data-k=\"'+k+'\">Forget</button>':'')\n        +'<button class=\"cmpx\" data-k=\"'+k+'\" title=\"Take this column off the screen\">\\u00d7</button></span>';\n      return;\n    }\n    h+='<span class=\"cmpchip'+(c.missing?\" bad\":\"\")+'\">'+c.label\n      +(c.keyed?' <em>keyed</em>':'')\n      +(c.missing?' <em>'+c.missing+'</em>':'')\n      +'<button class=\"cmpx\" data-k=\"'+k+'\" title=\"Remove this column\">×</button></span>';\n  });\n  if(!cols.length)h+='<span class=\"cmpnone\">no comparison</span>';\n  h+='</div>';\n\n  var ye=yearEndMonths(), rest=monthChoices().slice().reverse();\n  h+='<select class=\"cmpadd\"><option value=\"\">Add a column…</option>'\n    +'<option value=\"k:py\">Same period last year</option>'\n    +'<option value=\"k:prev\">Preceding period</option>'\n    +'<option value=\"k:budget\">Budget</option>';\n  if(opts.hand){\n    h+='<optgroup label=\"Keyed by hand\">'\n      +keyNames(id).map(function(n){return '<option value=\"h:'+attrq(n)+'\">'+n+'</option>'}).join(\"\")\n      +'<option value=\"h:\">A column I key myself\\u2026</option></optgroup>';\n  }\n  if(ye.length){\n    h+='<optgroup label=\"Year ends\">'\n      +ye.map(function(m){return '<option value=\"at:'+m+'\">'+lbl(m)+'</option>'}).join(\"\")\n      +'</optgroup>';\n  }\n  h+='<optgroup label=\"Any month end\">'\n    +rest.map(function(m){return '<option value=\"at:'+m+'\">'+lbl(m)+'</option>'}).join(\"\")\n    +'</optgroup></select>';\n  h+='<button class=\"perbtn cmpshape\" data-y=\"3\">3 years across</button>'\n    +'<button class=\"perbtn cmpshape\" data-y=\"5\">5 years across</button>';\n  el.innerHTML=h;\n\n  el.querySelectorAll(\".cmpx\").forEach(function(x){\n    x.addEventListener(\"click\",function(){\n      list.splice(+x.dataset.k,1); cmpCtl(id,host,onchange,opts); onchange();});});\n  el.querySelector(\".cmpadd\").addEventListener(\"change\",function(e){\n    var v=e.target.value; if(!v)return;\n    if(v.slice(0,2)===\"k:\")list.push({kind:v.slice(2)});\n    else if(v.slice(0,2)===\"h:\"){\n      var hn=v.slice(2);\n      list.push({kind:\"hand\",name:hn?hn:keyNew(id).name});\n    }\n    else list.push({kind:\"at\",to:v.slice(3)});\n    cmpCtl(id,host,onchange,opts); onchange();});\n  /* Three or five years across in one click: the same period end, that many\n     years back, so a line that has drifted upward reads as a trend rather than\n     as one number against last year. */\n  el.querySelectorAll(\".cmpshape\").forEach(function(bt){\n    bt.addEventListener(\"click\",function(){\n      var years=+bt.dataset.y, r=periodRange(id), end=M[r[1]], out=[];\n      for(var k=1;k<years;k++){\n        var y=+end.slice(0,4)-k, m=y+end.slice(4);\n        if(clampIdx(m)>=0&&M.indexOf(m)>=0)out.push({kind:\"at\",to:m});\n      }\n      CMP[id]=out; cmpCtl(id,host,onchange,opts); onchange();});});\n\n  /* Renaming a saved column marks it unsaved again: it is a NEW column when\n     it is next saved and the one already saved is left alone, which is what\n     \"more than one can be kept\" comes to in practice. */\n  el.querySelectorAll(\".cmpname\").forEach(function(x){\n    x.addEventListener(\"change\",function(){\n      var c=cols[+x.dataset.k], nm=x.value.trim();\n      if(!nm){x.value=c.label;return;}\n      list[+x.dataset.k].name=nm; c.col.name=nm; c.col.saved=false;\n      cmpCtl(id,host,onchange,opts); onchange();});});\n  el.querySelectorAll(\".cmpsave\").forEach(function(b){\n    b.addEventListener(\"click\",function(){\n      var c=cols[+b.dataset.k];\n      if(parent===window){alert(\"Saving a keyed column works inside the portal.\");return;}\n      try{parent.postMessage({type:\"pcp-keyed-save\",key:CID,from:c.col.from,to:c.col.to,\n        name:c.col.name,amounts:c.col.amounts},\"*\");}catch(e){}\n      c.col.saved=true; cmpCtl(id,host,onchange,opts);});});\n  /* Two presses. The x takes the column off the screen and keeps it; this\n     one destroys it, and a meeting is not worth losing to a stray click. */\n  el.querySelectorAll(\".cmpforget\").forEach(function(b){\n    b.addEventListener(\"click\",function(){\n      if(b.dataset.armed!==\"1\"){b.dataset.armed=\"1\";b.textContent=\"Really forget?\";return;}\n      var c=cols[+b.dataset.k], st=keyStore(), i=st.indexOf(c.col);\n      if(parent!==window){try{parent.postMessage({type:\"pcp-keyed-delete\",key:CID,\n        from:c.col.from,to:c.col.to,name:c.col.name},\"*\");}catch(e){}}\n      if(i>=0)st.splice(i,1);\n      list.splice(+b.dataset.k,1);\n      cmpCtl(id,host,onchange,opts); onchange();});});\n}\n";

// ---- patch 26: a ratios screen (FIX-3 §6) ----
//
// A whole screen, appended rather than woven in, so that deleting this one
// block takes the feature away and leaves everything else standing. It reads
// the balance sheet exactly as renderBs does — same subtotal rule, same
// treatment of B-650 and B-640 — because a ratio that disagrees with the
// statement it is drawn from is worse than no ratio.
{
  for (const [what, was, now] of [
    ['the rail feature map', "const TABFEAT={overview:\"pl\",summary:\"summary\",pl:\"pl\",bs:\"bs\",budget:\"budget\",cash:\"cash\",", "const TABFEAT={overview:\"pl\",summary:\"summary\",pl:\"pl\",bs:\"bs\",ratios:\"ratios\",budget:\"budget\",cash:\"cash\","],
    ['the screen router', "const RENDER={overview:()=>renderOverview(),summary:()=>renderSummary(),pl:()=>renderPl(),bs:()=>renderBs(),", "const RENDER={overview:()=>renderOverview(),summary:()=>renderSummary(),pl:()=>renderPl(),bs:()=>renderBs(),\n ratios:()=>renderRatios(),"],
    ['the Client setup labels', " summary:[\"Management summary\",\"Months across, % of sales\"],", " summary:[\"Management summary\",\"Months across, % of sales\"],\n ratios:[\"Ratios\",\"Liquidity, efficiency, profitability, gearing and growth\"],"],
  ]) {
    if (!script.includes(was)) throw new Error(what + ' is not where it was.');
    script = script.replace(was, now);
  }
  script += "\n/* ---------- ratios (FIX-3 §6) ---------- */\n/*\n * Ratios need the profit and loss as well as the balance sheet, so they have a\n * screen of their own, with the headline few repeated at the foot of the\n * balance sheet.\n *\n * Three rules, and they are what makes this survive being put in front of a\n * client:\n *\n *   Every ratio shows the two figures it is made from. A current ratio of 1,42\n *   is an opinion; 512.480 of current assets over 360.900 of current\n *   liabilities is a fact somebody can check.\n *\n *   Every ratio runs across the same columns as the statements, through the\n *   same comparison machinery, so a number is read as a trend and not on its\n *   own.\n *\n *   A ratio that cannot be computed says WHY — no denominator, no prior\n *   column, no stock — rather than printing a dash or, worse, a nought.\n *\n * Nothing here is keyed and nothing here is stored. Every figure is derived\n * from the ledger at the moment it is drawn.\n */\n\n/* The balance sheet as the balance sheet itself computes it, so the two cannot\n   disagree: subtotal lines are skipped, B-650 is the cumulative result for the\n   year to that month, and B-640 is the plug that makes the thing balance. */\nfunction bsAt(j){\n  const cum=(function(){const a=ytdStart(j);\n    return sumL(REV,a,j)-sumL(COS,a,j)+sumL(OI,a,j)-sumL(SD,a,j)-sumL(ADM,a,j)-sumL(FIN,a,j);})();\n  const val=(id)=>id===\"B-650\"?cum:BS(id)[j];\n  const sec=(pre)=>D.lines.filter(l=>l.id.startsWith(pre)&&!l.sub&&l.id!==\"B-640\")\n    .reduce((t,l)=>t+val(l.id),0);\n  const nca=sec(\"B-0\"), ca=sec(\"B-1\"), cl=sec(\"B-2\"), ncl=sec(\"B-4\");\n  /* Equity is net assets by construction: B-640 is whatever makes it so, which\n     is exactly what the balance sheet prints. */\n  const na=nca+ca-cl-ncl;\n  return {nca:nca, ca:ca, cl:cl, ncl:ncl, eq:na, ta:nca+ca,\n          stock:BS(\"B-110\")[j], deb:BS(\"B-120\")[j], cre:BS(\"B-210\")[j],\n          cash:BS(\"B-160\")[j], od:BS(\"B-270\")[j]};\n}\n\n/* Days in a range of months, so a days ratio is measured over the period it is\n   actually drawn for rather than annualised out of a guess. */\nfunction daysIn(a,b){\n  let d=0;\n  for(let j=a;j<=b;j++){const y=+M[j].slice(0,4), m=+M[j].slice(5,7);\n    d+=new Date(y,m,0).getDate();}\n  return d;\n}\n\n/* Everything a ratio can be made from, for one column. `range` is null on the\n   balance sheet, where a column is a month end and there is no period behind\n   it: the ratios that need one say so instead of inventing it. */\nfunction ratioFigures(col){\n  if(col.missing)return null;\n  const F=bsAt(col.at);\n  F.days=col.range?daysIn(col.range[0],col.range[1]):null;\n  if(col.range){\n    const a=col.range[0], b=col.range[1];\n    F.rev=sumL(REV,a,b); F.cos=sumL(COS,a,b); F.oi=sumL(OI,a,b);\n    F.sd=sumL(SD,a,b); F.adm=sumL(ADM,a,b); F.fin=sumL(FIN,a,b);\n    F.gp=F.rev-F.cos;\n    F.pbt=F.gp+F.oi-F.sd-F.adm-F.fin;\n  }\n  return F;\n}\n\n/* A ratio: what it is called, how it reads, what two figures make it, and the\n   reason it cannot be answered when it cannot. `prior` is the column one older\n   than this one — the growth ratios are the only ones that want it. */\nconst RATIOS=[\n [\"Liquidity\",[\n  {n:\"Current ratio\",u:\"x\",p:[\"Current assets\",\"Current liabilities\"],\n   f:F=>[F.ca,F.cl],why:F=>Math.abs(F.cl)<0.005?\"no current liabilities\":null},\n  {n:\"Quick ratio (acid test)\",u:\"x\",p:[\"Current assets less stock\",\"Current liabilities\"],\n   f:F=>[F.ca-F.stock,F.cl],why:F=>Math.abs(F.cl)<0.005?\"no current liabilities\":null},\n  {n:\"Working capital\",u:\"eur\",p:[\"Current assets\",\"Current liabilities\"],\n   f:F=>[F.ca,F.cl],v:F=>F.ca-F.cl}]],\n [\"Efficiency\",[\n  {n:\"Debtor days\",u:\"days\",p:[\"Trade debtors\",\"Revenue for the period\"],\n   f:F=>[F.deb,F.rev],needsPeriod:true,\n   v:F=>F.deb/F.rev*F.days,why:F=>Math.abs(F.rev)<0.005?\"no revenue in the period\":null},\n  {n:\"Creditor days\",u:\"days\",p:[\"Trade creditors\",\"Cost of sales for the period\"],\n   f:F=>[F.cre,F.cos],needsPeriod:true,\n   v:F=>F.cre/F.cos*F.days,why:F=>Math.abs(F.cos)<0.005?\"no cost of sales in the period\":null},\n  {n:\"Stock days\",u:\"days\",p:[\"Stock\",\"Cost of sales for the period\"],\n   f:F=>[F.stock,F.cos],needsPeriod:true,\n   v:F=>F.stock/F.cos*F.days,\n   why:F=>Math.abs(F.stock)<0.005?\"no stock held\":Math.abs(F.cos)<0.005?\"no cost of sales in the period\":null},\n  {n:\"Cash conversion cycle\",u:\"days\",p:[\"Debtor days plus stock days\",\"Creditor days\"],\n   needsPeriod:true,\n   f:F=>[F.deb/F.rev*F.days+(Math.abs(F.stock)<0.005?0:F.stock/F.cos*F.days),F.cre/F.cos*F.days],\n   v:F=>F.deb/F.rev*F.days+(Math.abs(F.stock)<0.005?0:F.stock/F.cos*F.days)-F.cre/F.cos*F.days,\n   why:F=>Math.abs(F.rev)<0.005?\"no revenue in the period\":Math.abs(F.cos)<0.005?\"no cost of sales in the period\":null},\n  {n:\"Stock turnover\",u:\"x\",p:[\"Cost of sales for the period\",\"Stock\"],\n   f:F=>[F.cos,F.stock],needsPeriod:true,\n   why:F=>Math.abs(F.stock)<0.005?\"no stock held\":null}]],\n [\"Profitability\",[\n  {n:\"Gross margin\",u:\"pc\",p:[\"Gross profit\",\"Revenue\"],\n   f:F=>[F.gp,F.rev],needsPeriod:true,why:F=>Math.abs(F.rev)<0.005?\"no revenue in the period\":null},\n  {n:\"Net margin\",u:\"pc\",p:[\"Profit before tax\",\"Revenue\"],\n   f:F=>[F.pbt,F.rev],needsPeriod:true,why:F=>Math.abs(F.rev)<0.005?\"no revenue in the period\":null},\n  {n:\"Return on capital employed\",u:\"pc\",p:[\"Profit before tax\",\"Capital employed\"],\n   f:F=>[F.pbt,F.ta-F.cl],needsPeriod:true,\n   why:F=>Math.abs(F.ta-F.cl)<0.005?\"no capital employed\":null},\n  {n:\"Return on equity\",u:\"pc\",p:[\"Profit before tax\",\"Equity\"],\n   f:F=>[F.pbt,F.eq],needsPeriod:true,why:F=>Math.abs(F.eq)<0.005?\"no equity\":null}]],\n [\"Gearing\",[\n  {n:\"Gearing (debt to equity)\",u:\"pc\",p:[\"Borrowings\",\"Equity\"],\n   f:F=>[F.ncl+F.od,F.eq],why:F=>Math.abs(F.eq)<0.005?\"no equity\":null},\n  {n:\"Interest cover\",u:\"x\",p:[\"Profit before interest\",\"Finance costs\"],\n   f:F=>[F.pbt+F.fin,F.fin],needsPeriod:true,\n   why:F=>Math.abs(F.fin)<0.005?\"no finance costs in the period\":null},\n  {n:\"Debt to total assets\",u:\"pc\",p:[\"Borrowings\",\"Total assets\"],\n   f:F=>[F.ncl+F.od,F.ta],why:F=>Math.abs(F.ta)<0.005?\"no assets\":null}]],\n [\"Growth\",[\n  {n:\"Revenue growth\",u:\"pc\",p:[\"Revenue this column\",\"Revenue the column before\"],\n   needsPeriod:true,needsPrior:true,\n   f:(F,P)=>[F.rev,P.rev],why:(F,P)=>Math.abs(P.rev)<0.005?\"nothing to grow from\":null},\n  {n:\"Gross profit growth\",u:\"pc\",p:[\"Gross profit this column\",\"Gross profit the column before\"],\n   needsPeriod:true,needsPrior:true,\n   f:(F,P)=>[F.gp,P.gp],why:(F,P)=>Math.abs(P.gp)<0.005?\"nothing to grow from\":null}]]\n];\n\n/* How a ratio reads. A growth or a margin is a percentage; a cover or a\n   turnover is a multiple; days are days; working capital is money. */\nfunction ratioShow(u,v){\n  if(v===null||!isFinite(v))return \"—\";\n  if(u===\"pc\")return v.toFixed(1)+\"%\";\n  if(u===\"days\")return Math.round(v)+\" days\";\n  if(u===\"eur\")return eur(v);\n  return v.toFixed(2)+\"×\";\n}\n/* The result, unless the ratio computes its own. A percentage is the pair as a\n   percentage, a growth is the pair as a change, and everything else divides. */\nfunction ratioValue(r,F,P){\n  if(r.v)return r.v(F,P);\n  const pr=r.f(F,P);\n  if(!pr||pr[1]===undefined||Math.abs(pr[1])<0.005)return null;\n  if(r.u===\"pc\")return r.needsPrior?(pr[0]/pr[1]-1)*100:(pr[0]/pr[1]*100);\n  return pr[0]/pr[1];\n}\n\nfunction renderRatios(){\n  periodCtl(\"ra\",\"raCtl\",renderRatios);\n  cmpCtl(\"ra\",\"raCmpBar\",renderRatios);\n  const r=periodRange(\"ra\");\n  /* The same columns as the statements, through the same machinery. A balance\n     sheet figure is taken at the END of each column, a profit and loss figure\n     over the whole of it. */\n  const cols=[{label:spanLbl(r),at:r[1],range:r}].concat(cmpCols(\"ra\").map(function(c){\n    return c.missing?{label:c.label,missing:c.missing}\n                    :(c.budget?{label:c.label,missing:\"a ratio is not budgeted\"}\n                              :{label:c.label,at:c.range[1],range:c.range});\n  }));\n  const F=cols.map(ratioFigures);\n\n  let h=`<table><thead><tr><th>Ratio</th>`\n    +cols.map(c=>`<th class=\"num\">${c.label}</th>`).join(\"\")\n    +`</tr></thead><tbody>`;\n  RATIOS.forEach(function(g){\n    h+=`<tr class=\"sec\"><td colspan=\"${cols.length+1}\">${g[0]}</td></tr>`;\n    g[1].forEach(function(rt){\n      const cells=[], parts=[[],[]];\n      cols.forEach(function(c,k){\n        const f=F[k], p=F[k+1];\n        if(!f){cells.push(`<td class=\"num rwhy\">${c.missing}</td>`);\n          parts[0].push('<td class=\"num\">—</td>');parts[1].push('<td class=\"num\">—</td>');return;}\n        if(rt.needsPeriod&&!c.range){\n          cells.push('<td class=\"num rwhy\">no period behind this column</td>');\n          parts[0].push('<td class=\"num\">—</td>');parts[1].push('<td class=\"num\">—</td>');return;}\n        if(rt.needsPrior&&!p){\n          cells.push('<td class=\"num rwhy\">no earlier column to compare with</td>');\n          parts[0].push('<td class=\"num\">—</td>');parts[1].push('<td class=\"num\">—</td>');return;}\n        const why=rt.why?rt.why(f,p):null;\n        const pr=rt.f(f,p);\n        parts[0].push(`<td class=\"num\">${pr[0]===undefined?\"—\":eur(pr[0])}</td>`);\n        parts[1].push(`<td class=\"num\">${pr[1]===undefined?\"—\":eur(pr[1])}</td>`);\n        cells.push(why?`<td class=\"num rwhy\">${why}</td>`\n                      :`<td class=\"num\"><b>${ratioShow(rt.u,ratioValue(rt,f,p))}</b></td>`);\n      });\n      h+=`<tr><td>${rt.n}</td>${cells.join(\"\")}</tr>`;\n      /* The two figures it is made from, under it and indented, because the\n         result on its own is something a client has to take on trust. */\n      h+=`<tr class=\"rpart\"><td>${rt.p[0]}</td>${parts[0].join(\"\")}</tr>`;\n      h+=`<tr class=\"rpart\"><td>${rt.p[1]}</td>${parts[1].join(\"\")}</tr>`;\n    });\n  });\n  h+=\"</tbody></table>\";\n  document.getElementById('tblRatios').innerHTML=h;\n  document.getElementById('raNote').innerHTML=\n    \"<b>What this says</b>Every ratio here is derived from the ledger as it stands; nothing on this screen is keyed and nothing on it feeds anything else. \"\n    +\"The two figures under each ratio are what it was made from, so any of them can be traced back to the statements. \"\n    +\"Days are measured over the period each column covers (\"+daysIn(r[0],r[1])+\" days for \"+spanLbl(r)+\"), not annualised. \"\n    +\"Growth is measured against the column immediately to the right, which is the older one.\";\n  notes(\"ratiosNotes\",\"ratios\");\n}\n\n/* The headline few, at the foot of the balance sheet. Only ratios a month end\n   can answer on its own — the rest need a period, and the balance sheet does\n   not have one. */\nfunction bsRatioFoot(cols){\n  const pick=[[\"Current ratio\",\"x\",F=>[F.ca,F.cl]],\n              [\"Quick ratio (acid test)\",\"x\",F=>[F.ca-F.stock,F.cl]],\n              [\"Working capital\",\"eur\",F=>[F.ca-F.cl,1]],\n              [\"Gearing (debt to equity)\",\"pc\",F=>[F.ncl+F.od,F.eq]]];\n  const F=cols.map(c=>c.missing?null:bsAt(c.at));\n  let h=`<table><thead><tr><th>Ratio</th>`\n    +cols.map(function(c,k){return `<th class=\"num\">${c.label}</th>`+(k>0?'<th class=\"num\"></th>':\"\")}).join(\"\")\n    +`</tr></thead><tbody>`;\n  pick.forEach(function(p){\n    h+=`<tr><td>${p[0]}</td>`;\n    cols.forEach(function(c,k){\n      const f=F[k];\n      let cell='<td class=\"num rwhy\">'+(c.missing||\"\")+'</td>';\n      if(f){\n        const pr=p[2](f);\n        const v=Math.abs(pr[1])<0.005?null:(p[1]===\"pc\"?pr[0]/pr[1]*100:p[1]===\"eur\"?pr[0]:pr[0]/pr[1]);\n        cell=`<td class=\"num\">${v===null?'<span class=\"rwhy\">no denominator</span>':ratioShow(p[1],v)}</td>`;\n      }\n      h+=cell+(k>0?'<td class=\"num\"></td>':\"\");\n    });\n    h+=`</tr>`;\n  });\n  h+=\"</tbody></table>\";\n  return `<h3 class=\"bsrh\">The headline ratios</h3><p class=\"cap\">The four a month end can answer on its own. `\n    + `The rest need a period behind them and are on the Ratios screen.</p>`\n    + `<div class=\"tw\">${h}</div>`;\n}\n";
}

// ---- patch 27: cash in and out (FIX-3 §7) ----
//
// The direct statement. Everything it needs comes from migration 222, which
// attributes each bank posting to the other side of its own transaction; the
// screen groups, totals and explains. No new import, and it ties to the
// ledger's own bank movement to the cent in every month and on every account.
{
  for (const [what, was, now] of [
    ['the rail feature map', "const TABFEAT={overview:\"pl\",summary:\"summary\",pl:\"pl\",bs:\"bs\",ratios:\"ratios\",budget:\"budget\",cash:\"cash\",", "const TABFEAT={overview:\"pl\",summary:\"summary\",pl:\"pl\",bs:\"bs\",ratios:\"ratios\",budget:\"budget\",cash:\"cash\",cashio:\"cashio\","],
    ['the screen router', " ratios:()=>renderRatios(),", " ratios:()=>renderRatios(),cashio:()=>renderCashIO(),"],
    ['the Client setup labels', " ratios:[\"Ratios\",\"Liquidity, efficiency, profitability, gearing and growth\"],", " ratios:[\"Ratios\",\"Liquidity, efficiency, profitability, gearing and growth\"],\n cashio:[\"Cash in and out\",\"The direct statement: receipts and payments, by who and what for\"],"],
    ['the year pickers', "  [\"sumYear\",\"budYear\",\"cmYear\"].forEach(id=>{const el=document.getElementById(id);if(el)fillYears(el)});", "  [\"sumYear\",\"budYear\",\"cmYear\",\"cioYear\"].forEach(id=>{const el=document.getElementById(id);if(el)fillYears(el)});"],
  ]) {
    if (!script.includes(was)) throw new Error(what + ' is not where it was.');
    script = script.replace(was, now);
  }
  script += "\n/* ---------- cash in and out (FIX-3 §7) ---------- */\n/*\n * The indirect statement on the Cash flow screen explains the movement. This\n * one lists it: money in and money out, by bank account, month by month,\n * showing who was paid and what for.\n *\n * No new import. Every posting on a bank or cash account has another side, and\n * that other side says what the money was for; migration 222 does the pairing\n * and hands over one row per bank posting per contra. It ties to the ledger's\n * own bank movement exactly — every month, every account, to the cent — which\n * is the only thing that makes a screen like this worth putting in front of\n * anybody.\n *\n * Transfers between the client's own accounts are NOT money in or out. They are\n * marked as transfers, shown on their own line, and left out of the totals on\n * the combined view, because moving money from the cash account to the current\n * account has not funded anything.\n */\nlet CIO=null;\nfunction cashio(){\n  if(CIO&&CIO.cid===CID)return CIO;\n  const C=D.cashio;\n  if(!C||!C.ep||!C.v||!C.v.length){CIO={cid:CID,rows:[],banks:[],ok:false};return CIO;}\n  const ep=new Date(C.ep+\"T00:00:00Z\");\n  const rows=C.v.map(function(v,i){\n    const dt=new Date(ep.getTime()+C.d[i]*86400000);\n    const ci=C.c[i];\n    return {m:dt.toISOString().slice(0,7), date:dt.toISOString().slice(0,10),\n            b:C.b[i], bank:C.acc[C.b[i]][0], bankName:C.acc[C.b[i]][1],\n            c:ci, code:ci<0?null:C.acc[ci][0], name:ci<0?\"Between the client's own accounts\":C.acc[ci][1],\n            line:ci<0?\"\":(C.line&&C.line[ci])||\"\",\n            v:v, ref:C.rd[C.r[i]], det:C.td[C.t[i]], jrn:C.jr[C.j[i]], x:!!C.x[i]};});\n  const banks=[];\n  C.acc.forEach(function(a,i){ if(rows.some(r=>r.b===i))banks.push({i:i,code:a[0],name:a[1]}); });\n  CIO={cid:CID,rows:rows,banks:banks,ok:true};\n  return CIO;\n}\n\n/* Where a receipt or a payment belongs, from the report line of its other side.\n   The order matters: the first rule that matches wins, and the overheads catch\n   everything left on a profit and loss line. */\nfunction cioGroup(r){\n  if(r.x)return [\"transfer\",\"Between the client's own accounts\"];\n  const L=r.line||\"\", inward=r.v>0;\n  if(L===\"B-120\")return inward?[\"in-cust\",\"Customer receipts\"]:[\"out-cust\",\"Refunds to customers\"];\n  if(L===\"B-210\")return inward?[\"in-supp\",\"Refunds from suppliers\"]:[\"out-supp\",\"Suppliers\"];\n  if(L===\"B-220\")return [\"out-pay\",\"Payroll and contributions\"];\n  if(L===\"B-140\"||L===\"B-240\"||L===\"B-250\")return inward?[\"in-vat\",\"VAT and tax refunds\"]:[\"out-vat\",\"VAT and taxes\"];\n  if(L.slice(0,3)===\"B-4\")return inward?[\"in-loan\",\"Loans received\"]:[\"out-loan\",\"Loan repayments\"];\n  if(L===\"B-150\"||L.slice(0,3)===\"B-6\")return inward?[\"in-dir\",\"Shareholder and director\"]:[\"out-dir\",\"Directors and shareholders\"];\n  if(L.slice(0,2)===\"P-\")return inward?[\"in-other\",\"Other receipts\"]:[\"out-exp\",\"Overheads and costs\"];\n  return inward?[\"in-other\",\"Other receipts\"]:[\"out-other\",\"Other payments\"];\n}\n/* The order they are read in, which is the order the work order sets out. */\nconst CIOIN=[[\"in-cust\",\"Customer receipts\"],[\"in-loan\",\"Loans received\"],\n  [\"in-dir\",\"Shareholder and director\"],[\"in-vat\",\"VAT and tax refunds\"],\n  [\"in-supp\",\"Refunds from suppliers\"],[\"in-other\",\"Other receipts\"]];\nconst CIOOUT=[[\"out-supp\",\"Suppliers\"],[\"out-pay\",\"Payroll and contributions\"],\n  [\"out-vat\",\"VAT and taxes\"],[\"out-loan\",\"Loan repayments\"],\n  [\"out-dir\",\"Directors and shareholders\"],[\"out-exp\",\"Overheads and costs\"],\n  [\"out-cust\",\"Refunds to customers\"],[\"out-other\",\"Other payments\"]];\n\nvar CIOSEL=null;      /* which figure is open, as month|group */\n\nfunction renderCashIO(){\n  const C=cashio();\n  const host=document.getElementById('tblCashIO');\n  if(!C.ok){\n    host.innerHTML='<p class=\"cap\">Nothing has been posted to a bank or cash account for this client, '\n      +'so there is nothing to list. That is not an error.</p>';\n    document.getElementById('cioWho').innerHTML=\"\";\n    notes(\"cashioNotes\",\"cashio\");\n    return;}\n\n  /* The year and the account are chosen at the top. The account selector is the\n     one the Cash flow screen already has, for the same reason: a client with\n     three banks wants to know which one is carrying the strain. */\n  const sel=document.getElementById('cioBank');\n  if(sel.dataset.cid!==String(CID)){\n    sel.innerHTML='<option value=\"\">All accounts together</option>'\n      +C.banks.map(b=>`<option value=\"${b.i}\">${b.code} ${b.name}</option>`).join(\"\");\n    sel.dataset.cid=String(CID);}\n  const bank=sel.value===\"\"?null:+sel.value;\n  const y=document.getElementById('cioYear').value;\n\n  const cols=[]; for(let k=1;k<=12;k++){const j=idx(y+\"-\"+String(k).padStart(2,\"0\"));if(j>=0)cols.push(j);}\n  if(!cols.length){\n    host.innerHTML='<p class=\"cap\">Nothing is posted in '+y+', so there is nothing to list.</p>';\n    document.getElementById('cioWho').innerHTML=\"\";\n    notes(\"cashioNotes\",\"cashio\");\n    return;}\n\n  const mine=C.rows.filter(r=>(bank===null||r.b===bank)&&r.m.slice(0,4)===y);\n  /* On the combined view a transfer moves nothing: it leaves one of the\n     client's accounts and arrives in another, and both sides are here. Looking\n     at one account it is real money, and it is shown. */\n  const rows=bank===null?mine.filter(r=>!r.x):mine;\n\n  const at={};\n  rows.forEach(function(r){\n    const g=cioGroup(r)[0], k=r.m+\"|\"+g;\n    at[k]=(at[k]||0)+r.v;});\n  const sum=(g,j)=>at[M[j]+\"|\"+g]||0;\n\n  /* The opening balance is the position at the month before the first shown,\n     taken from the balance sheet so this screen and the balance sheet cannot\n     disagree about where the money started. */\n  const bal=function(j){\n    if(bank!==null){\n      /* One account: the running total of its own postings up to that month. */\n      let t=0;\n      C.rows.forEach(function(r){ if(r.b===bank&&r.m<=M[j])t+=r.v; });\n      return t;}\n    return BS(\"B-160\")[j]+BS(\"B-270\")[j];};\n  const open=cols.map(j=>j>0?bal(j-1):0);\n\n  /* §7 — a monthly average over the months shown, so a conversation about what\n     the next quarter needs starts from what the last months actually cost. */\n  const avg=(g)=>cols.reduce((t,j)=>t+sum(g,j),0)/cols.length;\n\n  const money=(v)=>Math.abs(v)<0.005?\"—\":eur(v);\n  const line=(id,nm,cls)=>{\n    const vs=cols.map(j=>sum(id,j));\n    if(!vs.some(v=>Math.abs(v)>0.005))return \"\";\n    return `<tr class=\"${cls||\"\"}\"><td>${nm}</td>`\n      +vs.map((v,k)=>`<td class=\"num cioc\" data-g=\"${id}\" data-m=\"${M[cols[k]]}\">${money(v)}</td>`).join(\"\")\n      +`<td class=\"num\">${money(vs.reduce((a,b)=>a+b,0))}</td><td class=\"num avgc\">${money(avg(id))}</td></tr>`;};\n\n  const totOf=(list,j)=>list.reduce((t,g)=>t+sum(g[0],j),0);\n  const totRow=(nm,list)=>{\n    const vs=cols.map(j=>totOf(list,j));\n    return `<tr class=\"sub\"><td>${nm}</td>`+vs.map(v=>`<td class=\"num\">${money(v)}</td>`).join(\"\")\n      +`<td class=\"num\">${money(vs.reduce((a,b)=>a+b,0))}</td>`\n      +`<td class=\"num avgc\">${money(vs.reduce((a,b)=>a+b,0)/cols.length)}</td></tr>`;};\n\n  const wide=cols.length+3;\n  let h=`<table><thead><tr><th>&nbsp;</th>`\n    +cols.map(j=>`<th class=\"num\">${MN[+M[j].slice(5,7)-1]}</th>`).join(\"\")\n    +`<th class=\"num\">${cols.length===12?\"Year\":\"Shown\"}</th><th class=\"num avgc\">Monthly average</th></tr></thead><tbody>`;\n  h+=`<tr class=\"sub\"><td>Opening balance</td>`\n    +open.map(v=>`<td class=\"num\">${money(v)}</td>`).join(\"\")\n    +`<td class=\"num\">${money(open[0])}</td><td class=\"num avgc\"></td></tr>`;\n\n  h+=`<tr class=\"sec\"><td colspan=\"${wide}\">Money in</td></tr>`;\n  CIOIN.forEach(g=>{h+=line(g[0],g[1]);});\n  h+=totRow(\"Total money in\",CIOIN);\n\n  h+=`<tr class=\"sec\"><td colspan=\"${wide}\">Money out</td></tr>`;\n  CIOOUT.forEach(g=>{h+=line(g[0],g[1]);});\n  h+=totRow(\"Total money out\",CIOOUT);\n\n  if(bank!==null){\n    h+=`<tr class=\"sec\"><td colspan=\"${wide}\">Moved between accounts</td></tr>`;\n    h+=line(\"transfer\",\"In or out of the client's own accounts\");}\n\n  const net=cols.map((j,k)=>totOf(CIOIN,j)+totOf(CIOOUT,j)+(bank!==null?sum(\"transfer\",j):0));\n  h+=`<tr class=\"tot\"><td>Net movement</td>`+net.map(v=>`<td class=\"num\">${money(v)}</td>`).join(\"\")\n    +`<td class=\"num\">${money(net.reduce((a,b)=>a+b,0))}</td>`\n    +`<td class=\"num avgc\">${money(net.reduce((a,b)=>a+b,0)/cols.length)}</td></tr>`;\n  h+=`<tr class=\"tot\"><td>Closing balance</td>`\n    +cols.map((j,k)=>`<td class=\"num\">${money(open[k]+net[k])}</td>`).join(\"\")\n    +`<td class=\"num\">${money(open[cols.length-1]+net[cols.length-1])}</td><td class=\"num avgc\"></td></tr>`;\n  h+=\"</tbody></table>\";\n  host.innerHTML=h;\n\n  /* Clicking a figure answers \"who\". */\n  host.querySelectorAll(\".cioc\").forEach(function(td){\n    td.addEventListener(\"click\",function(){\n      const k=td.dataset.m+\"|\"+td.dataset.g;\n      CIOSEL=(CIOSEL===k)?null:k;\n      renderCashIO();});});\n  if(CIOSEL)host.querySelectorAll('.cioc[data-m=\"'+CIOSEL.split(\"|\")[0]+'\"][data-g=\"'+CIOSEL.split(\"|\")[1]+'\"]')\n    .forEach(td=>td.classList.add(\"on\"));\n\n  cioWho(rows,cols,bank);\n  notes(\"cashioNotes\",\"cashio\");\n}\n\n/* Who was paid, and the largest twenty. The first answers the figure that was\n   clicked; the second is what gets pointed at in a meeting. */\nfunction cioWho(rows,cols,bank){\n  const el=document.getElementById('cioWho');\n  const last=M[cols[cols.length-1]];\n  let h=\"\";\n\n  if(CIOSEL){\n    const parts=CIOSEL.split(\"|\"), mm=parts[0], g=parts[1];\n    const mine=rows.filter(r=>r.m===mm&&cioGroup(r)[0]===g);\n    const label=(CIOIN.concat(CIOOUT).filter(x=>x[0]===g)[0]||[g,g])[1];\n    const by={};\n    mine.forEach(function(r){\n      const k=r.code||\"transfer\";\n      if(!by[k])by[k]={name:r.name,code:r.code,v:0,n:0};\n      by[k].v+=r.v; by[k].n++;});\n    const list=Object.values(by).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v));\n    h+=`<div class=\"card\"><h3>${label} — ${lbl(mm)}</h3>`\n      +`<p class=\"cap\">Who is behind the figure, largest first. Press it again to close.</p>`\n      +`<div class=\"tw\"><table><thead><tr><th>Account</th><th>Name</th>`\n      +`<th class=\"num\">Amount</th><th class=\"num\">Items</th></tr></thead><tbody>`\n      +list.map(x=>`<tr><td class=\"mono\">${x.code||\"—\"}</td><td>${x.name}</td>`\n        +`<td class=\"num\">${eur(x.v)}</td><td class=\"num\">${x.n}</td></tr>`).join(\"\")\n      +`</tbody></table></div>`;\n    /* and the items themselves, so it can be found in BTMS */\n    const items=mine.slice().sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)).slice(0,60);\n    h+=`<p class=\"cap\">The ${items.length===mine.length?mine.length:\"largest \"+items.length+\" of \"+mine.length} `\n      +`item${mine.length===1?\"\":\"s\"} behind it.</p>`\n      +`<div class=\"tw\"><table><thead><tr><th>Date</th><th>Account</th><th>Name</th>`\n      +`<th>Journal</th><th>Reference</th><th>Details</th><th class=\"num\">Amount</th></tr></thead><tbody>`\n      +items.map(r=>`<tr><td class=\"mono\">${r.date}</td><td class=\"mono\">${r.code||\"—\"}</td>`\n        +`<td>${r.name}</td><td class=\"mono\">${r.jrn}</td><td class=\"mono\">${r.ref}</td>`\n        +`<td>${r.det}</td><td class=\"num\">${eur(r.v)}</td></tr>`).join(\"\")\n      +`</tbody></table></div></div>`;\n  }\n\n  /* The largest twenty payments in the last month shown, always. */\n  const big=rows.filter(r=>r.m===last&&r.v<0).sort((a,b)=>a.v-b.v).slice(0,20);\n  h+=`<div class=\"card\"><h3>The largest twenty payments — ${lbl(last)}</h3>`;\n  h+=big.length\n    ? `<div class=\"tw\"><table><thead><tr><th>Date</th><th>Paid to</th><th>What for</th>`\n      +`<th>Journal</th><th>Reference</th><th class=\"num\">Amount</th></tr></thead><tbody>`\n      +big.map(r=>`<tr><td class=\"mono\">${r.date}</td><td>${r.name}</td>`\n        +`<td>${cioGroup(r)[1]}</td><td class=\"mono\">${r.jrn}</td>`\n        +`<td class=\"mono\">${r.ref}</td><td class=\"num\">${eur(r.v)}</td></tr>`).join(\"\")\n      +`</tbody></table></div>`\n    : `<p class=\"cap\">Nothing was paid out of ${bank===null?\"any account\":\"this account\"} in ${lbl(last)}.</p>`;\n  h+=`</div>`;\n  el.innerHTML=h;\n}\n";
  script += "\n/* The year and the account both redraw it. */\nfor (const id of [\"cioYear\",\"cioBank\"]) {\n  const el=document.getElementById(id);\n  if(el)el.addEventListener(\"change\",function(){CIOSEL=null;renderCashIO();});\n}\n";
}

// ---- patch 25: the management summary (FIX-3 §5) ----
//
// §5a percentages on or off, kept per client. §5b a from and a to month
// beside the year, with the total column becoming the total of the months
// shown and its heading saying which they are.
//
// Replaced whole: the old body hard-coded colspan="2" per month in four
// places and named the total column "Year" unconditionally, so both changes
// land in the same lines.
{
  const [a, b] = cutFn(script, 'renderSummary');
  script = script.slice(0, a) + "/* Whether this client's pack prints a percentage beside every month.\n   Kept per client, like the sections and the charts, and read the same way: a\n   block cached before the choice existed has no pack at all, and falls back to\n   what the summary has always done rather than to nothing. */\nfunction packOn(k){\n  var P=D.cfg&&D.cfg.pack;\n  if(P&&P[k]!==undefined)return P[k]?1:0;\n  return k===\"summaryPercent\"?1:0;\n}\n/* The months of the chosen year that the ledger actually holds. The from and to\n   pickers are filled from this, so a month that was never posted cannot be\n   chosen and then silently shown as nought. */\nfunction sumMonths(y){\n  var out=[];\n  for(var k=1;k<=12;k++){var j=idx(y+\"-\"+String(k).padStart(2,\"0\")); if(j>=0)out.push(j);}\n  return out;\n}\n/* Fill the from and to pickers for a year, keeping what was chosen where it is\n   still in range. The default is January to the last month held — the last\n   CLOSED month, in a year still running — which is what a pack covers. */\nfunction sumFillRange(y){\n  var held=sumMonths(y);\n  var a=document.getElementById('sumFrom'), b=document.getElementById('sumTo');\n  if(!a||!b||!held.length)return held;\n  var was=[a.value,b.value];\n  var opts=held.map(function(j){return '<option value=\"'+M[j]+'\">'+MN[+M[j].slice(5,7)-1]+'</option>'}).join(\"\");\n  a.innerHTML=opts; b.innerHTML=opts;\n  var keys=held.map(function(j){return M[j]});\n  a.value=keys.indexOf(was[0])>=0?was[0]:keys[0];\n  b.value=keys.indexOf(was[1])>=0?was[1]:keys[keys.length-1];\n  /* From after To is not a range. Whichever the person just moved wins and the\n     other follows it, rather than the table quietly showing nothing. */\n  if(keys.indexOf(a.value)>keys.indexOf(b.value))b.value=a.value;\n  return held;\n}\n\nfunction renderSummary(){\n  const y=document.getElementById('sumYear').value;\n  const held=sumFillRange(y);\n  const fromEl=document.getElementById('sumFrom'), toEl=document.getElementById('sumTo');\n  const lo=held.indexOf(idx(fromEl.value)), hi=held.indexOf(idx(toEl.value));\n  const cols=held.slice(lo<0?0:lo,(hi<0?held.length-1:hi)+1);\n\n  /* FIX-3 §5a — with the percentages off a month is one column instead of two,\n     which is nearly twice the room for the figures and is the version most\n     clients want. It belongs to the client, not to whoever is looking. */\n  const showPc=!!packOn(\"summaryPercent\");\n  const per=showPc?2:1;\n  const btn=document.getElementById('sumPct');\n  if(btn){\n    btn.textContent=showPc?\"Percentages on\":\"Percentages off\";\n    btn.className=\"perbtn\"+(showPc?\" on\":\"\");\n  }\n\n  if(!cols.length){\n    document.getElementById('tblSummary').innerHTML=\n      '<p class=\"cap\">Nothing is posted in '+y+', so there is nothing to summarise.</p>';\n    notes(\"summaryNotes\",\"summary\");\n    return;\n  }\n\n  const sales=cols.map(j=>REV.reduce((t2,id)=>t2+PL(id)[j],0));\n  const tot=sales.reduce((a2,b2)=>a2+b2,0);\n  const groups=[[\"Revenue\",REV],[\"Cost of sales\",COS],[\"Other income\",OI],[\"Selling and distribution\",SD],[\"Administration\",ADM],[\"Finance costs\",FIN]];\n  const cell=(v,base)=>`<td class=\"num\">${eur(v)}</td>`\n    +(showPc?`<td class=\"num pcol\">${Math.abs(base)<1?\"—\":(v/base*100).toFixed(1)+\"%\"}</td>`:\"\");\n\n  /* §5b — the total column is the total of the MONTHS SHOWN, and its heading\n     says which they are. Calling it \"Year\" while showing January to July would\n     be a wrong figure under a wrong name. */\n  const span=MN[+M[cols[0]].slice(5,7)-1]+(cols.length>1?\"–\"+MN[+M[cols[cols.length-1]].slice(5,7)-1]:\"\");\n  const totHead=cols.length===12?\"Year\":span;\n\n  let h=`<table class=\"h2\"><thead><tr><th rowspan=\"2\">Line</th>`\n    +cols.map(j=>`<th class=\"num\" colspan=\"${per}\">${MN[+M[j].slice(5,7)-1]}</th>`).join(\"\")\n    +`<th class=\"num\" colspan=\"${per}\">${totHead}</th></tr>`\n    +`<tr>${cols.map(()=>'<th class=\"num\">EUR</th>'+(showPc?'<th class=\"num pcol\">%</th>':\"\")).join(\"\")}`\n    +`<th class=\"num\">EUR</th>${showPc?'<th class=\"num pcol\">%</th>':\"\"}</tr></thead><tbody>`;\n  const wide=cols.length*per+per+1;\n\n  groups.forEach(([g,ids])=>{\n    h+=`<tr class=\"sec\"><td colspan=\"${wide}\">${g}</td></tr>`;\n    ids.forEach(id=>{\n      const vals=cols.map(j=>PL(id)[j]); const t2=vals.reduce((a2,b2)=>a2+b2,0);\n      if(Math.abs(t2)<0.005)return;\n      h+=`<tr><td>${LI[id].name}</td>${vals.map((v,k)=>cell(v,sales[k])).join(\"\")}${cell(t2,tot)}</tr>`;});\n    const gt=cols.map(j=>ids.reduce((t2,id)=>t2+PL(id)[j],0));\n    h+=`<tr class=\"sub\"><td>Total ${g.toLowerCase()}</td>${gt.map((v,k)=>cell(v,sales[k])).join(\"\")}${cell(gt.reduce((a2,b2)=>a2+b2,0),tot)}</tr>`;\n    if(g===\"Cost of sales\"){\n      const gp=cols.map((j,k)=>sales[k]-gt[k]);\n      h+=`<tr class=\"sub\"><td>Gross profit</td>${gp.map((v,k)=>cell(v,sales[k])).join(\"\")}${cell(gp.reduce((a2,b2)=>a2+b2,0),tot)}</tr>`;}\n  });\n  const pbt=cols.map((j,k)=>sales[k]-COS.reduce((t2,id)=>t2+PL(id)[j],0)+OI.reduce((t2,id)=>t2+PL(id)[j],0)\n    -SD.reduce((t2,id)=>t2+PL(id)[j],0)-ADM.reduce((t2,id)=>t2+PL(id)[j],0)-FIN.reduce((t2,id)=>t2+PL(id)[j],0));\n  h+=`<tr class=\"sub\"><td>Profit before tax</td>${pbt.map((v,k)=>cell(v,sales[k])).join(\"\")}${cell(pbt.reduce((a2,b2)=>a2+b2,0),tot)}</tr></tbody></table>`;\n  document.getElementById('tblSummary').innerHTML=h;\n  document.getElementById('sumWhat').textContent=\n    cols.length===12\n      ? \"Every month of \"+y+\".\"\n      : span+\" \"+y+\" — \"+cols.length+(cols.length===1?\" month\":\" months\")+\", and the total column is those months.\";\n  notes(\"summaryNotes\",\"summary\");\n}\n" + script.slice(b);

  const wireWas = "document.getElementById('sumYear').addEventListener('change',renderSummary);";
  if (!script.includes(wireWas)) throw new Error('the summary year listener is not where it was.');
  script = script.replace(wireWas, "document.getElementById('sumYear').addEventListener('change',renderSummary);\ndocument.getElementById('sumFrom').addEventListener('change',renderSummary);\ndocument.getElementById('sumTo').addEventListener('change',renderSummary);\ndocument.getElementById('sumPct').addEventListener('click',function(){\n  var now=!packOn(\"summaryPercent\");\n  if(parent===window){alert(\"Choosing what the pack looks like works inside the portal.\");return;}\n  if(!D.cfg.pack)D.cfg.pack={};\n  D.cfg.pack.summaryPercent=now?1:0;\n  renderSummary();\n  parent.postMessage({type:\"pcp-pack\",key:CID,feature:\"summaryPercent\",on:now},\"*\");\n});");
}

// ---- patch 24: the overview draws what the client was given (FIX-3 §4) ----
//
// §4a the chart library, §4b the width, §4c the month row.
//
// renderOverview is replaced whole: it built three fixed charts into three
// fixed cards, and both the charts and the cards now depend on the client, so
// there is nothing of the old shape left to keep. OVCHARTS in the new body and
// CHARTS in src/reporting/lib/reports/chartStore.ts are the same list twice —
// tools/check-overview-charts.cjs fails if they drift apart.
{
  // §4b: the card was already full width and the chart already filled it. What
  // it did was STRETCH, which is not the same thing.
  const bcWas = "function barsChart(host,items){\n  const W=760,rowH=30,P={t:8,r:16,b:8,l:190},H=P.t+items.length*rowH+P.b;";
  if (!script.includes(bcWas)) throw new Error('barsChart is not where it was.');
  script = script.replace(bcWas, "function barsChart(host,items,opts){\n  opts=opts||{};\n  /* A full-width card gets a wider viewBox rather than a bigger picture:\n     the svg scales to its container, so 760 blown up to 1880 takes the\n     twelve-point labels up with it. FIX-3 §4b. */\n  const W=opts.wide?1600:760,rowH=opts.wide?34:30,\n        P={t:8,r:16,b:8,l:opts.wide?340:190},H=P.t+items.length*rowH+P.b;");

  const [a, b] = cutFn(script, 'renderOverview');
  script = script.slice(0, a) + "/* The charts the overview can draw, and what each one is for.\n   The three the prototype drew are on unless somebody says otherwise; the rest\n   are off until asked for, so no client's front page changes on the day this\n   ships. src/reporting/lib/reports/chartStore.ts holds the same list — the two\n   are checked against each other by tools/check-overview-charts.cjs. */\nconst OVCHARTS=[\n  [\"sales\",\"Sales by month\",\"Each year laid over the same months. Choose two, three or five years in the header.\",1],\n  [\"margin\",\"Gross margin\",\"Monthly gross profit as a percentage of sales.\",1],\n  [\"money\",\"Where the money went\",\"Cost of sales and overheads against revenue for the year to the selected month.\",1],\n  [\"overhead\",\"Overheads by month\",\"Selling, distribution and administration, each year over the same months.\",0],\n  [\"cash\",\"Cash and bank\",\"The balance at each month end, as the ledger has it.\",0],\n  [\"ageing\",\"Debtors and creditors ageing\",\"What is owed and what is owed out, by how old it is.\",0],\n  [\"customer\",\"Sales by customer\",\"The ten largest customers in the period, at invoiced values including VAT.\",0],\n  [\"budget\",\"Expenses against budget\",\"Each overhead line for the period against what was budgeted for it.\",0]\n];\n/* A block cached before this choice existed carries no charts at all. Falling\n   back to nothing would leave that client looking at an empty front page, so\n   the list's own defaults stand until a fresh block arrives. */\nfunction ovOn(k){\n  var C=D.cfg&&D.cfg.charts;\n  if(C&&C[k]!==undefined)return C[k]?1:0;\n  var d=OVCHARTS.filter(function(c){return c[0]===k})[0];\n  return d?d[3]:0;\n}\n\nfunction renderOverview(){\n  periodCtl(\"ov\",\"ovCtl\",renderOverview);\n  const [pa,pb]=periodRange(\"ov\"); const pr=priorRange(\"ov\");\n  const S=(ids,f,tt)=>ids.reduce((x,id)=>x+PL(id).slice(f,tt+1).reduce((q,w)=>q+w,0),0);\n  const rev=S(REV,pa,pb), cos=S(COS,pa,pb), gp=rev-cos;\n  const oh=S(SD,pa,pb)+S(ADM,pa,pb), fin=S(FIN,pa,pb), oi=S(OI,pa,pb);\n  const pbt=gp+oi-oh-fin;\n  const prev=pr?S(REV,pr[0],pr[1]):null;\n  const cash=BS(\"B-160\")[pb];\n  const A=D.agetot||{};\n  const T=[[\"Revenue\",eur(rev),prev?`${pct((rev/prev-1)*100)} on the same period last year`:\"no comparative loaded\"],\n    [\"Gross profit\",eur(gp),`${rev?(gp/rev*100).toFixed(1):\"0\"}% margin`],\n    [\"Overheads\",eur(oh),`${rev?(oh/rev*100).toFixed(1):\"0\"}% of revenue`],\n    [\"Profit before tax\",eur(pbt),`${rev?(pbt/rev*100).toFixed(1):\"0\"}% of revenue`],\n    [\"Owed to you\",A.debpos!=null?eur(A.debpos):\"—\",A.debpos!=null?A.debn+\" debtor accounts\":\"no ageing loaded\"],\n    [\"You owe\",A.crenet!=null?eur(A.crenet):\"—\",A.crenet!=null?A.cren+\" creditor accounts\":\"no ageing loaded\"],\n    [\"Cash and bank\",eur(cash),\"at \"+lbl(M[pb])]];\n  document.getElementById('ovTiles').innerHTML=T.map(([k,v,d],n)=>{\n    const cls=n===0&&prev?((rev>=prev)?\"up\":\"down\"):\"\";\n    return `<div class=\"tile\"><div class=\"k\">${k}</div><div class=\"v\">${v}</div><div class=\"d ${cls}\">${d}</div></div>`}).join(\"\");\n\n  /* FIX-3 §4c — the month row. The row above answers how the year is going;\n     this one answers how the month closed, which is what a person is doing when\n     they open the report. It is always the LAST month of the period on screen,\n     whatever shape that period is, and it says which month it is. */\n  const mth=(ids)=>ids.reduce((x,id)=>x+PL(id)[pb],0);\n  const mv=(line)=>pb>0?BS(line)[pb]-BS(line)[pb-1]:null;\n  const mRev=mth(REV), mCos=mth(COS), mOh=mth(SD)+mth(ADM);\n  const mPbt=mRev-mCos+mth(OI)-mOh-mth(FIN);\n  const moved=(v)=>v===null?\"nothing to compare with\":(v>0?\"up on \"+lbl(M[pb-1]):v<0?\"down on \"+lbl(M[pb-1]):\"unchanged on \"+lbl(M[pb-1]));\n  const MR=[[\"Revenue\",eur(mRev),lbl(M[pb])+\" alone\"],\n    [\"Gross profit\",eur(mRev-mCos),`${Math.abs(mRev)>1?((mRev-mCos)/mRev*100).toFixed(1):\"0\"}% margin in the month`],\n    [\"Overheads\",eur(mOh),`${Math.abs(mRev)>1?(mOh/mRev*100).toFixed(1):\"0\"}% of the month's revenue`],\n    [\"Profit before tax\",eur(mPbt),`${Math.abs(mRev)>1?(mPbt/mRev*100).toFixed(1):\"0\"}% of the month's revenue`],\n    [\"Debtors moved\",mv(\"B-120\")===null?\"—\":eur(mv(\"B-120\")),moved(mv(\"B-120\"))],\n    [\"Creditors moved\",mv(\"B-210\")===null?\"—\":eur(mv(\"B-210\")),moved(mv(\"B-210\"))],\n    [\"Cash moved\",mv(\"B-160\")===null?\"—\":eur(mv(\"B-160\")),moved(mv(\"B-160\"))]];\n  document.getElementById('ovMonthNote').textContent=\"The month on its own — \"+lbl(M[pb])+\".\";\n  document.getElementById('ovMonthRow').innerHTML=MR.map(([k,v,d],n)=>{\n    const raw=n===4?mv(\"B-120\"):n===5?mv(\"B-210\"):n===6?mv(\"B-160\"):null;\n    const cls=raw===null?\"\":(n===5?(raw>0?\"down\":\"up\"):(raw>0?\"up\":\"down\"));\n    return `<div class=\"tile\"><div class=\"k\">${k}</div><div class=\"v\">${v}</div><div class=\"d ${cls}\">${d}</div></div>`}).join(\"\");\n\n  /* FIX-3 §4a — only the charts this client was given. The cards are built\n     here rather than sitting in the markup, because a card whose chart is\n     switched off has to be gone and not empty. */\n  const want=OVCHARTS.filter(c=>ovOn(c[0]));\n  const box=document.getElementById('ovCharts');\n  box.innerHTML=want.length\n    ? want.map(([k,n,cap])=>`<div class=\"card ovcard\" data-chart=\"${k}\"><h3>${n}</h3>`\n        + `<p class=\"cap\">${cap}</p><div id=\"ovch-${k}\"></div>`\n        + `<div class=\"legend\" id=\"ovlg-${k}\"></div></div>`).join(\"\")\n    : '<div class=\"card\"><h3>No charts</h3><p class=\"cap\">Every chart is switched off for this client. '\n      + 'Client setup, under <b>Charts on the overview</b>, is where they are turned back on.</p></div>';\n\n  const yr=+M[pb].slice(0,4), span=+document.getElementById('chartSpan').value;\n  const labels=MN.slice(), COL=[\"var(--c1)\",\"var(--c2)\",\"var(--c3)\",\"var(--c4)\",\"var(--c5)\"];\n  CHARTS.length=0;\n\n  /* One year's twelve months for whatever the caller measures, null where the\n     ledger does not reach — used by the three charts that lay years over each\n     other, so they agree with one another by construction. */\n  function overlay(f){\n    const out=[];\n    for(let back=0;back<span;back++){\n      const y=yr-back, v=[];\n      for(let k=0;k<12;k++){const j=idx(y+\"-\"+String(k+1).padStart(2,\"0\"));\n        v.push(j<0||j>pb?null:f(j));}\n      if(v.some(x=>x!==null))out.push({n:String(y),c:COL[back%5],v});\n    }\n    return out;\n  }\n  function legend(k,ser,note){\n    const el=document.getElementById('ovlg-'+k); if(!el)return;\n    el.innerHTML=ser.map(s=>`<span><i class=\"sw\" style=\"background:${s.c}\"></i>${s.n}</span>`).join(\"\")\n      +(note||\"\");\n  }\n  const draw={\n    sales:function(h){\n      const ser=overlay(j=>REV.reduce((q,id)=>q+PL(id)[j],0));\n      reg(h,ser,labels);\n      legend(\"sales\",ser,ser.length<span?`<span style=\"color:var(--ink-3)\">only ${ser.length} years loaded</span>`:\"\");\n    },\n    margin:function(h){\n      const ser=overlay(function(j){\n        const r=REV.reduce((q,id)=>q+PL(id)[j],0);\n        return Math.abs(r)<1?null:(r-COS.reduce((q,id)=>q+PL(id)[j],0))/r*100;});\n      reg(h,ser,labels,v=>v.toFixed(0)+\"%\");\n      legend(\"margin\",ser);\n    },\n    overhead:function(h){\n      const ser=overlay(j=>SD.reduce((q,id)=>q+PL(id)[j],0)+ADM.reduce((q,id)=>q+PL(id)[j],0));\n      reg(h,ser,labels);\n      legend(\"overhead\",ser);\n    },\n    money:function(h){\n      barsChart(h,[\n        {n:\"Revenue\",v:rev,c:\"var(--c1)\"},{n:\"Cost of sales\",v:cos,c:\"var(--c2)\"},\n        {n:\"Gross profit\",v:gp,c:\"var(--c3)\"},{n:\"Overheads\",v:oh,c:\"var(--c4)\"},\n        {n:\"Finance costs\",v:fin,c:\"var(--c5)\"},{n:\"Profit before tax\",v:pbt,c:\"var(--c1)\"}],\n        {wide:true});\n    },\n    cash:function(h){\n      /* A running balance, not a monthly figure, so it is read straight down\n         the months held rather than laid one year over another. */\n      const from=Math.max(0,pb-23), lab=[], v=[];\n      for(let j=from;j<=pb;j++){lab.push(lbl(M[j]));v.push(BS(\"B-160\")[j]);}\n      reg(h,[{n:\"Cash and bank\",c:\"var(--c1)\",v:v}],lab);\n      legend(\"cash\",[{n:\"Cash and bank\",c:\"var(--c1)\"}],\n        '<span style=\"color:var(--ink-3)\">at each month end</span>');\n    },\n    ageing:function(h){\n      if(!Array.isArray(A.deb)||!Array.isArray(A.cre)){\n        h.innerHTML='<p class=\"cap\">No ageing has been loaded for this client, so there is nothing to age.</p>';\n        return;}\n      const B=[\"Current\",\"31–60 days\",\"61–90 days\",\"Over 90 days\"];\n      barsChart(h,A.deb.map((v,i)=>({n:\"Owed to you · \"+B[i],v:v,c:i===3?\"var(--c5)\":\"var(--c1)\"}))\n        .concat(A.cre.map((v,i)=>({n:\"You owe · \"+B[i],v:v,c:i===3?\"var(--c5)\":\"var(--c2)\"}))),\n        {wide:true});\n    },\n    customer:function(h){\n      const C=custSales(pa,pb).list.filter(x=>x.v>0).sort((x,y)=>y.v-x.v).slice(0,10);\n      if(!C.length){h.innerHTML='<p class=\"cap\">No sales to a customer account in this period.</p>';return;}\n      barsChart(h,C.map((x,i)=>({n:x.name.length>34?x.name.slice(0,34)+\"…\":x.name,\n        v:x.v,c:\"var(--c\"+(i%5+1)+\")\"})),{wide:true});\n    },\n    budget:function(h){\n      const ids=[...SD,...ADM,...FIN].filter(id=>Math.abs(S([id],pa,pb))>0.005||BUsum([id],pa,pb)!==null);\n      if(!budgetEntered()||!ids.length){\n        h.innerHTML='<p class=\"cap\">No budget is keyed for this period, so there is nothing to measure against. '\n          + 'The Budget screen is where it is entered.</p>';\n        return;}\n      columnChart(h,[\n        {n:\"Actual\",c:\"var(--c1)\",v:ids.map(id=>S([id],pa,pb))},\n        {n:\"Budget\",c:\"var(--c2)\",v:ids.map(id=>BUsum([id],pa,pb))}],\n        ids.map(id=>LI[id].name));\n      legend(\"budget\",[{n:\"Actual\",c:\"var(--c1)\"},{n:\"Budget\",c:\"var(--c2)\"}]);\n    }\n  };\n  want.forEach(function(c){\n    const h=document.getElementById('ovch-'+c[0]);\n    if(h&&draw[c[0]])draw[c[0]](h);\n  });\n\n  document.getElementById('ovPeriodNote').innerHTML=\"Figures are for <b>\"+periodLabel(\"ov\")+\"</b>. \"+\n    \"Ledger loaded from \"+lbl(M[0])+\" to \"+lbl(M[NM-1])+\" · \"+\n    D.counts.postings.toLocaleString(\"de-DE\")+\" postings · reported in \"+D.cfg.currency+\n    \" · year end \"+MN[D.cfg.yearEnd-1]+\" · \"+D.cfg.notes;\n}\n" + script.slice(b);

  // §4a: the choice is made where the other per-client choices are made.
  const setupWas = "  document.getElementById('tblSetup').innerHTML=h;";
  if (!script.includes(setupWas)) throw new Error('renderSetup is not where it was.');
  script = script.replace(setupWas, "  document.getElementById('tblSetup').innerHTML=h;\n  /* FIX-3 §4a — the same idiom as the sections above, deliberately: it is\n     the same kind of decision, made in the same sitting. It posts a different\n     message because a chart is not a section — switching one off hides a\n     picture, and the rail must not move because of it. */\n  let ch=`<table><thead><tr><th>Chart</th><th>What it shows</th><th class=\"num\">Setting</th></tr></thead><tbody>`;\n  OVCHARTS.forEach(function(c){\n    var v=ovOn(c[0]);\n    ch+=`<tr><td><b>${c[1]}</b></td><td>${c[2]}</td><td class=\"num\">`\n      +`<button class=\"sgn\" data-chart=\"${c[0]}\" style=\"color:${v?\"var(--good)\":\"var(--ink-3)\"}\">${v?\"on\":\"off\"}</button></td></tr>`;});\n  ch+=\"</tbody></table>\";\n  document.getElementById('tblCharts').innerHTML=ch;\n  document.querySelectorAll('[data-chart]').forEach(function(b){\n    b.addEventListener('click',function(){\n      var k=this.dataset.chart, now=!ovOn(k);\n      if(parent===window){alert(\"Choosing charts works inside the portal.\");return;}\n      if(!D.cfg.charts)D.cfg.charts={};\n      D.cfg.charts[k]=now?1:0;\n      renderSetup();\n      if(!document.getElementById('v-overview').hidden)renderOverview();\n      parent.postMessage({type:\"pcp-chart\",key:CID,feature:k,on:now},\"*\");\n    });\n  });");
}

// ---- patch 22: Expense analysis takes the same columns ----
//
// The fourth screen §2 names is Sales analysis, and it is NOT done here: its
// table runs months down the side with a year earlier beside each, so columns
// there are a different table and belong with the §9 rebuild.
//
// Expenses keeps its sparkline for now. §8a replaces it with real month
// columns; the column list is what §8a needs for "years across" either way.
{
  const [a, b] = cutFn(script, 'renderExp');

// ---- patch 23: a column the partner types into (FIX-3 §3) ----
//
// The store and the arithmetic. The control above resolves and renders it;
// this is what a keyed column IS, and it is appended rather than woven in so
// that deleting this one block removes the feature and nothing else.
script += "\n/* ---------- columns keyed by hand (FIX-3 §3) ---------- */\n/*\n * Sitting with a client the partner needs to put figures in himself and see the\n * arithmetic: a target, a what-if, an agreed adjustment. So one comparison\n * column is typed rather than resolved, and the movement against it is worked\n * out exactly as it is for a column out of the ledger.\n *\n * Four rules, and they are the whole of it:\n *\n *   It belongs to the client AND to the period. The payload carries only this\n *   client's columns, and a column keyed against January to July is offered\n *   when the screen is showing January to July and not otherwise — a target for\n *   seven months is not a target for twelve.\n *\n *   It is named, and more than one can be kept.\n *\n *   It is marked as keyed wherever it appears: on the chip, in the column\n *   heading, and by the fact that its cells are boxes a person types in.\n *\n *   It feeds nothing. No statement, no review, no audit and no return reads\n *   this. Only the profit and loss offers it; the balance sheet and the expense\n *   analysis say so rather than pretending the column is unavailable.\n */\nvar KEYC=null;\nfunction keyStore(){\n  if(!KEYC)KEYC=(D.keyed||[]).map(function(k){\n    return {from:k.from,to:k.to,name:String(k.name),\n            amounts:Object.assign({},k.amounts||{}),saved:true};});\n  return KEYC;\n}\nfunction keyPeriod(id){ var r=periodRange(id); return [M[r[0]],M[r[1]]]; }\nfunction keyFind(id,name){\n  var p=keyPeriod(id);\n  return keyStore().filter(function(k){\n    return k.from===p[0]&&k.to===p[1]&&k.name===name;})[0]||null;\n}\nfunction keyNames(id){\n  var p=keyPeriod(id);\n  return keyStore().filter(function(k){return k.from===p[0]&&k.to===p[1];})\n                   .map(function(k){return k.name;});\n}\n/* A new one is named so it is obviously the partner's to rename, and numbered\n   so keying a second one in the same meeting does not overwrite the first. */\nfunction keyNew(id){\n  var taken=keyNames(id), n=\"Keyed column\", i=1;\n  while(taken.indexOf(n)>=0){ i++; n=\"Keyed column \"+i; }\n  var p=keyPeriod(id), k={from:p[0],to:p[1],name:n,amounts:{},saved:false};\n  keyStore().push(k); return k;\n}\n/* What a keyed column is worth for a set of report lines: the sum of the lines\n   that were actually keyed. A line left blank was NOT keyed, which is not the\n   same as keyed at nought, so a blank column totals to nothing at all rather\n   than to a nought that reads as a figure. */\nfunction keySum(k,ids){\n  var t=null;\n  ids.forEach(function(id){\n    var v=k.amounts[id];\n    if(v!==undefined&&v!==null&&v!==\"\")t=(t||0)+(+v);});\n  return t;\n}\nfunction attrq(s){\n  return String(s).split(\"&\").join(\"&amp;\").split('\"').join(\"&quot;\").split(\"<\").join(\"&lt;\");\n}\n";
  script = script.slice(0, a) + "function renderExp(){\n  periodCtl(\"exp\",\"expCtl\",renderExp);\n  cmpCtl(\"exp\",\"expCmpBar\",renderExp);\n  const [a,i]=periodRange(\"exp\");\n  CMPA=a; CMPB=i;\n  const S=(ids,f,tt)=>ids.reduce((x,id)=>x+PL(id).slice(f,tt+1).reduce((q,w)=>q+w,0),0);\n  const cols=[{label:spanLbl([a,i]),range:[a,i]}].concat(cmpCols(\"exp\"));\n  const cv=(ids,c)=>c.range?S(ids,c.range[0],c.range[1]):(c.budget?BUsum(ids,CMPA,CMPB):null);\n  const revs=cols.map(c=>cv(REV,c));\n\n  const ids=[...SD,...ADM,...FIN];\n  const rows=ids.map(id=>({id,n:LI[id].name,vs:cols.map(c=>cv([id],c)),\n                           m:PL(id).slice(a,i+1)}))\n    .filter(r=>r.vs.some(v=>v!==null&&Math.abs(v)>0.005))\n    .sort((x,y)=>(y.vs[0]||0)-(x.vs[0]||0));\n  const mx=Math.max(...rows.flatMap(r=>r.m.map(Math.abs)),1);\n\n  let h=`<table><thead><tr><th>Line</th>`;\n  cols.forEach(function(c,k){\n    h+=`<th class=\"num\">${c.label}</th><th class=\"num pcol\">% of sales</th>`;\n    if(k>0)h+=`<th class=\"num\">${lblShort(cols[k-1].label)} vs ${lblShort(c.label)}</th>`;\n  });\n  h+=`<th>Monthly shape</th></tr></thead><tbody>`;\n\n  rows.forEach(r=>{\n    const w=520/Math.max(1,r.m.length);\n    const spark=`<svg viewBox=\"0 0 520 26\" style=\"width:190px\"> ${r.m.map((v,k)=>{\n      const hh=Math.max(1.5,Math.abs(v)/mx*22);\n      return `<rect x=\"${(k*w+1).toFixed(1)}\" y=\"${(24-hh).toFixed(1)}\" width=\"${(w-2).toFixed(1)}\" height=\"${hh.toFixed(1)}\" rx=\"2\" fill=\"var(--c1)\" opacity=\"${v<0?.35:.85}\"><title>${lbl(M[a+k])}: ${eur(v)}</title></rect>`}).join(\"\")}</svg>`;\n    let cells=\"\";\n    r.vs.forEach(function(v,k){\n      const rv=revs[k];\n      cells+=`<td class=\"num\">${v===null?\"—\":eur(v)}</td>`\n           + `<td class=\"num pcol\">${(v===null||rv===null||Math.abs(rv)<1)?\"—\":(v/rv*100).toFixed(1)+\"%\"}</td>`;\n      if(k>0){const l=r.vs[k-1], d=(l===null||v===null)?null:l-v;\n        cells+=`<td class=\"num\">${d===null?\"—\":eur(d)}</td>`;}\n    });\n    h+=`<tr><td>${r.n}</td>${cells}<td>${spark}</td></tr>`;});\n  h+=\"</tbody></table>\";\n  document.getElementById('tblExp').innerHTML=h;\n  notes(\"expNotes\",\"exp\");\n}\n" + script.slice(b);
}

// ---- patch 21: the profit and loss takes the same columns ----
//
// FIX-3 §2 wants the list on Profit & loss as well as the Balance sheet, with
// the budget among the choices (§2c) and each movement named for the two
// columns it sits between (§2d). The old function resolved ONE comparison out
// of a dropdown and hard-coded seven columns of markup, so it is replaced
// rather than widened.
{
  const [a, b] = cutFn(script, 'renderPl');
  script = script.slice(0, a) + "/* Where the cursor should land after a keyed figure is entered. Typing a column\n   re-renders it — that is how the totals and the variance move as you go — and\n   without this the cursor would come back to the top of the screen on every\n   line, which is unusable in front of a client. */\nvar KEYFOCUS=null;\n/* The practice writes 1.234,56. Somebody keying quickly may write 1234.56, and\n   may write 1.234 meaning a thousand. Read the comma as the decimal where there\n   is one; otherwise dots in groups of three are thousands and a lone dot is the\n   decimal point. */\nfunction keyNum(t){\n  t=String(t).trim().split(\" \").join(\"\").split(\" \").join(\"\");\n  if(!t)return null;\n  if(t.indexOf(\",\")>=0)t=t.split(\".\").join(\"\").split(\",\").join(\".\");\n  else if(/^-?\\d{1,3}(\\.\\d{3})+$/.test(t))t=t.split(\".\").join(\"\");\n  var n=Number(t);\n  return isFinite(n)?n:null;\n}\n\nfunction renderPl(){\n  periodCtl(\"pl\",\"plCtl\",renderPl);\n  cmpCtl(\"pl\",\"plCmpBar\",renderPl,{hand:true});\n  const [a1,b1]=periodRange(\"pl\");\n  CMPA=a1; CMPB=b1;\n  const S=(ids,f,tt)=>ids.reduce((x,id)=>x+PL(id).slice(f,tt+1).reduce((q,w)=>q+w,0),0);\n\n  /* Column one is the period on screen; the rest are the list the person has\n     built. A column that cannot be answered keeps its place, so the movement\n     headings opposite it still name the right two columns. */\n  const cols=[{label:spanLbl([a1,b1]),range:[a1,b1]}].concat(cmpCols(\"pl\",{hand:true}));\n  const cv=(ids,c)=>c.hand?keySum(c.col,ids)\n                          :(c.range?S(ids,c.range[0],c.range[1])\n                                   :(c.budget?BUsum(ids,CMPA,CMPB):null));\n  /* A budget may be keyed on some lines and not others. Nothing keyed at all is\n     not an answer and prints as none; something keyed is answered with what is\n     there, rather than with a nought that reads as a figure. */\n  const sub=(x,y)=>(x===null&&y===null)?null:((x||0)-(y||0));\n  const revs=cols.map(c=>cv(REV,c));\n  /* With a column being typed, every line is shown whether or not the ledger\n     has anything on it: a what-if may put a figure against a line this client\n     has never posted, and a hidden row cannot be typed into. */\n  const typing=cols.some(c=>c.hand);\n\n  const span=1+cols.length*2+(cols.length-1)*2;\n  let h=`<table><thead><tr><th>Line</th>`;\n  cols.forEach(function(c,k){\n    h+=`<th class=\"num\">${c.label}${c.hand?' <em class=\"kmark\">keyed</em>':''}</th><th class=\"num pcol\">%</th>`;\n    if(k>0)h+=`<th class=\"num\">${lblShort(cols[k-1].label)} vs ${lblShort(c.label)}</th><th class=\"num\">%</th>`;\n  });\n  h+=`</tr></thead><tbody>`;\n\n  /* Percentages are of that column's own revenue, so a comparison year is read\n     against its own sales and not against this year's. */\n  function cells(vs,line){\n    let out=\"\";\n    vs.forEach(function(v,k){\n      const c=cols[k], r=revs[k];\n      if(c.hand&&line){\n        const raw=c.col.amounts[line];\n        out+=`<td class=\"num\"><input class=\"keyin\" data-l=\"${line}\" data-k=\"${k}\"`\n           + ` value=\"${raw===undefined||raw===null?\"\":raw}\"></td>`;\n      }else{\n        out+=`<td class=\"num\">${v===null?\"—\":eur(v)}</td>`;\n      }\n      out+=`<td class=\"num pcol\">${(v===null||r===null||Math.abs(r)<1)?\"—\":(v/r*100).toFixed(1)+\"%\"}</td>`;\n      if(k>0){\n        const l=vs[k-1], d=(l===null||v===null)?null:l-v,\n              p=(l===null||v===null||Math.abs(v)<1)?null:(l/v-1)*100;\n        out+=`<td class=\"num\">${d===null?\"—\":eur(d)}</td><td class=\"num\">${pct(p)}</td>`;\n      }\n    });\n    return out;\n  }\n  const row=(nm,vs,strong)=>{h+=`<tr${strong?' class=\"sub\"':''}><td>${nm}</td>`+cells(vs)+`</tr>`;};\n  const sec=(title,ids,totName)=>{\n    h+=`<tr class=\"sec\"><td colspan=\"${span}\">${title}</td></tr>`;\n    ids.forEach(id=>{const vs=cols.map(c=>cv([id],c));\n      if(!typing&&vs.every(v=>v===null||Math.abs(v)<0.005))return;\n      h+=`<tr><td>${LI[id].name}</td>`+cells(vs,id)+`</tr>`;});\n    row(totName,cols.map(c=>cv(ids,c)),true);};\n\n  sec(\"Revenue\",REV,\"Total revenue\"); sec(\"Cost of sales\",COS,\"Total cost of sales\");\n  row(\"Gross profit\",cols.map(c=>sub(cv(REV,c),cv(COS,c))),true);\n  sec(\"Other income\",OI,\"Total other income\");\n  sec(\"Selling and distribution\",SD,\"Total selling and distribution\");\n  sec(\"Administration\",ADM,\"Total administration\");\n  sec(\"Finance costs\",FIN,\"Total finance costs\");\n  row(\"Profit before tax\",cols.map(function(c){\n    const p=[cv(REV,c),cv(COS,c),cv(OI,c),cv(SD,c),cv(ADM,c),cv(FIN,c)];\n    if(p.every(x=>x===null))return null;\n    return (p[0]||0)-(p[1]||0)+(p[2]||0)-(p[3]||0)-(p[4]||0)-(p[5]||0);}),true);\n  h+=\"</tbody></table>\";\n  const host=document.getElementById('tblPl');\n  host.innerHTML=h;\n\n  if(typing){\n    const box=[].slice.call(host.querySelectorAll(\".keyin\"));\n    box.forEach(function(x,n){\n      x.addEventListener(\"change\",function(){\n        const c=cols[+x.dataset.k], line=x.dataset.l, val=keyNum(x.value);\n        /* Blank is not nought. A line left empty was not keyed, and it is left\n           out of the column's total rather than pulling it down to nothing. */\n        if(val===null)delete c.col.amounts[line]; else c.col.amounts[line]=val;\n        c.col.saved=false;\n        const nx=box[n+1];\n        KEYFOCUS=nx?{k:nx.dataset.k,l:nx.dataset.l}:null;\n        renderPl();});\n      x.addEventListener(\"keydown\",function(e){ if(e.key===\"Enter\")x.blur(); });\n    });\n    if(KEYFOCUS){\n      const back=host.querySelector('.keyin[data-k=\"'+KEYFOCUS.k+'\"][data-l=\"'+KEYFOCUS.l+'\"]');\n      KEYFOCUS=null;\n      if(back){back.focus();back.select();}\n    }\n  }\n  notes(\"plNotes\",\"pl\");\n}\n" + script.slice(b);
}

// A function replaced whole ends at the first closing brace in column one:
// every function in the template is top level and everything inside one is
// indented. "Up to the next function declaration" was the first rule tried and
// it silently swallowed the VAT constants sitting between renderExp and the
// function after it — valid JavaScript, and a screen that throws on open.
function cutFn(script, name) {
  const open = 'function ' + name + '(';
  const a = script.indexOf(open);
  if (a < 0) throw new Error(name + ' is not where it was.');
  const b = script.indexOf('\n}\n', a + open.length);
  if (b < 0) throw new Error('the end of ' + name + ' could not be found.');
  return [a, b + 3];
}
// ---- patch 20: the balance sheet takes as many columns as wanted ------
//
// FIX-3 §2a, and the case it calls the plain one: August 2026 beside December
// 2025 and December 2024 -- the current position against the last two audited
// year ends. COMPARE WITH offered one column and one answer.
//
// Movement sits against the column to its LEFT and its heading says which two
// it compares (§2d), because three columns across otherwise read as one pair
// and a spare.

{
  const [a, b] = cutFn(script, 'renderBs');
  script = script.slice(0, a) + "function renderBs(){\n  periodCtl(\"bs\",\"bsCtl\",renderBs,{asAt:true,mode:\"month\"});\n  cmpCtl(\"bs\",\"bsCmpBar\",renderBs,{asAt:true});\n  const i=periodRange(\"bs\")[1], m=M[i];\n  CMPA=i; CMPB=i;\n  const cum=j=>{const a=ytdStart(j);\n    return sumL(REV,a,j)-sumL(COS,a,j)+sumL(OI,a,j)-sumL(SD,a,j)-sumL(ADM,a,j)-sumL(FIN,a,j);};\n  const val=(id,j)=>id===\"B-650\"?cum(j):BS(id)[j];\n  const secTot=(pre,j)=>D.lines.filter(l=>l.id.startsWith(pre)&&!l.sub&&l.id!==\"B-640\")\n    .reduce((t,l)=>t+val(l.id,j),0);\n  const plug=j=>{\n    const na=secTot(\"B-0\",j)+secTot(\"B-1\",j)-secTot(\"B-2\",j)-secTot(\"B-4\",j);\n    return na-secTot(\"B-6\",j);};\n  const get=(id,j)=>id===\"B-640\"?plug(j):val(id,j);\n\n  /* Every column, the position on screen first. A balance sheet column is one\n     month end, so a comparison is the position at that month and nothing else. */\n  const cols=[{label:lbl(m),at:i}].concat(cmpCols(\"bs\",{asAt:true}).map(function(c){\n    return c.missing?{label:c.label,missing:c.missing}\n                    :(c.budget?{label:c.label,missing:\"a balance sheet has no budget\"}\n                              :{label:c.label,at:c.range[1]});\n  }));\n  const at=(id,c)=>c.missing?null:get(id,c.at);\n\n  const secs=[[\"Non-current assets\",\"B-0\"],[\"Current assets\",\"B-1\"],[\"Current liabilities\",\"B-2\"],[\"Non-current liabilities\",\"B-4\"],[\"Equity\",\"B-6\"]];\n  /* Movement sits against the column to its LEFT and the heading says which two\n     it compares, so three columns across read as two movements and not as one\n     unexplained pair. */\n  const span=1+(cols.length-1)*2;\n  let h=`<table><thead><tr><th>Line</th>`;\n  cols.forEach(function(c,k){\n    h+=`<th class=\"num\">${c.label}</th>`;\n    if(k>0)h+=`<th class=\"num\">${lblShort(cols[k-1].label)} vs ${lblShort(c.label)}</th>`;\n  });\n  h+=`</tr></thead><tbody>`;\n\n  const tot={};\n  secs.forEach(([nm,pre])=>{\n    h+=`<tr class=\"sec\"><td colspan=\"${span+1}\">${nm}</td></tr>`;\n    const running=cols.map(()=>0);\n    D.lines.filter(l=>l.id.startsWith(pre)&&!l.sub).forEach(l=>{\n      const vs=cols.map(c=>at(l.id,c));\n      vs.forEach((v,k)=>{ if(v!==null)running[k]+=v; });\n      if(vs.every(v=>v===null||Math.abs(v)<0.005))return;\n      h+=`<tr><td>${l.name}</td>`+cells(vs)+`</tr>`;\n    });\n    tot[pre]=running;\n    h+=`<tr class=\"sub\"><td>${nm}</td>`+cells(running)+`</tr>`;\n  });\n\n  function cells(vs){\n    let out=\"\";\n    vs.forEach(function(v,k){\n      out+=`<td class=\"num\">${v===null?\"—\":eur(v)}</td>`;\n      if(k>0){\n        const l=vs[k-1], mv=(l===null||v===null)?null:l-v;\n        out+=`<td class=\"num\"${mv!==null&&Math.abs(mv)>0.005?' style=\"color:var(--ink-2)\"':''}>${mv===null?\"—\":eur(mv)}</td>`;\n      }\n    });\n    return out;\n  }\n\n  const netAssets=cols.map((c,k)=>c.missing?null:\n    (tot[\"B-0\"][k]+tot[\"B-1\"][k]-tot[\"B-2\"][k]-tot[\"B-4\"][k]));\n  h+=`<tr class=\"tot\"><td>Net assets</td>`+cells(netAssets)+`</tr>`;\n  h+=\"</tbody></table>\";\n  /* FIX-3 §6 — the headline few, under the sheet they are drawn from. */\n  document.getElementById('tblBs').innerHTML=h+bsRatioFoot(cols);\n  notes(\"bsNotes\",\"bs\");\n}\n/* \"Aug 26\" out of \"Aug 26\" or \"Jan 26–Aug 26\": a movement heading names two\n   points, not two spans, or it will not fit. */\nfunction lblShort(s){ const p=String(s).split(\"–\"); return p[p.length-1]; }\n" + script.slice(b);
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
.perwhat{flex-basis:100%;margin-top:8px}
/* FIX-3 1c — the resolved range is the headline; what qualifies it sits under. */
.perrange{display:block;font-size:15.5px;font-weight:700;color:var(--ink)}
.perside{display:block;font-size:12.5px;color:var(--ink-2);margin-top:2px}

/* FIX-3 §2 — comparison columns are a list, so they read as a list. */
.cmpbar{align-items:flex-start}
.cmpchips{display:flex;flex-wrap:wrap;gap:6px;margin-right:8px}
.cmpchip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;
  padding:3px 6px 3px 10px;border:1px solid var(--rule);border-radius:999px;
  background:var(--surface)}
.cmpchip.bad{border-color:var(--warn);color:var(--ink-2)}
.cmpchip em{font-style:normal;font-size:11px;color:var(--ink-3)}
.cmpx{border:none;background:none;cursor:pointer;color:var(--ink-3);font-size:14px;
  line-height:1;padding:0 2px}
.cmpx:hover{color:var(--crit)}
.cmpnone{font-size:12.5px;color:var(--ink-3)}

/* FIX-3 §3 — a keyed column is marked as keyed everywhere it appears. */
.cmpchip.hand{border-color:var(--c2);background:var(--surface-2,var(--surface))}
.cmpname{font:inherit;font-size:12.5px;font-weight:600;border:none;background:none;
  color:var(--ink);width:11ch;padding:0}
.cmpname:focus{outline:1px solid var(--rule);border-radius:3px}
.cmpsave,.cmpforget{font:inherit;font-size:11.5px;border:1px solid var(--rule);
  border-radius:4px;background:var(--surface);cursor:pointer;padding:1px 6px}
.cmpforget{color:var(--crit)}
.kmark{font-style:normal;font-size:10.5px;font-weight:600;color:var(--c2);
  text-transform:uppercase;letter-spacing:.04em}
.keyin{font:inherit;font-variant-numeric:tabular-nums;text-align:right;width:11ch;
  border:1px solid var(--rule);border-radius:4px;padding:1px 4px;background:var(--surface)}
.keyin:focus{outline:2px solid var(--c2);outline-offset:-1px}

/* FIX-3 §4c — the month row reads as a second row, not a longer first one. */
.ovmonthnote{margin:18px 0 6px;font-weight:600;color:var(--ink-2)}
#ovMonthRow .tile{background:var(--surface)}
/* §4a — every chart is full width now, so they stack. */
.ovcard{margin-bottom:16px}
.setuph{margin:26px 0 4px}

/* FIX-3 §6 — the two figures a ratio is made from sit under it, quieter than
   the ratio itself but legible: they are the reason it can be believed. */
.rpart td{color:var(--ink-2);font-size:12.5px}
.rpart td:first-child{padding-left:22px}
.rwhy{color:var(--ink-3);font-size:12px;font-style:italic;font-weight:400}
.bsrh{margin:26px 0 4px}

/* FIX-3 §7 — a figure on this screen is a question, so it looks like one. */
.cioc{cursor:pointer}
.cioc:hover{background:var(--grid)}
.cioc.on{background:var(--ink);color:var(--paper)}
.avgc{color:var(--ink-2);border-left:1px solid var(--rule)}

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
let assembled =
  head +
  html.slice(0, dataStart) +            // everything up to and including the afdata open tag
  '__PAYLOAD__' +
  html.slice(dataEnd, appOpen) +        // </script> and whatever sits between the two
  '<script src="__APP_JS__"></script>' +
  html.slice(appEnd + '</script>'.length);

// FIX-3 §2 — the Compare-with dropdowns become hosts the column list renders
// into. Markup, patched on the ASSEMBLED shell for the same reason the
// stylesheet is: every offset above was measured on the unpatched html.
{
  // The sentence under each heading described the one dropdown that used to be
  // there. FIX-3 §2 replaced it with a list, so the sentence is replaced too.
  const SUBS = [
    [
      "Month and year to date against the same period last year, with the variance in value and percent.",
      "Month and year to date, against as many comparison columns as are chosen — a period end, a preceding period, or a keyed budget — with the movement and percent against the column to the left of each."
    ],
    [
      "At the month end selected, against the same month last year. Prior year results sit unposted while the audit is open &#8212; line B-640 &#8212; which is what makes the statement balance.",
      "At the month end selected, against as many earlier month ends as are chosen — the last two audited year ends beside the current position, if that is the conversation. Prior year results sit unposted while the audit is open &#8212; line B-640 &#8212; which is what makes the statement balance."
    ],
    [
      "Overheads by line for the year to date, with the monthly shape beside each and the movement against last year.",
      "Overheads by line, with the monthly shape beside each and a movement against every comparison column chosen."
    ]
  ];
  for (const [was, now] of SUBS) {
    if (!assembled.includes(was)) throw new Error('a screen subtitle is not where it was: ' + was.slice(0, 40));
    assembled = assembled.replace(was, now);
  }
}
{
  // FIX-3 §4c — a second row of boxes for the month being worked on, under
  // the year-to-date row. The top row answers how the year is going; this one
  // answers how the month closed.
  const tiles = '<div class="tiles" id="ovTiles"></div>';
  if (!assembled.includes(tiles)) throw new Error('the overview tiles are not where they were.');
  assembled = assembled.replace(tiles, tiles
    + '<p class="sub ovmonthnote" id="ovMonthNote"></p>'
    + '<div class="tiles" id="ovMonthRow"></div>');

  // FIX-3 §4a — the charts are chosen per client, so the cards cannot sit in
  // the markup: a card whose chart is switched off has to be GONE, not empty.
  // Everything from the pair of cards to the end of the waterfall becomes one
  // host that renderOverview fills with whatever this client was given.
  const wfMark = '<div id="chWaterfall"></div>';
  const gs = assembled.indexOf('<div class="grid2">', assembled.indexOf('id="v-overview"'));
  const wf = assembled.indexOf(wfMark, gs);
  if (gs < 0 || wf < 0) throw new Error('the overview charts are not where they were.');
  const ge = assembled.indexOf('</div>', wf + wfMark.length);
  if (ge < 0) throw new Error('the waterfall card is not closed where expected.');
  assembled = assembled.slice(0, gs) + '<div id="ovCharts"></div>'
    + assembled.slice(ge + '</div>'.length);

  // and the charts get their own table on Client setup, beside the sections.
  const st = '<div class="tw" id="tblSetup"></div>';
  if (!assembled.includes(st)) throw new Error('the Client setup table is not where it was.');
  assembled = assembled.replace(st, st
    + '<h3 class="setuph">Charts on the overview</h3>'
    + '<p class="sub">Which pictures this client gets on the front page. The choice is '
    + 'kept for this client, like the switches above.</p>'
    + '<div class="tw" id="tblCharts"></div>');
}

{
  // FIX-3 §5 — the management summary gains a month range and a switch for
  // the percentages. YEAR stays where it is; these sit beside it.
  const sy = '<label class="ctl" for="sumYear">Year</label><select id="sumYear"></select>';
  if (!assembled.includes(sy)) throw new Error('the summary year control is not where it was.');
  assembled = assembled.replace(sy, sy
    + '<label class="ctl" for="sumFrom">From</label><select id="sumFrom"></select>'
    + '<label class="ctl" for="sumTo">To</label><select id="sumTo"></select>'
    + '<button class="perbtn" id="sumPct"></button>'
    + '<span class="perwhat"><span class="perside" id="sumWhat"></span></span>');

  // and the summary had no home for its notes, so notes() was writing into
  // nothing every time the screen was drawn.
  const stb = '<div class="tw" id="tblSummary"></div>';
  if (!assembled.includes(stb)) throw new Error('the summary table is not where it was.');
  assembled = assembled.replace(stb, stb + '<div id="summaryNotes"></div>');
}

{
  // FIX-3 §6 — ratios need the profit and loss as well as the balance sheet,
  // so they get a screen rather than a corner of one. It sits after the
  // balance sheet on the rail, which is where somebody looks for it.
  const tab = '<button role="tab" aria-selected="false" data-v="cash">Cash flow</button>';
  if (!assembled.includes(tab)) throw new Error('the rail is not where it was.');
  assembled = assembled.replace(tab,
    '<button role="tab" aria-selected="false" data-v="ratios">Ratios</button>' + tab);

  const before = '<section id="v-cash"';
  if (!assembled.includes(before)) throw new Error('the cash flow screen is not where it was.');
  assembled = assembled.replace(before, [
    '<section id="v-ratios" hidden>',
    '<h2>Ratios</h2>',
    '<p class="sub">Liquidity, efficiency, profitability, gearing and growth, across the same '
      + 'columns as the statements. Every ratio shows the two figures it is made from, and one '
      + 'that cannot be worked out says why rather than printing a nought.</p>',
    '<div class="controls" id="raCtl"></div>',
    '<div class="chartbar cmpbar" id="raCmpBar"></div>',
    '<div class="tw" id="tblRatios"></div>',
    '<div class="note" id="raNote"></div>',
    '<div id="ratiosNotes"></div>',
    '</section>',
    ''].join('') + before);
}

{
  // FIX-3 §7 — the direct statement, next to the indirect one on the rail.
  const tab = '<button role="tab" aria-selected="false" data-v="exp">Expenses</button>';
  if (!assembled.includes(tab)) throw new Error('the Expenses tab is not where it was.');
  assembled = assembled.replace(tab,
    '<button role="tab" aria-selected="false" data-v="cashio">Cash in and out</button>' + tab);

  const before = '<section id="v-exp"';
  if (!assembled.includes(before)) throw new Error('the expenses screen is not where it was.');
  assembled = assembled.replace(before, [
    '<section id="v-cashio" hidden>',
    '<h2>Cash in and out</h2>',
    '<p class="sub">Money in and money out, month by month, by where it actually went. '
      + 'The Cash flow screen explains the movement; this one lists it. Press any figure '
      + 'to see who is behind it.</p>',
    '<div class="controls">'
      + '<label class="ctl" for="cioYear">Year</label><select id="cioYear"></select>'
      + '<label class="ctl" for="cioBank">Account</label><select id="cioBank"></select>'
      + '</div>',
    '<div class="tw" id="tblCashIO"></div>',
    '<div id="cioWho"></div>',
    '<div id="cashioNotes"></div>',
    '</section>',
    ''].join('') + before);

  // and the cash flow screen says how the two differ, and where the other is.
  const cf = '<section id="v-cash" hidden>';
  if (!assembled.includes(cf)) throw new Error('the cash flow screen is not where it was.');
  const cfh = assembled.indexOf('</p>', assembled.indexOf(cf));
  if (cfh < 0) throw new Error('the cash flow subtitle is not where it was.');
  assembled = assembled.slice(0, cfh + 4)
    + '<p class="sub">This is the <b>indirect</b> statement: it explains the movement, '
    + 'starting from profit and working back to cash. <b>Cash in and out</b>, on the rail '
    + 'above, is the direct one — it lists the movement, receipt by receipt and payment by '
    + 'payment. One explains, the other lists; they answer to the same closing balance.</p>'
    + assembled.slice(cfh + 4);
}

{
  const ec = '<div class="controls" id="expCtl"></div>';
  if (!assembled.includes(ec)) throw new Error('the Expense analysis controls are not where they were.');
  assembled = assembled.replace(ec, ec + '<div class="chartbar cmpbar" id="expCmpBar"></div>');
}
for (const [id, host] of [["plCmp", "plCmpBar"], ["bsCmp", "bsCmpBar"]]) {
  const from = assembled.indexOf('<div class="chartbar"><label class="ctl" for="' + id + '">');
  if (from < 0) throw new Error(id + ': the Compare with control is not where it was.');
  const to = assembled.indexOf('</select></div>', from);
  if (to < 0) throw new Error(id + ': its select is not closed where expected.');
  assembled = assembled.slice(0, from)
    + '<div class="chartbar cmpbar" id="' + host + '"></div>'
    + assembled.slice(to + '</select></div>'.length);
}

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
