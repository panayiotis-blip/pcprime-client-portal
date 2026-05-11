import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const MODE = import.meta.env.MODE; // 'development' | 'production' | 'preview' (Vercel sets MODE=production for preview too)
const RELEASE = import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined;

// Initialise only when:
//   (a) a DSN is provided in the environment (so the SDK stays silent until
//       the user wires up Sentry in Vercel), AND
//   (b) we're not in local dev — local errors should hit the console, not
//       count against the Sentry quota.
export function initSentry() {
  if (!DSN) return;
  if (MODE === 'development') return;

  Sentry.init({
    dsn: DSN,
    release: RELEASE,
    environment: MODE,
    // Performance monitoring at a low rate keeps us well inside the free
    // tier while still surfacing slow pages.
    tracesSampleRate: 0.1,
    // Strip query strings from URLs in case of accidentally-logged tokens
    beforeSend(event) {
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          event.request.url = `${url.origin}${url.pathname}`;
        } catch {}
      }
      return event;
    },
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
