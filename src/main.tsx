import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSentry, SentryErrorBoundary } from './sentry';
import './index.css';

initSentry();

// Unregister any stuck service workers from previous PWA builds
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
      console.log('Unregistered old service worker:', reg.scope);
    }
  });
  // Clear all caches
  if ('caches' in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        caches.delete(name);
        console.log('Deleted cache:', name);
      }
    });
  }
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
