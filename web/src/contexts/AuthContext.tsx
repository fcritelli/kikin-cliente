import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  storeTokens,
  type PublicAccount,
  type Tokens,
} from "@/lib/api";

interface AuthContextValue {
  account: PublicAccount | null;
  /** true enquanto o boot (validar sessão salva via /me) não termina */
  booting: boolean;
  /** true quando há sessão válida (account carregado ou otimista com token) */
  authed: boolean;
  applySession: (tokens: Tokens) => Promise<PublicAccount | null>;
  /** Recarrega /me e atualiza o account (usado após editar perfil/whatsapp). */
  reloadAccount: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [booting, setBooting] = useState(true);

  const loadMe = useCallback(async (): Promise<PublicAccount | null> => {
    try {
      const { account: me } = await api.me();
      setAccount(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  /** Persiste os tokens e busca /me; devolve a conta (ou null se /me falhar). */
  const applySession = useCallback(
    async (tokens: Tokens): Promise<PublicAccount | null> => {
      storeTokens(tokens);
      const me = await loadMe();
      return me;
    },
    [loadMe]
  );

  // Boot: se há access token salvo, valida via /me; se expirou, tenta refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const access = getAccessToken();
      const refresh = getRefreshToken();
      if (!access) {
        if (!cancelled) setBooting(false);
        return;
      }
      let me = await loadMe();
      if (!me && refresh) {
        try {
          const { tokens } = await api.refresh(refresh);
          storeTokens(tokens);
          me = await loadMe();
        } catch {
          clearTokens();
        }
      }
      if (!me) clearTokens();
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const reloadAccount = useCallback(async (): Promise<void> => {
    const me = await loadMe();
    if (!me) clearTokens();
  }, [loadMe]);

  const logout = useCallback(async (): Promise<void> => {
    const refresh = getRefreshToken();
    if (refresh) api.logout(refresh).catch(() => undefined);
    clearTokens();
    setAccount(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      booting,
      authed: account !== null,
      applySession,
      reloadAccount,
      logout,
    }),
    [account, booting, applySession, reloadAccount, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>.");
  return ctx;
}
