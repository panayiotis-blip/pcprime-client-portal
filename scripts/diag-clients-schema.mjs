// One-off: print one row from public.clients so we can see what columns actually exist.
import { supabase, signInAsAdmin } from './_lib.mjs';

await signInAsAdmin();

const { data, error } = await supabase.from('clients').select('*').limit(1);
if (error) { console.error(error); process.exit(1); }
if (!data?.length) { console.log('No rows.'); process.exit(0); }
console.log('Columns on public.clients:');
for (const k of Object.keys(data[0]).sort()) console.log(' -', k);
