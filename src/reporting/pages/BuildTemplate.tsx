// Reports → Build the template.
//
// One button. It reads this client's data through the signed-in session and
// hands back template-app.built_5.html with that data in place of the sample
// blob — the app as designed, showing real figures, in a single file that
// needs no server and no login to open.
//
// It runs here rather than as a script because the browser is already
// authenticated: every read goes through RLS exactly as any other screen's
// does, and no password has to exist anywhere for it to work.

import { useState } from 'react';
import { useReportingSession } from '../session';
import { buildPayload, buildTemplateHtml, type BuildResult } from '../lib/reports/buildPayload.ts';

export default function BuildTemplate() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [result, setResult] = useState<(BuildResult & { size: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy('Starting'); setError(null); setResult(null); setCount(null);
    try {
      const built = await buildPayload(clientId, (step, done) => {
        setBusy(step);
        setCount(done ?? null);
      });
      setBusy('Writing the file');
      const blob = await buildTemplateHtml(built.json);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporting-${client!.code ?? clientId}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setResult({ ...built, size: blob.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setCount(null); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Build the template</h1>
      <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 16px' }}>
        Takes this client's figures and writes them into the reporting template, as one file you
        can open in any browser. Nothing is uploaded and nothing is changed — it only reads.
      </p>

      <button className="btn btn-primary" disabled={!!busy} onClick={() => void run()}>
        {busy ? `${busy}${count ? ` — ${count.toLocaleString('en-GB')}` : ''}…` : 'Build it'}
      </button>

      {busy && (
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
          Reading a hundred and seventy thousand postings a page at a time takes about a minute.
        </p>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}

      {result && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          <b>Built — check your downloads.</b>
          <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.7 }}>
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
