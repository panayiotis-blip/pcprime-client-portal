import { useEffect, useState } from 'react';

// The screen shown while the app is still working out who you are.
//
// It used to say "Loading..." for as long as that took — which, when the
// database was unreachable, was forever. An outage therefore looked exactly
// like a frozen app, and took twenty minutes of guessing to identify. This says
// so instead: after a few seconds it admits it is slow, and after a while it
// names the likely reason and offers to try again.
//
// It never decides you are signed out. Guessing that on a timeout would drop a
// signed-in user onto the landing page and lose their place, so the wait
// continues underneath — this only changes what the wait LOOKS like.

const SLOW_AFTER = 6000;     // long enough not to flicker on a normal load
const STALLED_AFTER = 18000; // by now something is actually wrong

export const SERVER_HINT =
  'The portal loaded, but the database is not answering — so this is almost always the server rather than your ' +
  'computer or your connection. It usually clears on its own; if it does not, the database needs looking at.';
export const PAGE_LOAD_HINT =
  'This page’s files have not arrived. That is usually a network hiccup or a deploy landing mid-visit, and reloading fixes it.';

export default function ConnectingScreen({ label = 'Loading…', hint = SERVER_HINT }: { label?: string; hint?: string }) {
  const [phase, setPhase] = useState<'normal' | 'slow' | 'stalled'>('normal');

  useEffect(() => {
    const a = setTimeout(() => setPhase('slow'), SLOW_AFTER);
    const b = setTimeout(() => setPhase('stalled'), STALLED_AFTER);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  if (phase === 'normal') return <div className="loading-screen">{label}</div>;

  return (
    <div className="loading-screen" style={{ flexDirection: 'column', gap: 10, textAlign: 'center', padding: 24 }}>
      {phase === 'slow' ? (
        <>
          <div style={{ fontSize: 18 }}>Still connecting…</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420 }}>
            This is taking longer than usual.
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 18, color: '#b91c1c' }}>Can’t reach the server</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 460, lineHeight: 1.6 }}>
            {hint}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
