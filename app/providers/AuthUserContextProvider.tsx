"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadCurrentAuthUserContext, type AuthUserContext } from "@/lib/auth/userContext";
import { supabase } from "@/lib/supabase/client";

type AuthUserContextState = {
  loading: boolean;
  context: AuthUserContext;
};

const emptyContext: AuthUserContext = {
  userId: null,
  globalRole: null,
  companyIds: [],
  companyRolesById: {},
};

const AuthUserContextReact = createContext<AuthUserContextState>({
  loading: true,
  context: emptyContext,
});

declare global {
  interface Window {
    __installerAuthUserContext?: AuthUserContext;
  }
}

export function AuthUserContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthUserContextState>({
    loading: true,
    context: emptyContext,
  });

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      try {
        const context = await loadCurrentAuthUserContext();
        if (!isMounted) return;
        setState({ loading: false, context });

        // Dev/debug visibility only: do not use for auth enforcement.
        if (typeof window !== "undefined") {
          window.__installerAuthUserContext = context;
        }
        console.info("[auth-context]", {
          userId: context.userId,
          globalRole: context.globalRole,
          companyIds: context.companyIds,
          companyRolesById: context.companyRolesById,
        });
      } catch (e) {
        if (!isMounted) return;
        console.warn("[auth-context] failed to load user context", e);
        setState({ loading: false, context: emptyContext });
      }
    };

    void refresh();
    const { data: authSubscription } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });

    return () => {
      isMounted = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthUserContextReact.Provider value={value}>{children}</AuthUserContextReact.Provider>;
}

export function useAuthUserContext() {
  return useContext(AuthUserContextReact);
}

