// Phase 3 diagnostic: documents/folders/vendor patterns/credentials/journal types.
import { supabase, signInAsAdmin } from './_lib.mjs';

await signInAsAdmin();

for (const t of ['folders', 'documents', 'vendor_patterns', 'platform_credentials', 'journal_types']) {
  const { error } = await supabase.from(t).select('*', { count: 'exact', head: true });
  console.log(error ? `✗ ${t}: ${error.message}` : `✓ ${t}`);
}

const { data: jt } = await supabase.from('journal_types').select('code,label');
console.log('journal_types seeded:', jt);
