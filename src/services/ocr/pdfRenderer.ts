import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// How many pages of a multi-page PDF we read for AI/OCR extraction. Beyond
// this, rendering every page is slow and memory-heavy for little gain — an
// invoice's key data is on the first page(s). Callers warn when truncated.
export const MAX_OCR_PAGES = 5;

/**
 * Try to extract embedded text from a PDF first.
 * Returns the text if found, or empty string if the PDF is image-based.
 */
export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText.trim();
}

/**
 * Count the pages in a PDF without rendering anything.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}

/**
 * Render a specific page (1-indexed) of a PDF to a JPEG Blob.
 * Used by the Scanner when splitting a multi-invoice PDF into one
 * invoice per page.
 */
export async function renderPdfPageToJpegBlob(file: File, pageNumber: number, scale = 2.0, quality = 0.85): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(`Page ${pageNumber} out of range (PDF has ${pdf.numPages} page(s)).`);
  }
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null')),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Render PDF pages to canvas images (fallback for image-based PDFs).
 */
export async function renderPdfToImages(file: File): Promise<HTMLCanvasElement[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const canvases: HTMLCanvasElement[] = [];

  const limit = Math.min(pdf.numPages, MAX_OCR_PAGES);
  for (let i = 1; i <= limit; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }

  return canvases;
}

/**
 * Render up to `maxPages` of a PDF to JPEG blobs, parsing the document only
 * ONCE (the per-page helper above re-parses on every call — costly in a loop).
 * Lower scale than the OCR path: the AI reads these fine and the payload stays
 * small. Returns the true page count + whether the PDF was truncated.
 */
export async function renderPdfPagesToJpegBlobs(
  file: File, maxPages = MAX_OCR_PAGES, scale = 1.6, quality = 0.8,
): Promise<{ blobs: Blob[]; totalPages: number; truncated: boolean }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const total = pdf.numPages;
  const n = Math.min(total, maxPages);
  const blobs: Blob[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')), 'image/jpeg', quality));
    blobs.push(blob);
    canvas.width = 0; canvas.height = 0; // release the backing buffer promptly
  }
  return { blobs, totalPages: total, truncated: total > n };
}

/**
 * Read a file's page image(s) as base64 for the AI extractor. PDFs are
 * rendered to JPEGs (first MAX_OCR_PAGES, single parse); images are sent
 * as-is. Returns page count + whether the PDF was truncated so callers can
 * warn the user.
 */
export async function fileToAiImageParts(
  file: File, maxPages = MAX_OCR_PAGES,
): Promise<{ parts: { media_type: string; data: string }[]; totalPages: number; truncated: boolean }> {
  const toB64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  if (file.type === 'application/pdf') {
    const { blobs, totalPages, truncated } = await renderPdfPagesToJpegBlobs(file, maxPages);
    const parts: { media_type: string; data: string }[] = [];
    for (const b of blobs) parts.push({ media_type: 'image/jpeg', data: await toB64(b) });
    return { parts, totalPages, truncated };
  }
  return { parts: [{ media_type: file.type || 'image/jpeg', data: await toB64(file) }], totalPages: 1, truncated: false };
}
