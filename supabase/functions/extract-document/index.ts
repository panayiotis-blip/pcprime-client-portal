// =============================================================
// Supabase Edge Function: extract-document
// =============================================================
// Reads a scanned invoice / receipt with Claude (vision) and returns
// structured fields. The portal calls this via
// supabase.functions.invoke('extract-document', ...). If this function is
// unavailable the portal falls back, client-side, to Tesseract + regex.
//
// Required Edge Function secret:
//   ANTHROPIC_API_KEY  — from console.anthropic.com
//
// Model: claude-haiku-4-5 (fast, low cost). Bump MODEL to a Sonnet build
// for higher accuracy on difficult documents.
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_IMAGES = 8;

const TOOL = {
  name: 'record_invoice',
  description: 'Record the data extracted from a supplier invoice or receipt.',
  input_schema: {
    type: 'object',
    properties: {
      vendor_name:    { type: 'string', description: 'Supplier / seller name (the party that ISSUED the document).' },
      invoice_number: { type: 'string' },
      invoice_date:   { type: 'string', description: 'ISO date YYYY-MM-DD' },
      due_date:       { type: 'string', description: 'ISO date YYYY-MM-DD' },
      currency:       { type: 'string', description: '3-letter code, e.g. EUR' },
      subtotal:       { type: 'number', description: 'Net amount before VAT' },
      vat_amount:     { type: 'number' },
      vat_rate:       { type: 'number', description: 'VAT percentage, e.g. 19' },
      total_amount:   { type: 'number', description: 'Gross total payable' },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            quantity:    { type: 'number' },
            unit_price:  { type: 'number' },
            amount:      { type: 'number' },
            vat_rate:    { type: 'number' },
          },
          required: ['description', 'amount'],
        },
      },
      document_language: { type: 'string', description: 'e.g. en, el' },
      full_text:  { type: 'string', description: 'All text read from the document.' },
      confidence: { type: 'number', description: 'Self-assessed 0-100 overall extraction confidence.' },
      field_confidences: {
        type: 'object',
        description: 'Self-assessed 0-100 confidence per field. Be honest — anything below 70 will be flagged for staff to verify.',
        properties: {
          vendor_name:    { type: 'number' },
          invoice_number: { type: 'number' },
          invoice_date:   { type: 'number' },
          total_amount:   { type: 'number' },
          subtotal:       { type: 'number' },
          vat_amount:     { type: 'number' },
          vat_rate:       { type: 'number' },
          currency:       { type: 'number' },
        },
      },
      field_notes: {
        type: 'array',
        description: 'Short notes flagging anything ambiguous (e.g. "two TOTAL labels — picked the lower one", "thermal receipt heavily faded").',
        items: { type: 'string' },
      },
    },
    required: ['vendor_name', 'total_amount'],
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Authenticate the caller. The gateway's "Verify JWT" must be OFF (so the
    // preflight OPTIONS above can return 200) — we enforce auth HERE instead,
    // so the function is never publicly callable.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const supa = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    const { data: { user } } = token
      ? await supa.auth.getUser(token)
      : { data: { user: null } };
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GDPR control: the firm can disable AI extraction (the only EU→US
    // transfer). Read via the service role so it also applies to client-role
    // callers, who can't read company_settings themselves. On read failure we
    // fall through — the setting defaults to enabled.
    try {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (serviceKey) {
        const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
        const { data: cs } = await admin
          .from('company_settings').select('ai_extract_enabled').eq('id', 1).maybeSingle();
        if (cs && cs.ai_extract_enabled === false) {
          return json({ ok: false, error: 'AI document extraction is disabled in your firm settings.' });
        }
      }
    } catch (_e) { /* fall through — default enabled */ }

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ ok: false, error: 'AI extraction is not configured — ANTHROPIC_API_KEY is missing.' });

    const payload = await req.json().catch(() => ({}));
    const images = Array.isArray(payload.images) ? payload.images : [];
    if (images.length === 0) return json({ ok: false, error: 'No document image was provided.' });

    const content: unknown[] = [];
    for (const img of images.slice(0, MAX_IMAGES)) {
      if (img && typeof img.data === 'string') {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data },
        });
      }
    }
    content.push({
      type: 'text',
      text:
        'Extract the details of this supplier invoice or receipt using the record_invoice tool.\n\n' +
        'OUTPUT RULES\n' +
        '• Amounts as plain numbers (no currency symbols, decimal point ".", no thousands separators). Treat "1.234,56" as 1234.56 (European thousands) and "1,234.56" as 1234.56 (Anglo thousands).\n' +
        '• Dates as ISO YYYY-MM-DD. Documents commonly show DD/MM/YYYY (Cyprus/Greek convention) — convert.\n' +
        '• currency: 3-letter ISO code. "€" or no symbol on a Cyprus document → "EUR".\n' +
        '• vendor_name: the party that ISSUED the document (the supplier / seller / shop / πωλητής / προμηθευτής / "Εκδότης"), NOT the recipient / buyer / "Αγοραστής" / "Πελάτης". The vendor name is at the very TOP of receipts, usually in larger or bolder text.\n' +
        '• total_amount: the GROSS payable (VAT-inclusive). Labels: "TOTAL", "GRAND TOTAL", "Amount Due", "ΣΥΝΟΛΟ", "ΓΕΝΙΚΟ ΣΥΝΟΛΟ", "ΠΛΗΡΩΤΕΟ", "ΤΕΛΙΚΟ ΠΟΣΟ". On a till receipt this is the largest single number near the bottom.\n' +
        '• subtotal: NET amount BEFORE VAT. Labels: "Subtotal", "Net", "Net Amount", "ΑΞΙΑ", "ΚΑΘΑΡΗ ΑΞΙΑ", "ΥΠΟΣΥΝΟΛΟ". This is ALWAYS smaller than total_amount when VAT applies.\n' +
        '• vat_amount: the absolute VAT figure in currency units (e.g. 38.00). Labels: "VAT", "Tax", "ΦΠΑ", "Φ.Π.Α.", "Φόρος". DO NOT put the rate here.\n' +
        '• vat_rate: the percentage (NOT the amount). Cyprus standard rates: 19, 9, 5, 0. If you see "ΦΠΑ 19%" → vat_rate=19, then look elsewhere on the document for the vat_amount in €.\n' +
        '• invoice_number: labels include "Invoice No", "Inv #", "Receipt No", "Α/Α", "Αρ. Τιμολογίου", "Αρ. Απόδειξης". Tills also print a transaction number — that counts.\n' +
        '• If a field truly cannot be read, OMIT it entirely — do not guess. Empty strings count as omission.\n\n' +
        'SANITY CHECK (apply silently — adjust if violated)\n' +
        '• subtotal + vat_amount ≈ total_amount (within 0.05 due to rounding). If your extraction violates this, re-read the document; the most common error is mixing up vat_amount with vat_rate, or picking the wrong "TOTAL" line.\n' +
        '• vat_amount ≈ subtotal × vat_rate / 100. Cross-check both directions.\n\n' +
        'CONFIDENCE\n' +
        '• confidence (0-100): overall self-assessment. Crisp PDF/photo → 90+. Skewed phone photo of clear text → 70-90. Blurry/partial/heavy-glare/faded thermal → below 60.\n' +
        '• field_confidences: a separate 0-100 number per field for the values you returned. Anything below 70 will be flagged for staff to verify. Be honest — confidently wrong is worse than a clear "uncertain".\n' +
        '• field_notes: short, plain-text notes flagging anything ambiguous. E.g., "two TOTAL labels — chose the lower one"; "vendor cropped at top"; "VAT rate shown only on line items, summed across rows".\n\n' +
        'GREEK / MIXED LANGUAGE\n' +
        '• Set document_language to "el" if the document body is mostly Greek (even with English column headers).\n' +
        '• Vendor names in Greek (e.g. "ΓΕΡΟΝΤΑ ΓΑΒΡΙΗΛ", "ΠΑΠΑΔΟΠΟΥΛΟΣ Α.Ε.") must be returned verbatim — do NOT transliterate to Latin.\n' +
        '• Common Greek monetary phrases: "Σύνολο πληρωτέο" = total payable; "Καθαρή αξία" = net; "Φόρος Προστιθέμενης Αξίας" = VAT.',
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system:
          'You are an extraction specialist for a Cyprus accounting firm. You read supplier invoices and ' +
          'receipts (purchase documents, not the firm\'s own sales documents) in English and Greek and ' +
          'return clean structured data. Cyprus context: currency defaults to EUR; standard VAT rates are ' +
          '19%, 9%, 5%, 0%; date convention is DD/MM/YYYY (you convert to ISO). Prefer omitting a field ' +
          'over hallucinating it.',
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'record_invoice' },
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ ok: false, error: `Claude rejected the request (${res.status}): ${detail}` });
    }
    const data = await res.json();
    const toolUse = (data.content || []).find((c: any) => c.type === 'tool_use');
    if (!toolUse) return json({ ok: false, error: 'No structured data was returned.' });
    return json({ ok: true, data: toolUse.input, usage: data.usage });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
