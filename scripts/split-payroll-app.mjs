// Split the KM payroll app into (a) a clean template any client can be given
// and (b) KM's own data, as a row for client_app_data.
//
// The uploaded file carries KM Fix-It-All's real payroll inside the HTML:
// employer details, six named employees with SI/ID numbers, a year of
// timesheet entries, and app logins in plain text. Template HTML is readable
// by any signed-in portal user (see migration 172), so that data must not ship
// in the file — it belongs in the per-client document the portal already
// keeps, where RLS covers it.
//
//   node scripts/split-payroll-app.mjs
//     → payroll-app-template.html   (upload this as the template)
//     → SEED_km_payroll.sql         (run this to give KM their data)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
// The key the template was uploaded under (App Templates shows it on the card).
// Override when it differs: node scripts/split-payroll-app.mjs <app-key>
const APP_KEY = process.argv[2] || 'payroll-2026';
// The key the app stores its document under, inside the per-client record.
// The template is rewritten to use it, so every client shares one name and
// the prepared data lands where the app actually looks.
const STORE_KEY = 'payroll_2026';
const SRC = path.join(ROOT, 'km-payroll-app.html');
let html = readFileSync(SRC, 'utf8');

const must = (cond, msg) => { if (!cond) { console.error('ASSERT FAILED: ' + msg); process.exit(1); } };

// ---- 1. lift the two data blocks out of the source -----------------------
const seedLine = html.match(/^\s*var SEED_ENTRIES = (\{[\s\S]*?\});\s*$/m);
must(seedLine, 'SEED_ENTRIES not found');
const entries = JSON.parse(seedLine[1]);

const defStart = html.indexOf('var DEFAULTS={');
must(defStart > 0, 'DEFAULTS not found');
// Walk to the matching close brace so the whole literal comes with us.
let i = html.indexOf('{', defStart), depth = 0, end = -1;
for (let j = i; j < html.length; j++) {
  if (html[j] === '{') depth++;
  else if (html[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
}
must(end > 0, 'DEFAULTS literal not balanced');
const defaultsLiteral = html.slice(i, end);

// ---- 2. the clean template ----------------------------------------------
// Same app, no client in it: blank employer, no employees, no entries, and a
// single admin login the firm changes on handover.
const BLANK = `{
    employer:{name:"",reg:"",tic:"",siReg:"",address:"",phone:"",email:"",contact:"",contactTel:""},
    employees:[],
    rates:{siEE:8.8, siER:8.8, holER:8, redER:1.2, itfER:0.5, scfER:2, ghsEE:2.65, ghsER:2.9},
    params:{stdDay:8, stdMonth:176, capMonth:5742, capWeek:1325, ghsCapYear:180000, recording:"exceptions",
      stdBasis:"calendar", weekEnd:6, payLag:7},
    paye:{enabled:true, borneBy:"employee", method:"td59", periods:13, employerType:"Private Sector",
      bands:[{upTo:22000,rate:0},{upTo:32000,rate:20},{upTo:42000,rate:25},{upTo:72000,rate:30},{upTo:0,rate:35}]},
    holidays:defaultHolidays(),
    updated:null, entries:{}
  }`;

let clean = html.slice(0, i) + BLANK + html.slice(end);

// ---- 2a. drop the app's own login --------------------------------------
// The app shipped its own user list and sign-in screen (Admin/Admin in plain
// text). Inside the portal that is both redundant and weaker than the door it
// sits behind: the portal already authenticated the person and decided, via
// their app grant, whether they may open this client's payroll at all. A second
// password adds nothing, and a shared one that everybody knows subtracts.
//
// So the app now takes its identity from the portal instead: the host sends
// role + name with the document, the shim hands them over, and a grant of
// 'viewer' lands as the app's read-only role.
const loginGate = `if(!me){ $app.classList.add("locked"); $tabs.innerHTML=""; $menu.innerHTML=""; $stamp.textContent=""; $acctName.textContent="—"; viewLogin(); return; }`;
must(clean.includes(loginGate), 'login gate not found — has render() changed?');
clean = clean.replace(loginGate, `if(!me){ me=portalUser(); }`);

// Identity from the host. Falls back to a read-only stub when the app is
// opened outside the portal, so it can never be MORE permissive standalone.
const portalUserFn = `
  // Identity comes from the portal (see /api/app-frame): it authenticated the
  // user and its grant decides what they may do here.
  function portalUser(){
    var p=(window.__portalUser||null);
    if(!p) return {name:"Preview", role:"client"};
    return {name:p.name||"Portal user", role:(p.role==="viewer"?"client":"admin")};
  }
`;
clean = clean.replace('  function isAdmin(){', portalUserFn + '  function isAdmin(){');

// The sign-in screen and the in-app user admin have nothing left to do; the
// portal's Access panel is where people are added and removed now. Take the
// menu entry with them, or it leads to a blank screen.
clean = clean.replace(`    else if(view==="users") viewUsers();\n`, '');
must(clean.includes(`["users","👥","Users & access"]`), 'users menu entry not found');
clean = clean.replace(`,["users","👥","Users & access"]`, '');
clean = clean.replace(`if(!isAdmin() && (view==="setup"||view==="users"||view==="empcard"||view==="employees")) view="sheet";`,
                      `if(!isAdmin() && (view==="setup"||view==="empcard"||view==="employees")) view="sheet";`);

// "Log out" belonged to the app's own session. The portal's own chrome carries
// logging out; leaving a dead one here just confuses.
const logoutItem = `    var lo=document.createElement("button"); lo.className="out"; lo.innerHTML='<span class="ic">⏻</span>Log out';`;
if (clean.includes(logoutItem)) {
  const at = clean.indexOf(logoutItem);
  const stop = clean.indexOf('\n', clean.indexOf('lo.onclick', at));
  const tail = clean.slice(stop);
  const appendLine = tail.match(/^\s*\$menu\.appendChild\(lo\);\s*$/m);
  clean = clean.slice(0, at) + (appendLine ? tail.replace(appendLine[0], '') : tail);
}
clean = clean.replace(/^\s*var SEED_ENTRIES = \{[\s\S]*?\};\s*$/m, '  var SEED_ENTRIES = {};  // per-client data lives in the portal, not in the template\n');
// The storage key must not be KM's, or two clients would share a document key.
clean = clean.replace('var KEY="km_payroll_2026"', 'var KEY="'+STORE_KEY+'"');
must(clean.includes('var KEY="'+STORE_KEY+'"'), 'template storage key not rewritten');


// Both screens are unreachable now; leaving a sign-in form in a file the whole
// firm can read only invites someone to wire it back up.
for (const fn of ["viewLogin", "viewUsers"]) {
  const at = clean.indexOf("  function " + fn + "(");
  must(at > 0, fn + " not found");
  let d = 0, started = false, j = at;
  for (; j < clean.length; j++) {
    if (clean[j] === "{") { d++; started = true; }
    else if (clean[j] === "}") { d--; if (started && d === 0) { j++; break; } }
  }
  clean = clean.slice(0, at) + clean.slice(j);
}


// Nothing declares a user list now, so the two places that still reach for one
// would throw on boot (JSON.parse(JSON.stringify(undefined))).
must(clean.includes("me=S.users[0];"), "debug boot hook not found");
clean = clean.replace("me=S.users[0];", "me=portalUser();");
const normalise = clean.match(/^[ \t]*if\(!S\.users\|\|!S\.users\.length\)[^\n]*\n/m);
must(normalise, 'user normaliser not found');
clean = clean.replace(normalise[0], '');
must(!/S\.users/.test(clean), 'S.users still referenced');

must(!/FIX-IT-ALL/i.test(clean), 'employer name still present in the template');
must(!/ANDREOU ANDRI|GEORGIOU GEORGIOS|PERLOG NICANDROU/.test(clean), 'employee names still present');
must(!/01549542|3319036/.test(clean), 'SI numbers still present');
writeFileSync(path.join(ROOT, 'payroll-app-template.html'), clean);

// ---- 3. KM's document, in the shape window.storage persists --------------
// The shim in /api/app-frame keeps the app's key/value pairs as one JSON doc;
// the app writes JSON.stringify(state) under its KEY. KM keeps the original
// key so an existing saved document (if any) still resolves.
const state = { __rebuild: true };
const doc = {};
void state; void doc;

// Rebuilding the state literal by hand would drift from the app; instead ship
// the DEFAULTS literal exactly as the app declares it, evaluated with the real
// entries, so what KM gets is byte-for-byte what the app would have seeded.
const evalSrc = `
  function defaultHolidays(){ return ${JSON.stringify(extractHolidays(html))}; }
  var SEED_ENTRIES = ${JSON.stringify(entries)};
  return ${defaultsLiteral};
`;
// eslint-disable-next-line no-new-func
const kmState = Function(evalSrc)();
must(kmState.employees.length === 6, 'expected 6 KM employees, got ' + kmState.employees.length);
must(Object.keys(kmState.entries).length > 0, 'KM entries did not carry over');

// The app no longer has its own login, so the stored user list is dead weight —
// and it held passwords in plain text. Drop it rather than seed it into the
// database. Who may open KM's payroll is decided by their app grant.
delete kmState.users;
must(!/"p":"|"users":/.test(JSON.stringify(kmState)), 'app credentials still in the seeded document');

const kmDoc = {}; kmDoc[STORE_KEY] = JSON.stringify(kmState);
must(Object.keys(kmDoc)[0] === (clean.match(/var KEY="([^"]+)"/)||[])[1], 'document key does not match the key the app reads');
const sql = `-- =============================================================
-- Seed: KM Fix-It-All's payroll data
-- Run in Supabase Dashboard → SQL Editor → New Query
-- =============================================================
-- The payroll app is uploaded as a CLEAN template shared by every client; this
-- puts KM's own figures into their per-client document, where RLS protects
-- them. Nothing client-specific lives in the template HTML, which any signed-in
-- portal user can read.
--
-- Set the app key below if you uploaded the template under a different key,
-- then run. Re-running is safe: it replaces KM's document, so do NOT run it
-- after they have started editing, or their work is overwritten.
-- =============================================================

begin;

with target as (
  select id from public.clients
   where name ilike '%FIX%IT%ALL%'
   order by id
   limit 1
)
insert into public.client_app_data (client_id, app_key, data, updated_at)
select t.id, '${APP_KEY}', $seed$${JSON.stringify(kmDoc)}$seed$::jsonb, now()
  from target t
on conflict (client_id, app_key) do update
  set data = excluded.data, updated_at = now();

-- Make sure the app is switched on for them.
with target as (
  select id from public.clients where name ilike '%FIX%IT%ALL%' order by id limit 1
)
insert into public.client_apps (client_id, app_key, enabled)
select t.id, '${APP_KEY}', true from target t
on conflict (client_id, app_key) do update set enabled = true;

commit;

-- Verify — should show KM, the app enabled, and a document with 6 employees:
--   select c.name, ca.enabled,
--          jsonb_array_length((cad.data->>'${STORE_KEY}')::jsonb->'employees') as employees
--     from public.clients c
--     join public.client_apps ca on ca.client_id = c.id and ca.app_key = '${APP_KEY}'
--     left join public.client_app_data cad on cad.client_id = c.id and cad.app_key = '${APP_KEY}'
--    where c.name ilike '%FIX%IT%ALL%';
-- =============================================================
`;
writeFileSync(path.join(ROOT, 'SEED_km_payroll.sql'), sql);

console.log('payroll-app-template.html  — clean, upload this as the template');
console.log('  employees in template :', 0);
console.log('SEED_km_payroll.sql        — KM\'s data for client_app_data');
console.log('  employees              :', kmState.employees.length);
console.log('  employees with entries :', Object.keys(kmState.entries).length);
console.log('  document size          :', Math.round(JSON.stringify(kmDoc).length / 1024) + ' KB');

// The holiday table is a function in the app; lift its literal so the rebuilt
// state matches what the app itself would produce.
function extractHolidays(src) {
  const m = src.match(/function defaultHolidays\(\)\{\s*return (\[[\s\S]*?\]);/);
  if (!m) return [];
  // eslint-disable-next-line no-new-func
  return Function('return ' + m[1])();
}
