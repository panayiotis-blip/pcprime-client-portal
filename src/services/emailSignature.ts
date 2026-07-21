// Normalise an email signature to safe HTML with REAL line breaks.
//
// If the signature is plain text (typed/pasted into the "HTML" box, no tags),
// its newlines are converted to <br> so it renders as stacked lines in the sent
// email. Without this, plain-text newlines collapse and the whole signature
// prints as one run-on paragraph below the sign-off. If it already looks like
// HTML (has tags — e.g. from the Generate button), it's returned unchanged.
export function normaliseSignatureHtml(raw: string | null | undefined): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const looksHtml = /<[a-z][\s\S]*>/i.test(s);
  if (looksHtml) return s;
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div>${esc.replace(/\r?\n/g, '<br>')}</div>`;
}
