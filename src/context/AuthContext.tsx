import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, type AuthUser } from '../services/api';
import { supabase } from '../lib/supabase';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';

const INACTIVITY_MS = 10 * 60 * 1000;

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, loading: true,
  login: async () => {}, sendMagicLink: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const reload = async () => {
      try {
        const { user } = await api.me();
        if (mounted) setUser(user);
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    reload();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { reload(); });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const login = async (emailOrUsername: string, password: string) => {
    await api.login(emailOrUsername, password);
    const { user } = await api.me();
    setUser(user);
  };

  const sendMagicLink = async (email: string) => {
    await api.sendMagicLink(email);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  useInactivityTimeout(INACTIVITY_MS, () => { if (user) logout(); });

  return (
    <AuthContext.Provider value={{ user, loading, login, sendMagicLink, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
