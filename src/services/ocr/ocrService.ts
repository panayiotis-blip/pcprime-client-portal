import Tesseract from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
}

export async function recognizeImage(
  image: File | Blob | HTMLCanvasElement | string,
): Promise<OcrResult> {
  // Tesseract.js v7 uses a simple recognize() function
  const result = await Tesseract.recognize(image, 'eng');
  return {
    text: result.data.text,
    confidence: result.data.confidence,
  };
}
