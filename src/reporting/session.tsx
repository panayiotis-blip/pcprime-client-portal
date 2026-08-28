// The client is chosen once, at the reporting sign-in, and fixed for the
// session. BUILD.md §7.1 and §12: there is no client dropdown inside the
// application, and a file can only ever land against the client in the
// session. Changing client means signing out of the reporting app.
//
// This is a convenience, not a control — RLS is the control. It exists so
// that no screen has to remember to filter, and so a person always knows
// whose figures are in front of them.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ReportingClient = { id: number; name: string; code: string | null };

type Ctx = {
  client: ReportingClient | null;
  choose: (c: ReportingClient) => void;
  leave: () => void;
};

const ReportingCtx = createContext<Ctx | null>(null);

// sessionStorage, not localStorage: closing the tab ends the session, and a
// second tab opened deliberately can sit on a different client without the
// two fighting over one key.
const KEY = 'reporting.client';

function load(): ReportingClient | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as ReportingClient;
    return typeof c?.id === 'number' && c.id > 0 ? c : null;
  } catch {
    return null;
  }
}

export function ReportingSession({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ReportingClient | null>(load);

  const choose = useCallback((c: ReportingClient) => {
    try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
    setClient(c);
  }, []);

  const leave = useCallback(() => {
    try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
    setClient(null);
  }, []);

  const value = useMemo(() => ({ client, choose, leave }), [client, choose, leave]);
  return <ReportingCtx.Provider value={value}>{children}</ReportingCtx.Provider>;
}

export function useReportingSession(): Ctx {
  const c = useContext(ReportingCtx);
  if (!c) throw new Error('useReportingSession outside ReportingSession');
  return c;
}

/**
 * The client id for a screen that cannot run without one. Throwing rather than
 * returning null is deliberate: a screen that renders with no client would
 * either show nothing or, worse, show everything.
 */
export function useClientId(): number {
  const { client } = useReportingSession();
  if (!client) throw new Error('No client is chosen for this reporting session.');
  return client.id;
}
