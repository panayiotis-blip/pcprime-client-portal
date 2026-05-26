import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import InvoicePrint from '../components/Billing/InvoicePrint';
import ReceiptPrint from '../components/Billing/ReceiptPrint';
import StatementPrint from '../components/Billing/StatementPrint';

// Renders one of the printable billing routes off-screen and snapshots it
// into an A4 PDF. Returns the PDF as a base64 string (no "data:" prefix) so
// it can be attached to an outgoing email.
//
// The print components honour a `capture=1` query flag — they skip the
// browser print dialog and the on-screen action buttons in that mode.
export async function generateDocumentPdf(routePath: string): Promise<string> {
  const host = document.createElement('div');
  host.style.position   = 'fixed';
  host.style.left       = '-10000px';
  host.style.top        = '0';
  host.style.width      = '900px';
  host.style.background = '#ffffff';
  document.body.appendChild(host);

  const root = createRoot(host);
  const sep  = routePath.includes('?') ? '&' : '?';
  root.render(
    <MemoryRouter initialEntries={[routePath + sep + 'capture=1']}>
      <Routes>
        <Route path="/billing/:id/print"                 element={<InvoicePrint />} />
        <Route path="/billing/receipt/:id/print"         element={<ReceiptPrint />} />
        <Route path="/billing/statement/:clientId/print" element={<StatementPrint />} />
      </Routes>
    </MemoryRouter>,
  );

  try {
    const target = await waitFor(host, '.print-page', 20_000);
    // Let the letterhead logo and fonts settle before snapshotting.
    await delay(600);
    const pdf = await elementToPdf(target);
    return pdf.output('datauristring').split(',')[1];
  } finally {
    root.unmount();
    host.remove();
  }
}

// Snapshot a live DOM element into an A4 PDF (slicing tall content across
// pages). Elements marked `.no-print` (e.g. the toolbar) are skipped.
export async function elementToPdf(target: HTMLElement): Promise<jsPDF> {
  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    ignoreElements: (el) => (el as HTMLElement).classList?.contains('no-print'),
  });

  const pdf   = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgH  = (canvas.height * pageW) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  let heightLeft = imgH;
  let position   = 0;
  pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH);
    heightLeft -= pageH;
  }
  return pdf;
}

// Build the PDF for a live element and trigger a browser download.
export async function downloadElementPdf(target: HTMLElement, filename: string): Promise<void> {
  const pdf = await elementToPdf(target);
  pdf.save(filename);
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function waitFor(host: HTMLElement, selector: string, timeoutMs: number): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const el = host.querySelector(selector) as HTMLElement | null;
      if (el) { resolve(el); return; }
      if (Date.now() > deadline) { reject(new Error('Timed out preparing the PDF.')); return; }
      setTimeout(tick, 150);
    };
    tick();
  });
}
