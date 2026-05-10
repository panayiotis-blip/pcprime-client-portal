import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type AuthUser } from '../services/api';
import { supabase } from '../lib/supabase';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';

const INACTIVITY_MS = 8 * 60 * 60 * 1000; // 8 hours of inactivity → auto sign-out

interface MfaState {
  enrolled: boolean;        // user has at least one verified TOTP factor
  challenge_required: boolean; // session is at aal1 but the user has aal2-eligible factors
  current_level: 'aal1' | 'aal2' | null;
  next_level: 'aal1' | 'aal2' | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  mfa: MfaState;
  refreshMfa: () => Promise<void>;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const initialMfa: MfaState = {
  enrolled: false,
  challenge_required: false,
  current_level: null,
  next_level: null,
};

const AuthContext = createContext<AuthState>({
  user: null, loading: true,
  mfa: initialMfa,
  refreshMfa: async () => {},
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
      setMfa({
        enrolled,
        challenge_required: aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2',
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

  useInactivityTimeout(INACTIVITY_MS, () => { if (user) logout(); });

  return (
    <AuthContext.Provider value={{ user, loading, mfa, refreshMfa: loadMfa, login, sendMagicLink, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
