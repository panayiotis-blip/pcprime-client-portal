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
    users:[{u:"Admin",p:"Admin",name:"Administrator",role:"admin"}],
    rates:{siEE:8.8, siER:8.8, holER:8, redER:1.2, itfER:0.5, scfER:2, ghsEE:2.65, ghsER:2.9},
    params:{stdDay:8, stdMonth:176, capMonth:5742, capWeek:1325, ghsCapYear:180000, recording:"exceptions",
      stdBasis:"calendar", weekEnd:6, payLag:7},
    paye:{enabled:true, borneBy:"employee", method:"td59", periods:13, employerType:"Private Sector",
      bands:[{upTo:22000,rate:0},{upTo:32000,rate:20},{upTo:42000,rate:25},{upTo:72000,rate:30},{upTo:0,rate:35}]},
    holidays:defaultHolidays(),
    updated:null, entries:{}
  }`;

let clean = html.slice(0, i) + BLANK + html.slice(end);
clean = clean.replace(/^\s*var SEED_ENTRIES = \{[\s\S]*?\};\s*$/m, '  var SEED_ENTRIES = {};  // per-client data lives in the portal, not in the template\n');
// The storage key must not be KM's, or two clients would share a document key.
clean = clean.replace('var KEY="km_payroll_2026"', 'var KEY="payroll_2026"');

must(!/FIX-IT-ALL/i.test(clean), 'employer name still present in the template');
must(!/ANDREOU ANDRI|GEORGIOU GEORGIOS|PERLOG NICANDROU/.test(clean), 'employee names still present');
must(!/01549542|3319036/.test(clean), 'SI numbers still present');
writeFileSync(path.join(ROOT, 'payroll-app-template.html'), clean);

// ---- 3. KM's document, in the shape window.storage persists --------------
// The shim in /api/app-frame keeps the app's key/value pairs as one JSON doc;
// the app writes JSON.stringify(state) under its KEY. KM keeps the original
// key so an existing saved document (if any) still resolves.
const state = { __rebuild: true };
const doc = { km_payroll_2026: 'PLACEHOLDER' };
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

const kmDoc = { km_payroll_2026: JSON.stringify(kmState) };
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
select t.id, 'payroll', $seed$${JSON.stringify(kmDoc)}$seed$::jsonb, now()
  from target t
on conflict (client_id, app_key) do update
  set data = excluded.data, updated_at = now();

-- Make sure the app is switched on for them.
with target as (
  select id from public.clients where name ilike '%FIX%IT%ALL%' order by id limit 1
)
insert into public.client_apps (client_id, app_key, enabled)
select t.id, 'payroll', true from target t
on conflict (client_id, app_key) do update set enabled = true;

commit;

-- Verify — should show KM, the app enabled, and a document with 6 employees:
--   select c.name, ca.enabled,
--          jsonb_array_length((cad.data->>'km_payroll_2026')::jsonb->'employees') as employees
--     from public.clients c
--     join public.client_apps ca on ca.client_id = c.id and ca.app_key = 'payroll'
--     left join public.client_app_data cad on cad.client_id = c.id and cad.app_key = 'payroll'
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
