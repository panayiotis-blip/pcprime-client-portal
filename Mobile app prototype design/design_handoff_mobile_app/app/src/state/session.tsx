import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

import * as portal from '../api/portal';
import { profile } from '../data/mock';
import { staffProfile } from '../data/staff';
import { Role } from '../data/types';

type Session = {
  authed: boolean;
  /** Drives the tab set and which screens exist. Comes from the portal. */
  role: Role;
  /** The client's own profile. Only meaningful in client mode. */
  user: typeof profile;
  /** The signed-in accountant. Only meaningful in staff mode. */
  staff: typeof staffProfile;
  /** Returns an error message, or null on success. */
  signIn: (email: string, password: string) => string | null;
  /** Face ID takes the same success path in the prototype. */
  signInWithBiometrics: () => void;
  signOut: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

/**
 * Sign-in state.
 *
 * Nothing is persisted yet — the real build shares a session with the portal
 * over SSO and keeps a refresh token in secure storage, which is also what
 * biometric unlock should re-use.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<Role>('client');

  const signIn = useCallback((email: string, password: string) => {
    const result = portal.signIn(email, password);
    if (!result.ok) return result.error;
    setRole(result.role);
    setAuthed(true);
    return null;
  }, []);

  // Biometric unlock is a client-device affordance; it resumes the client
  // session rather than choosing a role.
  const signInWithBiometrics = useCallback(() => {
    setRole('client');
    setAuthed(true);
  }, []);

  const signOut = useCallback(() => {
    setAuthed(false);
    setRole('client');
  }, []);

  const value = useMemo(
    () => ({
      authed,
      role,
      user: profile,
      staff: staffProfile,
      signIn,
      signInWithBiometrics,
      signOut,
    }),
    [authed, role, signIn, signInWithBiometrics, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
