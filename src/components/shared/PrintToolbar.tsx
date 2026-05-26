import { useState, type CSSProperties } from 'react';
import { downloadElementPdf } from '../../services/documentPdf';

function saveBlob(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

// Strip toolbar / no-print bits from a clone before exporting.
function cleanedClone(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.no-print, .pt-toolbar').forEach(n => n.remove());
  return c;
}

// Shared action bar shown on every printable document. The page renders as a
// preview; the user chooses Print, PDF, Word or Excel. PDF rasterises the
// page (jspdf + html2canvas); Word/Excel use the HTML-export approach (open
// and are editable in Word/Excel — not pixel-perfect native files).
export default function PrintToolbar({
  fileBase, targetSelector = '.print-page', showClose = true,
}: { fileBase: string; targetSelector?: string; showClose?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const getTarget = () => document.querySelector(targetSelector) as HTMLElement | null;
  const safeName  = (fileBase || 'document').replace(/[^\w-]+/g, '_');

  const onPdf = async () => {
    const el = getTarget();
    if (!el) { alert('Nothing to export.'); return; }
    setBusy(true);
    try { await downloadElementPdf(el, `${safeName}.pdf`); }
    catch (e: any) { alert('PDF failed: ' + e.message); }
    finally { setBusy(false); }
  };

  const onWord = () => {
    const el = getTarget();
    if (!el) return;
    const html = `<!DOCTYPE html><html xmlns:o='urn:schemas-microsoft-office:office' `
      + `xmlns:w='urn:schemas-microsoft-office:office:word' xmlns='http://www.w3.org/TR/REC-html40'>`
      + `<head><meta charset='utf-8'></head><body>${cleanedClone(el).outerHTML}</body></html>`;
    saveBlob('﻿' + html, 'application/msword', `${safeName}.doc`);
  };

  const onExcel = () => {
    const el = getTarget();
    if (!el) return;
    const tables = Array.from(cleanedClone(el).querySelectorAll('table')).map(t => t.outerHTML).join('<br/>');
    if (!tables) { alert('No table data to export to Excel on this document.'); return; }
    const html = `<html xmlns:o='urn:schemas-microsoft-office:office' `
      + `xmlns:x='urn:schemas-microsoft-office:excel' xmlns='http://www.w3.org/TR/REC-html40'>`
      + `<head><meta charset='utf-8'></head><body>${tables}</body></html>`;
    saveBlob('﻿' + html, 'application/vnd.ms-excel', `${safeName}.xls`);
  };

  const menuItem: CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
    border: 'none', background: 'white', cursor: 'pointer', fontSize: 13,
  };
  const pick = (fn: () => void | Promise<void>) => () => { setMenuOpen(false); void fn(); };

  return (
    <>
      <style>{`@media print { .pt-toolbar { display: none !important; } }`}</style>
      <div
        className="pt-toolbar no-print"
        style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
      >
        {showClose && <button className="btn btn-secondary btn-sm" onClick={() => window.close()}>Close</button>}

        {/* Export dropdown */}
        <div style={{ position: 'relative' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMenuOpen(o => !o)} disabled={busy}>
            {busy ? 'Exporting…' : 'Export ▾'}
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 21, background: 'white',
                border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                minWidth: 150, overflow: 'hidden',
              }}>
                <button style={menuItem} onClick={pick(onPdf)}>⬇ PDF</button>
                <button style={menuItem} onClick={pick(onWord)}>⬇ Word</button>
                <button style={menuItem} onClick={pick(onExcel)}>⬇ Excel</button>
              </div>
            </>
          )}
        </div>

        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 Print</button>
      </div>
    </>
  );
}
