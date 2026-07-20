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
    // GDPR: never attach IP / cookies / headers automatically.
    sendDefaultPii: false,
    // Strip personal data from every event before it leaves the browser:
    // query strings (may carry tokens), user identifiers, and request
    // headers/cookies/body. Breadcrumb URLs are stripped of query strings too.
    beforeSend(event) {
      const stripQuery = (u?: string) => {
        if (!u) return u;
        try { const p = new URL(u); return `${p.origin}${p.pathname}`; } catch { return u.split('?')[0]; }
      };
      if (event.request?.url) event.request.url = stripQuery(event.request.url);
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete (event.request as any).data;
      }
      // Keep only a non-identifying id, if any — drop email / ip / username.
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(b =>
          b?.data && typeof b.data.url === 'string'
            ? { ...b, data: { ...b.data, url: stripQuery(b.data.url) } }
            : b);
      }
      return event;
    },
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
