"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { resolveAuthState, type AuthMode, type OfflineLockReason } from "@/lib/auth/auth-state";
import type { OfflineAccessLease } from "@/lib/auth/offline-access-lease";
import { resolveAuthUserContext, type AuthUserContext } from "@/lib/auth/userContext";
import { getNetworkStatus } from "@/lib/native/network-status";
import { supabase } from "@/lib/supabase/client";

type AuthUserContextState = {
  loading: boolean;
  context: AuthUserContext;
  /**
   * Phase 2C — why `context` is what it is. Existing consumers that only
   * destructure {loading, context} are unaffected; ActiveProjectsScreen and
   * LoginScreen are the two that act on this directly. See
   * lib/auth/auth-state.ts for the full state-machine rationale.
   */
  authMode: AuthMode;
  /** Set only when authMode === "offline-authorized". */
  lease: OfflineAccessLease | null;
  /** Set only when authMode === "offline-locked" — which UI copy to show. */
  offlineLockReason: OfflineLockReason | null;
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
  authMode: "signed-out",
  lease: null,
  offlineLockReason: null,
  refresh: async () => {},
});

declare global {
  interface Window {
    __installerAuthUserContext?: AuthUserContext;
  }
}

export function AuthUserContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    loading: boolean;
    context: AuthUserContext;
    authMode: AuthMode;
    lease: OfflineAccessLease | null;
    offlineLockReason: OfflineLockReason | null;
  }>({
    loading: true,
    context: emptyContext,
    authMode: "signed-out",
    lease: null,
    offlineLockReason: null,
  });

  const refresh = useCallback(async () => {
    try {
      const result = await resolveAuthUserContext();
      const resolved = await resolveAuthState(result);
      setState({
        loading: false,
        context: resolved.context,
        authMode: resolved.mode,
        lease: resolved.lease,
        offlineLockReason: resolved.offlineLockReason,
      });

      if (typeof window !== "undefined") {
        window.__installerAuthUserContext = resolved.context;
      }
      console.info("[auth-context]", {
        userId: resolved.context.userId,
        displayName: resolved.context.displayName,
        email: resolved.context.email,
        globalRole: resolved.context.globalRole,
        onboardingCompleted: resolved.context.onboardingCompleted,
        companyIds: resolved.context.companyIds,
        companyRolesById: resolved.context.companyRolesById,
        authMode: resolved.mode,
      });
    } catch (e) {
      console.warn("[auth-context] failed to load user context", e);
      setState({ loading: false, context: emptyContext, authMode: "signed-out", lease: null, offlineLockReason: null });
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

    // Deactivation revocation (see lib/auth/auth-state.ts) can only happen
    // on the "next successful server contact" — without this, a device
    // that goes offline-authorized and later regains connectivity while
    // the app stays open (no restart, no auth event) might never
    // re-attempt online resolution and notice a revoked/deactivated user.
    const networkStatus = getNetworkStatus();
    let wasOnline = networkStatus.isOnline();
    const unsubscribeNetwork = networkStatus.subscribe((online) => {
      if (online && !wasOnline) void refresh();
      wasOnline = online;
    });

    return () => {
      isMounted = false;
      authSubscription.subscription.unsubscribe();
      unsubscribeNetwork();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading: state.loading,
      context: state.context,
      authMode: state.authMode,
      lease: state.lease,
      offlineLockReason: state.offlineLockReason,
      refresh,
    }),
    [state, refresh],
  );

  return <AuthUserContextReact.Provider value={value}>{children}</AuthUserContextReact.Provider>;
}

export function useAuthUserContext() {
  return useContext(AuthUserContextReact);
}
