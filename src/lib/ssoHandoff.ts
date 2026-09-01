import { supabase, supabaseUrl } from './supabase';

/**
 * Single sign-on from the mobile app.
 *
 * The app opens this site with a one-time code in the URL fragment
 * (`#sso=…`). We trade it for a session over HTTPS and drop it from the URL,
 * so the person who was already signed in on their phone is not asked again on
 * a phone keyboard.
 *
 * The fragment, not the query string: it is never sent to the server, so the
 * code stays out of Vercel's access logs and out of any Referer header. And a
 * code rather than the tokens themselves, because a URL gets copied, logged
 * and kept in history — see migration 179.
 *
 * This runs before React mounts (see main.tsx). It has to: a component tree
 * that renders first would flash the sign-in screen, and AuthContext would
 * have already decided nobody is here.
 */

const FRAGMENT_KEY = 'sso';

/** Cheap synchronous check, so a normal visit is not delayed by an await. */
export function hasSsoHandoff(): boolean {
  return readCode() !== null;
}

function readCode(): string | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  const code = params.get(FRAGMENT_KEY);
  return code && code.length > 0 ? code : null;
}

/** Takes the code out of the address bar without adding a history entry. */
function clearFragment() {
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', pathname + search);
}

export type SsoOutcome = 'signed-in' | 'rejected' | 'none';

export async function consumeSsoHandoff(): Promise<SsoOutcome> {
  const code = readCode();
  if (!code) return 'none';

  // Out of the URL first, whatever happens next. A refresh must not replay it,
  // and a failed code should not sit in the address bar.
  clearFragment();

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/sso-exchange`, {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok || !out?.access_token || !out?.refresh_token) return 'rejected';

    const { error } = await supabase.auth.setSession({
      access_token: out.access_token,
      refresh_token: out.refresh_token,
    });
    if (error) return 'rejected';

    return 'signed-in';
  } catch {
    // Offline, or the function is down. Fall through to the normal sign-in
    // screen rather than blocking the app on a hand-off that cannot complete.
    return 'rejected';
  }
}
