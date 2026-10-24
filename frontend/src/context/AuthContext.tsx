import { useLocale } from "../i18n";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/client";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (access: string, refresh: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem("orthomed_access")) {
      setLoading(false);
      return;
    }
    authApi.me().then(setUser).catch(() => {
      localStorage.removeItem("orthomed_access");
      localStorage.removeItem("orthomed_refresh");
    }).finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    login: (access: string, refresh: string, nextUser: User) => {
      localStorage.setItem("orthomed_access", access);
      localStorage.setItem("orthomed_refresh", refresh);
      setUser(nextUser);
    },
    logout: () => {
      localStorage.removeItem("orthomed_access");
      localStorage.removeItem("orthomed_refresh");
      setUser(null);
    },
    refreshUser: async () => {
      try {
        const nextUser = await authApi.me();
        setUser(nextUser);
        return nextUser;
      } catch {
        return null;
      }
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
