// Quick check: does public.compliance_tasks exist, and do clients have the new VAT cols?
import { supabase, signInAsAdmin } from './_lib.mjs';

await signInAsAdmin();

const r1 = await supabase.from('compliance_tasks').select('id').limit(1);
console.log('compliance_tasks:', r1.error ? '✗ ' + r1.error.message : '✓ exists');

const r2 = await supabase.from('clients').select('id, vat_registered, vat_period_group').limit(1);
console.log('clients.vat_registered/vat_period_group:', r2.error ? '✗ ' + r2.error.message : '✓ exist');
