// =============================================================
// Supabase Edge Function: submit-application
// =============================================================
// Public (no-JWT) endpoint for prospective clients to submit a portal
// application. Inserts into portal_applications via the service role, so the
// table itself stays private. Deploy with "Verify JWT" OFF.
//
// Follow-up: add a captcha / rate-limit before heavy public exposure.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const p = await req.json().catch(() => ({} as any));
    const business_name = (p.business_name || '').trim();
    const email = (p.email || '').trim();
    if (!business_name || !email) return json({ ok: false, error: 'Business name and email are required.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' });
    if (!p.terms_accepted) return json({ ok: false, error: 'You must accept the terms to apply.' });

    const supa = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error } = await supa.from('portal_applications').insert({
      business_name,
      business_type:       p.business_type || null,
      contact_person:      p.contact_person || null,
      email,
      phone:               p.phone || null,
      vat_number:          p.vat_number || null,
      registration_number: p.registration_number || null,
      address:             p.address || null,
      services_wanted:     p.services_wanted || null,
      notes:               p.notes || null,
      terms_accepted:      true,
      status:              'pending',
    });
    if (error) return json({ ok: false, error: error.message });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
