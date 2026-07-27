import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSentry, SentryErrorBoundary } from './sentry';
import './index.css';
import './styles/design-system.css';

initSentry();

// Clean up any leftover service worker / caches from previous PWA builds.
// A stale SW paints the OLD cached app first, then the new bundle swaps in —
// which looks like the page "loads old then renews". So when we actually find
// and remove a stale SW, we reload ONCE (guarded against a loop) so the fresh
// app loads cleanly instead of flashing the old one.
if ('serviceWorker' in navigator) {
  // Whether a service worker is actively serving THIS page (i.e. could be
  // serving stale cached content). Captured before we unregister.
  const controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    if (registrations.length === 0) return;
    await Promise.all(registrations.map((reg) => reg.unregister()));
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    // Only reload if this page was actually being served by the old SW — and
    // only once per session — so a fresh (uncontrolled) load never reloads.
    if (controlled && !sessionStorage.getItem('pc_sw_cleaned')) {
      sessionStorage.setItem('pc_sw_cleaned', '1');
      window.location.reload();
    }
  }).catch(() => { /* best-effort */ });
}

function ErrorFallback() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, textAlign: 'center', color: '#0f172a',
    }}>
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: '#475569', marginBottom: 20 }}>
          The page hit an unexpected error. We've been notified and will look into it.
          Try refreshing — if the problem keeps happening, contact us at{' '}
          <a href="mailto:info@primeandcalculate.com">info@primeandcalculate.com</a>.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Refresh the page
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>
);
