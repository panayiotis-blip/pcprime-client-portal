import { jsPDF } from 'jspdf';
import { registerRobotoFont } from '../assets/fonts/Roboto-Regular-normal.js';

// One source of truth for rendering an engagement letter as PDF.
// Used both by the in-browser Preview and by the "Send" flow which
// then turns the PDF into base64 and attaches it to the Outlook email.

export type LetterService = {
  service_id?: number;
  service_key?: string;
  service_label: string;
  annual_fee: number;
  scope_notes?: string;
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
  };
  version: number;
  effective_from?: string | null;  // YYYY-MM-DD
  effective_to?: string | null;
  services: LetterService[];
  total_annual_fee: number;
  currency: string;             // 'EUR'
  intro_text?: string | null;
  terms_text?: string | null;
};

const fmtMoney = (n: number, ccy = 'EUR') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy }).format(Number(n) || 0);
const fmtDateGB = (iso?: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB') : '—';

// Built-in defaults so a draft is usable out of the box; users can edit.
export const DEFAULT_INTRO = `We are pleased to set out the terms of our engagement to provide the services described below. This letter, once accepted, forms a binding agreement between our firm and yourselves and will remain in force until terminated or replaced by a new engagement letter.`;

export const DEFAULT_TERMS = `1. Our responsibilities
We will perform the services with due care and in accordance with applicable professional standards. Our work will be limited to the services explicitly listed in this letter.

2. Your responsibilities
You agree to provide complete, accurate and timely information necessary for us to perform the services. You retain responsibility for the accuracy of underlying records and the timely submission of returns.

3. Fees and billing
Fees are as set out in this letter and are payable in accordance with our invoices. Out-of-scope work will be quoted separately. Late payment may incur interest at the statutory rate.

4. Confidentiality and data protection
Information you provide will be treated as confidential and processed in accordance with applicable data-protection law. Records may be retained for the period required by law.

5. Termination
Either party may terminate this engagement by giving 30 days written notice. Fees for work performed up to the termination date remain due.

6. Governing law
This engagement is governed by the laws of the Republic of Cyprus. Any dispute will be subject to the exclusive jurisdiction of the Cyprus courts.`;

export function generateEngagementLetterPdf(data: EngagementLetterData, mode: 'save' | 'arraybuffer' = 'save'): ArrayBuffer | void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  registerRobotoFont(doc);
  doc.setFont('Roboto', 'normal');

  const W = 210;
  const M = 18;          // page margin
  let y = M;

  // --- Letterhead: firm details ---
  doc.setFontSize(18);
  doc.setTextColor(26, 54, 93);  // pc-navy
  doc.text(data.firm.name || data.firm.legal_name || 'Engagement letter', M, y);
  y += 6;

  doc.setFontSize(10);
  doc.setTextColor(90, 100, 120);
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
  for (const line of firmLines) { doc.text(line, M, y); y += 4.2; }
  y += 4;

  // --- Title ---
  doc.setFontSize(15);
  doc.setTextColor(26, 54, 93);
  doc.text(`Engagement Letter — v${data.version}`, M, y);
  y += 5.5;
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 120);
  const period = [
    data.effective_from ? `Effective from ${fmtDateGB(data.effective_from)}` : null,
    data.effective_to ? `to ${fmtDateGB(data.effective_to)}` : null,
  ].filter(Boolean).join(' ');
  if (period) { doc.text(period, M, y); y += 4.5; }
  y += 4;

  // --- Client block ---
  doc.setDrawColor(220, 226, 236);
  doc.setLineWidth(0.2);
  doc.line(M, y, W - M, y);
  y += 4;
  doc.setFontSize(11);
  doc.setTextColor(26, 54, 93);
  doc.text('To:', M, y);
  y += 5;
  doc.setFontSize(10);
  doc.setTextColor(40, 50, 70);
  const clientLines = [
    data.client.legal_name || data.client.name,
    data.client.address,
    [data.client.city, data.client.country].filter(Boolean).join(', '),
    [
      data.client.tax_number ? `TIC ${data.client.tax_number}` : null,
      data.client.vat_number ? `VAT ${data.client.vat_number}` : null,
      data.client.registration_number ? `HE ${data.client.registration_number}` : null,
      data.client.id_number ? `ID ${data.client.id_number}` : null,
    ].filter(Boolean).join(' · '),
  ].filter((l): l is string => !!l && (l as string).trim().length > 0);
  for (const line of clientLines) { doc.text(line as string, M, y); y += 4.4; }
  y += 6;

  // --- Intro ---
  doc.setFontSize(10);
  doc.setTextColor(40, 50, 70);
  if (data.intro_text) {
    const wrapped = doc.splitTextToSize(data.intro_text, W - 2 * M);
    doc.text(wrapped, M, y);
    y += wrapped.length * 4.4 + 4;
  }

  // --- Services table ---
  doc.setFontSize(12);
  doc.setTextColor(26, 54, 93);
  doc.text('Scope of services and fees', M, y);
  y += 5.5;

  // Header row
  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, W - 2 * M, 6, 'F');
  doc.setFontSize(9);
  doc.setTextColor(90, 100, 120);
  doc.text('Service', M + 2, y + 4);
  doc.text('Annual fee', W - M - 2, y + 4, { align: 'right' });
  y += 7;

  doc.setFontSize(10);
  doc.setTextColor(40, 50, 70);
  for (const s of data.services) {
    // Page-break check
    if (y > 260) { doc.addPage(); y = M; }
    doc.setFont('Roboto', 'normal');
    doc.text(s.service_label, M + 2, y + 4);
    doc.text(fmtMoney(s.annual_fee, data.currency), W - M - 2, y + 4, { align: 'right' });
    y += 6;
    if (s.scope_notes && s.scope_notes.trim()) {
      doc.setFontSize(9);
      doc.setTextColor(100, 110, 130);
      const wrapped = doc.splitTextToSize(s.scope_notes, W - 2 * M - 4);
      doc.text(wrapped, M + 4, y + 3);
      y += wrapped.length * 4 + 2;
      doc.setFontSize(10);
      doc.setTextColor(40, 50, 70);
    }
    doc.setDrawColor(240, 244, 250);
    doc.setLineWidth(0.15);
    doc.line(M, y, W - M, y);
    y += 1.5;
  }

  // Total
  y += 3;
  doc.setDrawColor(180, 190, 210);
  doc.setLineWidth(0.4);
  doc.line(M, y, W - M, y);
  y += 5;
  doc.setFontSize(11);
  doc.setTextColor(26, 54, 93);
  doc.text('Total annual fee', M + 2, y);
  doc.text(fmtMoney(data.total_annual_fee, data.currency), W - M - 2, y, { align: 'right' });
  y += 8;

  // --- Terms ---
  if (data.terms_text) {
    if (y > 240) { doc.addPage(); y = M; }
    doc.setFontSize(12);
    doc.setTextColor(26, 54, 93);
    doc.text('Terms', M, y);
    y += 5;
    doc.setFontSize(9.5);
    doc.setTextColor(40, 50, 70);
    const wrapped = doc.splitTextToSize(data.terms_text, W - 2 * M);
    for (const line of wrapped) {
      if (y > 280) { doc.addPage(); y = M; doc.setFontSize(9.5); doc.setTextColor(40, 50, 70); }
      doc.text(line, M, y);
      y += 4.2;
    }
    y += 4;
  }

  // --- Acceptance block ---
  if (y > 240) { doc.addPage(); y = M; }
  y += 4;
  doc.setFontSize(12);
  doc.setTextColor(26, 54, 93);
  doc.text('Acceptance', M, y);
  y += 5;
  doc.setFontSize(10);
  doc.setTextColor(40, 50, 70);
  const acceptText = `By signing below or by replying to the email transmitting this letter with the word "ACCEPTED", you confirm that you have read and agree to the terms set out above and authorise us to commence the engagement.`;
  const aw = doc.splitTextToSize(acceptText, W - 2 * M);
  doc.text(aw, M, y);
  y += aw.length * 4.4 + 8;

  // Signature lines
  const colW = (W - 2 * M - 10) / 2;
  doc.setDrawColor(180, 190, 210);
  doc.line(M, y + 10, M + colW, y + 10);
  doc.line(M + colW + 10, y + 10, W - M, y + 10);
  doc.setFontSize(9);
  doc.setTextColor(100, 110, 130);
  doc.text('For the Client (name, signature, date)', M, y + 14);
  doc.text('For the Firm (name, signature, date)', M + colW + 10, y + 14);

  if (mode === 'arraybuffer') {
    return doc.output('arraybuffer') as ArrayBuffer;
  }
  doc.save(`engagement-letter-${data.client.name || 'client'}-v${data.version}.pdf`);
}
