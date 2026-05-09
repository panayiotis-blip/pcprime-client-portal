// Reads server/db/portal.db and emits INSERT statements for public.clients
// Usage: node scripts/export-clients-sql.mjs > supabase/migrations/002_seed_clients.sql
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'server', 'db', 'portal.db');
const db = new Database(dbPath, { readonly: true });

const cols = [
  'id','client_code','name','trading_name','tax_number','vat_number','registration_number',
  'employer_number','ergani_number','social_insurance_number','id_number','passport_number',
  'contact_person','director_name','business_type','services','monthly_fee','status',
  'address','phone','email','kyc_completed','kyc_expiry_date','kyc_notes','created_at','updated_at'
];

// Build SELECT with only the columns that exist in SQLite
const info = db.prepare(`PRAGMA table_info(clients)`).all();
const existing = new Set(info.map(c => c.name));
const selectCols = cols.filter(c => existing.has(c));

const rows = db.prepare(`SELECT ${selectCols.join(',')} FROM clients ORDER BY id`).all();

const esc = (v) => {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};

console.log('-- Auto-generated from SQLite. Paste into Supabase SQL Editor.');
console.log('-- Truncates existing clients + resets sequence to keep IDs aligned.');
console.log('begin;');
console.log('truncate public.clients restart identity cascade;');
console.log('');

for (const r of rows) {
  const vals = selectCols.map(c => {
    const v = r[c];
    if (c === 'kyc_completed') return v ? 'true' : 'false';
    return esc(v);
  });
  console.log(`insert into public.clients (${selectCols.join(',')}) values (${vals.join(',')});`);
}

console.log('');
console.log(`-- Reset bigserial to max id`);
console.log(`select setval(pg_get_serial_sequence('public.clients','id'), coalesce((select max(id) from public.clients), 1));`);
console.log('commit;');
console.log('');
console.log(`-- ${rows.length} rows exported`);

db.close();
