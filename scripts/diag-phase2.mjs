// Phase 2 diagnostic: invoice-related tables + invoice-files bucket.
import { supabase, signInAsAdmin } from './_lib.mjs';

async function probe(label, fn) {
  try {
    const r = await fn();
    console.log(`✓ ${label}:`, typeof r === 'object' ? JSON.stringify(r).slice(0, 200) : r);
  } catch (e) {
    console.log(`✗ ${label}:`, e?.message || e);
  }
}

console.log('--- Phase 2 Diagnostic ---');
const { email } = await signInAsAdmin();
console.log(`signed in as ${email}`);

for (const tbl of ['accounts', 'invoices', 'journal_lines', 'invoice_files']) {
  await probe(`table ${tbl}`, async () => {
    const { error } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
    if (error) throw error;
    return { ok: true };
  });
}

await probe('storage bucket invoice-files', async () => {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const bucket = data.find(b => b.id === 'invoice-files');
  if (!bucket) throw new Error('bucket not found');
  return { id: bucket.id, public: bucket.public };
});

console.log('--- done ---');
