import * as LocalAuthentication from 'expo-local-authentication';
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import * as portal from '../api/portal';
import { Account, Role } from '../data/types';
import { supabase } from '../lib/supabase';
import { registerForPush, unregisterPush } from '../lib/push';

type Session = {
  /** Null until the stored session has been checked. */
  ready: boolean;
  account: Account | null;
  role: Role;
  /** Signed in, but the second factor is still outstanding. */
  mfaPending: boolean;
  /** The client whose data the app is showing. Null for staff. */
  clientId: number | null;
  /** Whether this device can do Face ID / fingerprint at all. */
  biometricsAvailable: boolean;

  signIn: (emailOrUsername: string, password: string) => Promise<string | null>;
  verifyTotp: (code: string) => Promise<string | null>;
  unlockWithBiometrics: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

/**
 * The signed-in session.
 *
 * Supabase holds the tokens in the device keystore and refreshes them, so the
 * app reads the account rather than owning it — `onAuthStateChange` is the
 * single source of truth and a refresh failure signs the user out everywhere
 * at once.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [mfaPending, setMfaPending] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  /** Re-read who we are. Called on every auth event. */
  const sync = useCallback(async () => {
    try {
      const pending = (await portal.hasSession()) ? await portal.mfaChallengeRequired() : false;
      setMfaPending(pending);

      // Until the second factor clears, RLS treats the user as unverified —
      // reading the profile would come back empty and look like a bad account.
      setAccount(pending ? null : await portal.loadAccount());
    } catch {
      setAccount(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    sync();
    const { data } = supabase.auth.onAuthStateChange(() => {
      sync();
    });
    return () => data.subscription.unsubscribe();
  }, [sync]);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync()
      .then(async (hardware) => hardware && (await LocalAuthentication.isEnrolledAsync()))
      .then(setBiometricsAvailable)
      .catch(() => setBiometricsAvailable(false));
  }, []);

  // Tell the portal where to reach this device, once we know who owns it.
  useEffect(() => {
    if (!account) return;
    registerForPush();
  }, [account]);

  const signIn = useCallback(
    async (emailOrUsername: string, password: string) => {
      const result = await portal.signIn(emailOrUsername, password);
      if (!result.ok) return result.error;
      await sync();
      return null;
    },
    [sync],
  );

  const verifyTotp = useCallback(
    async (code: string) => {
      const result = await portal.verifyTotp(code);
      if (!result.ok) return result.error;
      await sync();
      return null;
    },
    [sync],
  );

  /**
   * Biometric unlock is not a second credential — the refresh token is already
   * in the keystore. The prompt guards re-entry into an existing session.
   */
  const unlockWithBiometrics = useCallback(async () => {
    if (!(await portal.hasSession())) {
      return 'Sign in once with your password first, then Face ID will work.';
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Prime & Calculate',
      fallbackLabel: 'Use password',
    });
    if (!result.success) return null; // Cancelled — not an error worth showing.

    await sync();
    return null;
  }, [sync]);

  const signOut = useCallback(async () => {
    await unregisterPush();
    await portal.signOut();
    setAccount(null);
    setMfaPending(false);
  }, []);

  const value = useMemo<Session>(
    () => ({
      ready,
      account,
      role: account?.role ?? 'client',
      mfaPending,
      clientId: account?.clientIds[0] ?? null,
      biometricsAvailable,
      signIn,
      verifyTotp,
      unlockWithBiometrics,
      signOut,
    }),
    [ready, account, mfaPending, biometricsAvailable, signIn, verifyTotp, unlockWithBiometrics, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The signed-in client's id, or null.
 *
 * Null is a real state, not a bug: a staff account has no client of its own,
 * a newly invited client may not be linked yet, and every screen renders once
 * before the auth redirect settles. Callers show `<NoClientLinked />` rather
 * than querying client 0 or throwing.
 */
export function useClientId(): number | null {
  return useSession().clientId;
}
