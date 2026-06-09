import { jsPDF } from 'jspdf';
import { registerRobotoFont } from '../assets/fonts/Roboto-Regular-normal.js';

// Engagement letter renderer. Produces a two-part PDF matching the PC Prime
// "Provision of Services and Statement of Work" format:
//
//   Page 1 — Cover Letter: firm letterhead (with logo), date, addressee,
//            scope summary, fees one-liner, signature block.
//   Page 2+ — Statement of Work: scope intro, deliverables, fees structure
//            (hourly rates + discount + min monthly + annual estimate or
//            per-service fees), terms (Confidentiality, Data Protection,
//            Force Majeure, Jurisdiction), acceptance block.

export type LetterService = {
  service_id?: number;
  service_key?: string;
  service_label: string;
  annual_fee?: number;     // only used in 'per_service' fee mode
  scope_notes?: string;
  // Snapshot of the deliverables to render under this service. Labels only —
  // the description is held in the catalogue and not duplicated into the
  // letter (snapshot keeps the letter immutable post-issue).
  deliverables?: Array<{ label: string }>;
};

export type EngagementLetterData = {
  client: {
    name: string;
    legal_name?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    tax_number?: string | null;
    vat_number?: string | null;
    registration_number?: string | null;
    id_number?: string | null;
  };
  firm: {
    name?: string | null;
    legal_name?: string | null;
    registration_number?: string | null;
    tax_id?: string | null;
    vat_number?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    iban?: string | null;
    bank_name?: string | null;
    logo_url?: string | null;
    logo_data_url?: string | null;  // pre-fetched data URL (set by caller)
  };
  version: number;
  effective_from?: string | null;
  effective_to?: string | null;

  // Engagement type — 'annual' = recurring retainer, 'one_off' = single
  // project. Changes the fee wording (Project fee vs Annual estimate),
  // hides the annual-rate-review notice, and adjusts the cover-letter
  // boilerplate accordingly.
  engagement_type?: 'annual' | 'one_off';

  // Fee structure
  fee_mode: 'flat' | 'per_service';
  annual_estimate?: number | null;  // flat mode
  services: LetterService[];        // names always; per-service fees only in per_service mode
  hourly_rate_director?: number | null;
  hourly_rate_manager?: number | null;
  hourly_rate_support?: number | null;
  discount_percent?: number | null;
  min_monthly_fee?: number | null;
  annual_review_notice_days?: number | null;
  currency: string;

  // Editable body text
  engagement_leader?: string | null;
  cover_letter_text?: string | null;
  intro_text?: string | null;       // SOW intro
  terms_text?: string | null;
};

const fmtMoney = (n: number | null | undefined, ccy = 'EUR') => {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy }).format(Number(n) || 0);
};
const fmtDateGB = (iso?: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB') : '—';

// Replace {{client_name}}, {{engagement_leader}} merge fields.
function applyMergeFields(text: string | null | undefined, vars: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? `{{${key}}}`);
}

export const DEFAULT_INTRO = 'PC Prime & Calculate Consultants Ltd is pleased to confirm its engagement for the provision of accounting, payroll, taxation, and business advisory services to {{client_name}}.';
export const DEFAULT_TERMS = '1. Your obligations\nTo be of greatest assistance to you, we should be advised in advance of any major transactions you may propose to undertake.';
export const DEFAULT_COVER = 'Further to our discussions regarding the provision of accounting and advisory services to {{client_name}}, we set out below and in the Statement of Work the terms of business which will govern our agreement for the provision of such services.';

// Fetch a remote image as a data URL so jsPDF.addImage can embed it. Returns
// null on any failure (CORS, missing, network) so the caller renders the PDF
// without the logo rather than blowing up the whole generation.
export async function fetchLogoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function generateEngagementLetterPdf(
  data: EngagementLetterData,
  mode: 'save' | 'arraybuffer' = 'save',
): ArrayBuffer | void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  registerRobotoFont(doc);
  doc.setFont('Roboto', 'normal');

  const W = 210;
  const H = 297;
  const M = 18;
  const NAVY: [number, number, number] = [26, 54, 93];
  const GREY: [number, number, number] = [90, 100, 120];
  const BODY: [number, number, number] = [40, 50, 70];

  const mergeVars: Record<string, string> = {
    client_name: data.client.legal_name || data.client.name || '',
    engagement_leader: data.engagement_leader || 'the Engagement Leader',
    firm_name: data.firm.name || data.firm.legal_name || '',
  };

  // ---------- helpers ----------
  const setColor = (rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const ensureRoom = (need: number, y: number): number => {
    if (y + need > H - M) { doc.addPage(); return M; }
    return y;
  };
  const writeWrapped = (text: string, x: number, y: number, w: number, lineHeight = 4.4): number => {
    const lines = doc.splitTextToSize(text, w);
    for (const line of lines) {
      y = ensureRoom(lineHeight, y);
      doc.text(line, x, y);
      y += lineHeight;
    }
    return y;
  };

  // ---------- letterhead (page 1 only) ----------
  // Draws the firm logo (proportionally scaled, capped to a tidy box) and
  // the firm details. Page 2+ uses a lighter header instead.
  const drawLetterhead = (y: number): number => {
    // Logo — preserve aspect ratio. Cap to a 32×16 mm box in the top-right.
    if (data.firm.logo_data_url) {
      try {
        const props = (doc as any).getImageProperties
          ? (doc as any).getImageProperties(data.firm.logo_data_url)
          : null;
        const maxW = 32;
        const maxH = 16;
        let w = maxW, h = maxH;
        if (props && props.width && props.height) {
          const ratio = props.width / props.height;
          // Fit inside the box without stretching.
          if (ratio > maxW / maxH) { w = maxW; h = maxW / ratio; }
          else                     { h = maxH; w = maxH * ratio; }
        }
        // Anchor top-right. Slight visual lift so the cap-height aligns with
        // the firm name baseline below.
        const fmt = (data.firm.logo_data_url.match(/^data:image\/([^;]+)/)?.[1] || 'PNG').toUpperCase();
        const safeFmt = fmt === 'JPG' ? 'JPEG' : (['PNG','JPEG','WEBP'].includes(fmt) ? fmt : 'PNG');
        doc.addImage(data.firm.logo_data_url, safeFmt as any, W - M - w, M - 2, w, h, undefined, 'FAST');
      } catch {
        // Bad data URL or unsupported format — skip silently.
      }
    }
    doc.setFontSize(16);
    setColor(NAVY);
    doc.text(data.firm.name || data.firm.legal_name || '', M, y);
    y += 5;
    doc.setFontSize(9);
    setColor(GREY);
    const firmLines = [
      data.firm.legal_name && data.firm.legal_name !== data.firm.name ? data.firm.legal_name : null,
      [data.firm.address_line1, data.firm.address_line2].filter(Boolean).join(', '),
      [data.firm.postal_code, data.firm.city, data.firm.country].filter(Boolean).join(', '),
      [data.firm.phone, data.firm.email].filter(Boolean).join(' · '),
      data.firm.website,
      [
        data.firm.registration_number ? `Reg. ${data.firm.registration_number}` : null,
        data.firm.tax_id ? `TIC ${data.firm.tax_id}` : null,
        data.firm.vat_number ? `VAT ${data.firm.vat_number}` : null,
      ].filter(Boolean).join(' · '),
    ].filter((l): l is string => !!l && l.trim().length > 0);
    for (const line of firmLines) { doc.text(line, M, y); y += 3.8; }
    y += 4;
    return y;
  };

  // ---------- SOW header (page 2+) — lighter than the full letterhead ----------
  // Just a thin rule + firm name on the left. No logo, no address block —
  // the cover letter is the formal letterhead; the SOW is the continuation.
  const drawSowHeader = (y: number): number => {
    doc.setFontSize(8.5);
    setColor(GREY);
    doc.text(data.firm.legal_name || data.firm.name || '', M, y);
    doc.text('Statement of Work — continued', W - M, y, { align: 'right' });
    y += 2;
    doc.setDrawColor(220, 226, 236);
    doc.setLineWidth(0.2);
    doc.line(M, y, W - M, y);
    y += 6;
    return y;
  };

  // ============================================================
  // PAGE 1 — COVER LETTER
  // ============================================================
  let y = M;
  y = drawLetterhead(y);

  // Date + city line (top-right of letter body)
  doc.setFontSize(10);
  setColor(BODY);
  const today = new Date().toLocaleDateString('en-GB');
  doc.text(`${data.firm.city || ''}, ${today}`.replace(/^, /, ''), W - M, y, { align: 'right' });
  y += 8;

  // Addressee
  setColor(BODY);
  const clientLines = [
    data.client.legal_name || data.client.name,
    data.client.address,
    [data.client.city, data.client.country].filter(Boolean).join(', '),
  ].filter((l): l is string => !!l && l.trim().length > 0);
  for (const line of clientLines) { doc.text(line, M, y); y += 4.4; }
  y += 6;

  // Salutation
  doc.text(`Dear ${data.client.name || 'Sir / Madam'},`, M, y);
  y += 7;

  // Subject
  doc.setFontSize(11);
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text('Provision of services as per scope of services detailed in the Statement of Work', M, y, { maxWidth: W - 2 * M });
  // wrap if too long
  const subjLines = doc.splitTextToSize('Provision of services as per scope of services detailed in the Statement of Work', W - 2 * M);
  y += subjLines.length * 5;
  doc.setFont('Roboto', 'normal');
  y += 4;

  // Body — cover letter text (with merge fields applied)
  doc.setFontSize(10);
  setColor(BODY);
  const coverText = applyMergeFields(data.cover_letter_text || DEFAULT_COVER, mergeVars);
  // Render paragraphs with breaks
  for (const para of coverText.split(/\n+/)) {
    if (!para.trim()) continue;
    y = writeWrapped(para.trim(), M, y, W - 2 * M);
    y += 3;
  }
  y += 6;

  // Sign-off
  y = ensureRoom(45, y);
  doc.setFontSize(10);
  setColor(BODY);
  doc.text('Yours faithfully,', M, y);
  y += 18;
  doc.setDrawColor(180, 190, 210);
  doc.line(M, y, M + 80, y);
  y += 4;
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text(data.engagement_leader || '', M, y);
  doc.setFont('Roboto', 'normal');
  setColor(GREY);
  doc.setFontSize(9);
  y += 4;
  doc.text(`For and on behalf of ${data.firm.legal_name || data.firm.name || ''}`, M, y);

  // Client acceptance line at the foot of the cover letter
  y = H - M - 24;
  doc.setFontSize(9);
  setColor(BODY);
  doc.text('We accept the terms of the agreement as set out above and in the Statement of Work.', M, y);
  y += 12;
  doc.setDrawColor(180, 190, 210);
  doc.line(M, y, M + 80, y);
  doc.line(M + 90, y, M + 170, y);
  setColor(GREY);
  doc.setFontSize(8);
  doc.text('Signature / Name', M, y + 4);
  doc.text('Date', M + 90, y + 4);

  // ============================================================
  // PAGE 2+ — STATEMENT OF WORK
  // ============================================================
  // No full letterhead on the SOW pages — the cover letter already
  // carries the firm identity. Use a slim continuation header instead.
  doc.addPage();
  y = M;
  y = drawSowHeader(y);

  // Title
  doc.setFontSize(15);
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text('Statement of Work', M, y);
  doc.setFont('Roboto', 'normal');
  y += 8;

  // Client + period strip
  setColor(BODY);
  doc.setFontSize(10);
  doc.text(`Client: ${data.client.legal_name || data.client.name}`, M, y);
  const period = [
    data.effective_from ? `Effective from ${fmtDateGB(data.effective_from)}` : null,
    data.effective_to ? `to ${fmtDateGB(data.effective_to)}` : null,
  ].filter(Boolean).join(' ');
  if (period) {
    setColor(GREY);
    doc.text(period, W - M, y, { align: 'right' });
  }
  setColor(BODY);
  y += 8;

  // Intro
  doc.setFontSize(10);
  setColor(BODY);
  const introText = applyMergeFields(data.intro_text || DEFAULT_INTRO, mergeVars);
  for (const para of introText.split(/\n+/)) {
    if (!para.trim()) continue;
    y = writeWrapped(para.trim(), M, y, W - 2 * M);
    y += 2.5;
  }
  y += 4;

  // ---- Services / Deliverables ----
  y = ensureRoom(20, y);
  doc.setFontSize(12);
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text('1. Services to be provided', M, y);
  doc.setFont('Roboto', 'normal');
  y += 5;
  doc.setFontSize(10);
  setColor(BODY);

  for (const s of data.services) {
    y = ensureRoom(8, y);
    // Service heading — bold, slightly larger than the deliverables under it.
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(10.5);
    setColor(NAVY);
    if (data.fee_mode === 'per_service' && s.annual_fee != null && s.annual_fee > 0) {
      doc.text(fmtMoney(s.annual_fee, data.currency), W - M, y, { align: 'right' });
      const wrapped = doc.splitTextToSize(s.service_label, W - 2 * M - 30);
      doc.text(wrapped, M, y);
      y += wrapped.length * 4.6;
    } else {
      const wrapped = doc.splitTextToSize(s.service_label, W - 2 * M);
      doc.text(wrapped, M, y);
      y += wrapped.length * 4.6;
    }
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(10);
    setColor(BODY);

    // Optional scope notes sit just under the heading.
    if (s.scope_notes && s.scope_notes.trim()) {
      doc.setFontSize(9);
      setColor(GREY);
      y = writeWrapped(s.scope_notes, M + 4, y, W - 2 * M - 4, 4);
      y += 1;
      doc.setFontSize(10);
      setColor(BODY);
    }

    // Deliverables — sub-bullets, indented, small font.
    const dels = s.deliverables || [];
    if (dels.length > 0) {
      doc.setFontSize(9.5);
      setColor(BODY);
      for (const d of dels) {
        y = ensureRoom(5, y);
        doc.text('–', M + 5, y);
        const wrapped = doc.splitTextToSize(d.label, W - 2 * M - 10);
        doc.text(wrapped, M + 10, y);
        y += wrapped.length * 4.2;
      }
      doc.setFontSize(10);
    }
    // Breathing room between services.
    y += 4;
  }
  y += 4;

  // ---- Fees, expenses, billing ----
  y = ensureRoom(40, y);
  doc.setFontSize(12);
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text('2. Fees, expenses, and billing', M, y);
  doc.setFont('Roboto', 'normal');
  y += 5;
  doc.setFontSize(10);
  setColor(BODY);

  // A. Hourly rates table (always shown — these are the firm's standard rates
  // governing any out-of-scope work).
  doc.setFont('Roboto', 'bold');
  doc.text('A. Professional fees — standard hourly rates', M, y);
  doc.setFont('Roboto', 'normal');
  y += 5;
  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, W - 2 * M, 6, 'F');
  doc.setFontSize(9);
  setColor(GREY);
  doc.text('Role', M + 2, y + 4);
  doc.text('Hourly rate', W - M - 2, y + 4, { align: 'right' });
  y += 6;
  doc.setFontSize(10);
  setColor(BODY);
  const rateRows: Array<[string, number | null | undefined]> = [
    ['Director', data.hourly_rate_director],
    ['Manager', data.hourly_rate_manager],
    ['Support Staff', data.hourly_rate_support],
  ];
  for (const [role, rate] of rateRows) {
    if (rate == null) continue;
    y = ensureRoom(5, y);
    doc.text(role, M + 2, y + 4);
    doc.text(fmtMoney(rate, data.currency), W - M - 2, y + 4, { align: 'right' });
    doc.setDrawColor(240, 244, 250);
    doc.setLineWidth(0.15);
    doc.line(M, y + 5.5, W - M, y + 5.5);
    y += 5.8;
  }
  if (data.discount_percent && data.discount_percent > 0) {
    setColor(GREY);
    doc.setFontSize(9);
    doc.text(`A discount of ${data.discount_percent}% applies to the above rates.`, M, y + 4);
    y += 6;
    doc.setFontSize(10);
    setColor(BODY);
  }
  // Generous gap between sub-section A and B so they read as distinct blocks.
  y += 10;

  // B. Fee model — flat vs per_service (and annual vs one_off wording)
  const isOneOff = data.engagement_type === 'one_off';
  if (data.fee_mode === 'flat') {
    y = ensureRoom(20, y);
    doc.setFont('Roboto', 'bold');
    doc.text(isOneOff ? 'B. Project fee' : 'B. Engagement fee', M, y);
    doc.setFont('Roboto', 'normal');
    y += 6;
    const fee = Number(data.annual_estimate || 0);
    if (isOneOff) {
      // One-off: single project fee, single invoice on completion (or
      // milestone, but we keep it simple). No monthly cadence, no minimum.
      if (fee > 0) {
        y = writeWrapped(
          `Project fee: ${fmtMoney(fee, data.currency)} plus necessary out-of-pocket expenses and VAT at the applicable rate. Invoiced on completion of the engagement (or as agreed in writing for staged delivery).`,
          M, y, W - 2 * M,
        );
        y += 2;
      }
    } else {
      // Annual retainer.
      const monthly = fee / 12;
      if (data.min_monthly_fee && data.min_monthly_fee > 0) {
        y = writeWrapped(`Minimum monthly fee: ${fmtMoney(data.min_monthly_fee, data.currency)} regardless of service volume.`, M, y, W - 2 * M);
        y += 1;
      }
      if (fee > 0) {
        y = writeWrapped(
          `Estimated annual fee: ${fmtMoney(fee, data.currency)} (i.e. ${fmtMoney(monthly, data.currency)} per month) plus necessary out-of-pocket expenses and VAT at the applicable rate. Invoices raised monthly.`,
          M, y, W - 2 * M,
        );
        y += 2;
      }
    }
  } else {
    // per_service total
    y = ensureRoom(15, y);
    doc.setFont('Roboto', 'bold');
    doc.text('B. Fee summary per service', M, y);
    doc.setFont('Roboto', 'normal');
    y += 6;
    const total = data.services.reduce((s, x) => s + (Number(x.annual_fee) || 0), 0);
    doc.setDrawColor(180, 190, 210);
    doc.setLineWidth(0.4);
    doc.line(M, y, W - M, y);
    y += 5;
    doc.setFontSize(11);
    setColor(NAVY);
    doc.text('Total annual fee', M, y);
    doc.text(fmtMoney(total, data.currency), W - M, y, { align: 'right' });
    y += 6;
    doc.setFontSize(10);
    setColor(BODY);
    if (data.min_monthly_fee && data.min_monthly_fee > 0) {
      y = writeWrapped(`Minimum monthly fee: ${fmtMoney(data.min_monthly_fee, data.currency)} regardless of service volume.`, M, y, W - 2 * M);
      y += 2;
    }
  }
  // Annual rate-review notice only makes sense on a recurring engagement.
  if (!isOneOff && data.annual_review_notice_days) {
    setColor(GREY);
    doc.setFontSize(9);
    y = writeWrapped(`We reserve the right to adjust our rates annually with ${data.annual_review_notice_days} days prior notice.`, M, y, W - 2 * M, 4);
    doc.setFontSize(10);
    setColor(BODY);
  }
  // Spacer between fee sub-sections.
  y += 10;

  // C. Invoices and payment (wording differs for one-off vs recurring).
  y = ensureRoom(15, y);
  doc.setFont('Roboto', 'bold');
  doc.text('C. Invoices and payment', M, y);
  doc.setFont('Roboto', 'normal');
  y += 6;
  y = writeWrapped(
    isOneOff
      ? 'A single invoice will be issued on completion of the engagement (or per the agreed staged-delivery milestones). Charges are specified in Euro. All invoices are due for payment on presentation. In the event of delay in payment, we reserve the right to suspend the provision of services.'
      : 'Invoices will be raised at the end of every month and all charges will be specified in Euro. All invoices are due for payment on presentation. In the event of delay in payment, we reserve the right to suspend the provision of services.',
    M, y, W - 2 * M,
  );
  // Bigger gap before the next top-level section.
  y += 10;

  // ---- Terms ----
  y = ensureRoom(20, y);
  doc.setFontSize(12);
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text('3. Terms', M, y);
  doc.setFont('Roboto', 'normal');
  y += 7;
  doc.setFontSize(9.5);
  setColor(BODY);
  const termsText = applyMergeFields(data.terms_text || DEFAULT_TERMS, mergeVars);
  for (const para of termsText.split(/\n+/)) {
    if (!para.trim()) continue;
    y = writeWrapped(para.trim(), M, y, W - 2 * M, 4.4);
    y += 3;
  }

  // ---- Acceptance block ----
  y = ensureRoom(40, y);
  y += 6;
  doc.setFontSize(12);
  setColor(NAVY);
  doc.setFont('Roboto', 'bold');
  doc.text('Acceptance', M, y);
  doc.setFont('Roboto', 'normal');
  y += 6;
  doc.setFontSize(10);
  setColor(BODY);
  y = writeWrapped(
    'By signing below or by replying to the email transmitting this letter with the word "ACCEPTED", you confirm that you have read and agree to the terms set out above and authorise us to commence the engagement.',
    M, y, W - 2 * M,
  );
  y += 12;
  doc.setDrawColor(180, 190, 210);
  doc.line(M, y, M + 80, y);
  doc.line(M + 90, y, W - M, y);
  doc.setFontSize(9);
  setColor(GREY);
  doc.text('For the Client (name, signature, date)', M, y + 4);
  doc.text('For the Firm (name, signature, date)', M + 90, y + 4);

  // ---- Page footer: Version / period / page X of Y on every page ----
  const pageCount = (doc as any).getNumberOfPages ? (doc as any).getNumberOfPages() : 1;
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    setColor(GREY);
    const today = new Date().toLocaleDateString('en-GB');
    const periodFooter = [
      `Version ${data.version}`,
      data.effective_from ? `Effective ${fmtDateGB(data.effective_from)}` : null,
      data.effective_to ? `to ${fmtDateGB(data.effective_to)}` : null,
      `Issued ${today}`,
    ].filter(Boolean).join('  ·  ');
    doc.text(periodFooter, M, H - 8);
    doc.text(`Page ${p} of ${pageCount}`, W - M, H - 8, { align: 'right' });
    // Thin rule above the footer
    doc.setDrawColor(225, 230, 240);
    doc.setLineWidth(0.15);
    doc.line(M, H - 12, W - M, H - 12);
  }

  // ---- Done ----
  if (mode === 'arraybuffer') {
    return doc.output('arraybuffer') as ArrayBuffer;
  }
  doc.save(`engagement-letter-${(data.client.name || 'client').replace(/[^\w-]+/g, '_')}-v${data.version}.pdf`);
}
