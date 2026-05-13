// Helpers for fields that may contain MULTIPLE email addresses separated by
// ';' or ',' — common in real-world client records (e.g. owner + accountant).

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitEmails(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .split(/[;,]+/)
    .map(p => p.trim())
    .filter(Boolean);
}

export function isValidEmailList(s: string | null | undefined): boolean {
  const parts = splitEmails(s);
  if (parts.length === 0) return true;
  return parts.every(p => EMAIL_REGEX.test(p));
}

// Display component: renders each email as a clickable mailto link.
export function EmailLinks({ value, fallback = '—' }: { value: string | null | undefined; fallback?: string }) {
  const emails = splitEmails(value);
  if (emails.length === 0) return <>{fallback}</>;
  return (
    <>
      {emails.map((email, i) => (
        <span key={email}>
          {i > 0 && <span style={{ color: '#94a3b8', margin: '0 4px' }}>·</span>}
          <a href={`mailto:${email}`} style={{ color: 'inherit' }}>{email}</a>
        </span>
      ))}
    </>
  );
}
