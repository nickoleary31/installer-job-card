"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadCurrentAuthUserContext, type AuthUserContext } from "@/lib/auth/userContext";
import { supabase } from "@/lib/supabase/client";

type AuthUserContextState = {
  loading: boolean;
  context: AuthUserContext;
  refresh: () => Promise<void>;
};

const emptyContext: AuthUserContext = {
  userId: null,
  displayName: null,
  email: null,
  phone: null,
  jobTitle: null,
  globalRole: null,
  profileIsActive: false,
  onboardingCompleted: true,
  companyIds: [],
  companyRolesById: {},
};

const AuthUserContextReact = createContext<AuthUserContextState>({
  loading: true,
  context: emptyContext,
  refresh: async () => {},
});

declare global {
  interface Window {
    __installerAuthUserContext?: AuthUserContext;
  }
}

export function AuthUserContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; context: AuthUserContext }>({
    loading: true,
    context: emptyContext,
  });

  const refresh = useCallback(async () => {
    try {
      const context = await loadCurrentAuthUserContext();
      setState({ loading: false, context });

      if (typeof window !== "undefined") {
        window.__installerAuthUserContext = context;
      }
      console.info("[auth-context]", {
        userId: context.userId,
        displayName: context.displayName,
        email: context.email,
        globalRole: context.globalRole,
        onboardingCompleted: context.onboardingCompleted,
        companyIds: context.companyIds,
        companyRolesById: context.companyRolesById,
      });
    } catch (e) {
      console.warn("[auth-context] failed to load user context", e);
      setState({ loading: false, context: emptyContext });
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      await refresh();
      if (!isMounted) return;
    };

    void run();
    const { data: authSubscription } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });

    return () => {
      isMounted = false;
      authSubscription.subscription.unsubscribe();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading: state.loading,
      context: state.context,
      refresh,
    }),
    [state, refresh],
  );

  return <AuthUserContextReact.Provider value={value}>{children}</AuthUserContextReact.Provider>;
}

export function useAuthUserContext() {
  return useContext(AuthUserContextReact);
}
