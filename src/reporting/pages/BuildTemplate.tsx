// Reports → Build the template.
//
// One button. It reads this client's data through the signed-in session and
// hands back template-app.built_5.html with that data in place of the sample
// blob — the app as designed, showing real figures, in a single file.
//
// It runs here rather than as a script because the browser is already
// authenticated: every read goes through RLS exactly as any other screen's
// does, and no password has to exist anywhere for it to work.
//
// It OPENS the result rather than downloading it. A download of a 7MB blob was
// swallowed silently twice — once left as a .tmp in the downloads folder and
// once never written at all — and a build you cannot find is a build that did
// not happen. The link to save it is still there, to be clicked knowingly.

import { useState } from 'react';
import { useReportingSession } from '../session';
import { buildClientBlock, buildTemplateHtml, oneClientPayload, type BuildResult } from '../lib/reports/buildPayload.ts';

export default function BuildTemplate() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<(BuildResult & { size: number; url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileName = `reporting-${client!.code ?? clientId}.html`;

  const run = async () => {
    setBusy('Starting'); setError(null); setCount(null);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    try {
      const built = await buildClientBlock(clientId, (step: string, done?: number, total?: number) => {
        setBusy(step);
        setCount(done !== undefined && total !== undefined ? { done, total } : null);
      });
      setBusy('Writing the file');
      const blob = await buildTemplateHtml(oneClientPayload(built));
      const url = URL.createObjectURL(blob);
      setResult({ ...built, size: blob.size, url });

      // Open it, rather than trusting the download to arrive somewhere findable.
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setCount(null); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Build the template</h1>
      <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 16px' }}>
        Takes this client's figures and writes them into the reporting template, then opens it.
        Nothing is uploaded and nothing is changed — it only reads.
      </p>

      <button className="btn btn-primary" disabled={!!busy} onClick={() => void run()}>
        {busy ? 'Working…' : 'Build it'}
      </button>

      {busy && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: '#334155', margin: 0 }}>
            {busy}
            {count ? ` — ${count.done.toLocaleString('en-GB')} of ${count.total.toLocaleString('en-GB')}` : '…'}
          </p>
          {count && (
            <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, marginTop: 6, maxWidth: 320 }}>
              <div style={{
                height: 4, borderRadius: 2, background: '#0f172a',
                width: `${Math.round((count.done / Math.max(count.total, 1)) * 100)}%`,
              }} />
            </div>
          )}
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
            A hundred and seventy thousand postings takes about a minute. The page stays usable.
          </p>
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}

      {result && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          <b>Built.</b> It should have opened in a new tab — if your browser blocked that, use the
          links below.
          <div style={{ marginTop: 8, display: 'flex', gap: 14, alignItems: 'center' }}>
            <a href={result.url} target="_blank" rel="noopener noreferrer"
              style={{ fontWeight: 600 }}>Open it</a>
            <a href={result.url} download={fileName}>Save it as {fileName}</a>
          </div>
          <div style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>
            {result.months} months · {result.postings.toLocaleString('en-GB')} postings ·{' '}
            {result.accounts.toLocaleString('en-GB')} accounts ·{' '}
            {result.exceptions.toLocaleString('en-GB')} review findings ·{' '}
            {result.trialBalances} trial balance{result.trialBalances === 1 ? '' : 's'} ·{' '}
            {(result.size / 1024 / 1024).toFixed(1)} MB
            <br />
            <b>Opening balances:</b>{' '}
            {result.openingFrom
              ? `derived from the ${result.openingFrom} trial balance, so the balance sheet is a position.`
              : 'none held, so the balance sheet is movement since the first month, not a position.'}
            <br />
            <b>Sections switched off</b> for want of a feed: {result.sectionsOff.join(', ')}.
          </div>
        </div>
      )}
    </div>
  );
}
