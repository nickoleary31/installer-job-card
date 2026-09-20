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
    // Elapsed time is the one diagnostic that materially helps future
    // support here — a single number, not a running trace — since the
    // whole point of the native definitively-offline fast path (see
    // lib/auth/userContext.ts) is that this resolution should be fast; a
    // report of "still slow" is immediately actionable from this one line
    // without needing to reproduce with extra logging first.
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
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
      const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
      console.info("[auth-context]", {
        userId: resolved.context.userId,
        displayName: resolved.context.displayName,
        email: resolved.context.email,
        globalRole: resolved.context.globalRole,
        onboardingCompleted: resolved.context.onboardingCompleted,
        companyIds: resolved.context.companyIds,
        companyRolesById: resolved.context.companyRolesById,
        authMode: resolved.mode,
        elapsedMs,
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

    // Re-resolves on EITHER transition, for two independent reasons:
    //  - offline -> online: deactivation revocation (see lib/auth/auth-state.ts)
    //    can only happen on the "next successful server contact" — without
    //    this, a device that goes offline-authorized and later regains
    //    connectivity while the app stays open (no restart, no auth event)
    //    might never re-attempt online resolution and notice a revoked/
    //    deactivated user.
    //  - online -> offline: without this, a live connectivity drop while the
    //    app stays open on an "online" screen was never re-evaluated at all
    //    until some unrelated trigger (an auth event, a restart) happened to
    //    fire — the app would just keep showing stale online-mode state.
    //    Re-resolving promptly here is what lets the now-fast native
    //    definitively-offline path in lib/auth/userContext.ts's
    //    resolveAuthUserContext() take over immediately instead of waiting
    //    on a doomed online request to eventually fail.
    const networkStatus = getNetworkStatus();
    let wasOnline = networkStatus.isOnline();
    const unsubscribeNetwork = networkStatus.subscribe((online) => {
      if (online !== wasOnline) void refresh();
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
