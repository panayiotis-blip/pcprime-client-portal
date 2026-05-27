import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type AuthUser } from '../services/api';
import { supabase } from '../lib/supabase';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';

// Inactivity timeouts:
//   - 8 hours on a "trusted" device (user has ticked the box after MFA)
//   - 1 hour otherwise
// Auto-logout invalidates the session and forces a fresh password (and MFA, if
// untrusted) on next visit.
const INACTIVITY_TRUSTED_MS   = 8 * 60 * 60 * 1000;
const INACTIVITY_UNTRUSTED_MS = 1 * 60 * 60 * 1000;

// localStorage key used to remember a per-device trust token.
export const TRUSTED_DEVICE_TOKEN_KEY = 'pcprime_trusted_device_token';

interface MfaState {
  enrolled: boolean;
  challenge_required: boolean;
  trusted_device_validated: boolean;   // true if a stored token verified successfully
  current_level: 'aal1' | 'aal2' | null;
  next_level:    'aal1' | 'aal2' | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  mfa: MfaState;
  refreshMfa: () => Promise<void>;
  refreshUser: () => Promise<void>;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const initialMfa: MfaState = {
  enrolled: false,
  challenge_required: false,
  trusted_device_validated: false,
  current_level: null,
  next_level: null,
};

const AuthContext = createContext<AuthState>({
  user: null, loading: true,
  mfa: initialMfa,
  refreshMfa: async () => {},
  refreshUser: async () => {},
  login: async () => {}, sendMagicLink: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfa, setMfa] = useState<MfaState>(initialMfa);

  const loadMfa = useCallback(async () => {
    try {
      const [aal, factors] = await Promise.all([
        api.getMfaAal(),
        api.listMfaFactors(),
      ]);
      const totp: any[] = (factors as any)?.totp || [];
      const enrolled = totp.some(f => f.status === 'verified');

      // Check trusted-device token (only if user actually has MFA enrolled —
      // otherwise the trust check is moot).
      let trusted = false;
      if (enrolled) {
        const token = localStorage.getItem(TRUSTED_DEVICE_TOKEN_KEY);
        if (token) {
          trusted = await api.verifyTrustedDevice(token);
          if (!trusted) {
            // Stale or revoked token; clean up so we don't keep re-checking it.
            localStorage.removeItem(TRUSTED_DEVICE_TOKEN_KEY);
          }
        }
      }

      setMfa({
        enrolled,
        challenge_required: aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2',
        trusted_device_validated: trusted,
        current_level: (aal.currentLevel as any) || null,
        next_level:    (aal.nextLevel as any)    || null,
      });
    } catch {
      setMfa(initialMfa);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const reload = async () => {
      try {
        const { user } = await api.me();
        if (!mounted) return;
        setUser(user);
        if (user) await loadMfa(); else setMfa(initialMfa);
      } catch {
        if (mounted) { setUser(null); setMfa(initialMfa); }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    reload();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { reload(); });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [loadMfa]);

  const refreshUser = useCallback(async () => {
    try { const { user } = await api.me(); setUser(user); } catch { /* ignore */ }
  }, []);

  const login = async (emailOrUsername: string, password: string) => {
    await api.login(emailOrUsername, password);
    const { user } = await api.me();
    setUser(user);
    if (user) await loadMfa();
  };

  const sendMagicLink = async (email: string) => {
    await api.sendMagicLink(email);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setMfa(initialMfa);
  };

  // Inactivity timeout — duration depends on whether this device is trusted.
  const inactivityMs = mfa.trusted_device_validated ? INACTIVITY_TRUSTED_MS : INACTIVITY_UNTRUSTED_MS;
  useInactivityTimeout(inactivityMs, () => { if (user) logout(); });

  return (
    <AuthContext.Provider value={{ user, loading, mfa, refreshMfa: loadMfa, refreshUser, login, sendMagicLink, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
