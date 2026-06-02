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
      confidence: { type: 'number', description: 'Self-assessed 0-100 extraction confidence.' },
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
        '• Amounts as plain numbers (no currency symbols, decimal point ".", no thousands separators).\n' +
        '• Dates as ISO YYYY-MM-DD. Documents commonly show DD/MM/YYYY (Cyprus/Greek convention) — convert.\n' +
        '• currency: 3-letter ISO code. If the document shows "€" or no symbol but is clearly a Cyprus document, use "EUR".\n' +
        '• vendor_name: the party that ISSUED the document (the supplier / seller / shop / πωλητής / προμηθευτής), NOT the recipient or the buyer.\n' +
        '• total_amount: the GROSS payable (VAT-inclusive). On receipts this is usually the largest amount, labelled "TOTAL", "GRAND TOTAL", "ΣΥΝΟΛΟ", "ΓΕΝΙΚΟ ΣΥΝΟΛΟ", or "ΠΛΗΡΩΤΕΟ".\n' +
        '• subtotal: net amount before VAT, labelled "Subtotal", "Net", "ΑΞΙΑ", "ΚΑΘΑΡΗ ΑΞΙΑ".\n' +
        '• vat_amount: the VAT figure ("VAT", "Tax", "ΦΠΑ"). vat_rate: the percentage (Cyprus rates are typically 19, 9, 5, or 0).\n' +
        '• invoice_number: labels include "Invoice No", "Inv #", "Receipt No", "Α/Α", "Αρ. Τιμολογίου", "Αρ. Απόδειξης". Tills often print a transaction number — that counts.\n' +
        '• If a field truly cannot be read, OMIT it — do not guess. Empty strings count as omission.\n' +
        '• confidence (0-100): be honest. Crisp PDF/photo → 90+. Slightly skewed phone photo of a clear invoice → 70-90. Blurry / partial / heavy glare / faded thermal receipt → below 60.\n\n' +
        'COMMON PITFALLS\n' +
        '• Receipts (especially thermal till slips): vendor name is at the very top, often in larger or bolder text; the address and VAT number follow.\n' +
        '• "TOTAL" on a receipt may equal what the customer paid (gross) — that\'s total_amount.\n' +
        '• Multi-page invoice: read all pages; pick the final totals from the last page.\n' +
        '• Documents in Greek may mix English column headers. The fields above apply regardless of language; set document_language to "el" if the document is mostly Greek.',
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
