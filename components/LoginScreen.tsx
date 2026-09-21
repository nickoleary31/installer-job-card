"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { ACCEPT_INVITE_PATH } from "@/lib/auth/onboarding";
import { appRoutes } from "@/lib/app-routes";
import { loadCurrentAuthUserContext } from "@/lib/auth/userContext";
import { supabase } from "@/lib/supabase/client";

/**
 * The real Installer Sheetz login form (email/password via Supabase).
 * Shared between the web app's /login route and the mobile-web static
 * export so both render the exact same component — see app/login/page.tsx.
 * Since Capacitor always cold-starts at this route (mobile-web's "/"), it
 * is also the Phase 2C offline entry point: a technician who already has
 * an online session or a valid offline access lease is redirected away
 * automatically, and one with neither (native only — see auth-state.ts's
 * module doc on why this never applies to the web build) sees an honest
 * locked state instead of a form that cannot possibly work without a
 * network. `authMode === "offline-locked"` already encodes "genuinely
 * offline (or server-unavailable) AND no usable lease" — no separate
 * network poll is needed here to gate that.
 */
export function LoginScreen() {
  const router = useRouter();
  const { loading: authLoading, context, authMode, offlineLockReason, refresh } = useAuthUserContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingAgain, setCheckingAgain] = useState(false);

  // Already authenticated (online or via a valid offline access lease) —
  // land on the app instead of showing the form. Mirrors the redirect
  // handleLogin already does after a fresh sign-in.
  useEffect(() => {
    if (authLoading) return;
    if (authMode === "online" && context.userId) {
      router.replace(context.onboardingCompleted ? appRoutes.home() : ACCEPT_INVITE_PATH);
    } else if (authMode === "offline-authorized") {
      router.replace(appRoutes.home());
    }
  }, [authLoading, authMode, context.userId, context.onboardingCompleted, router]);

  const handleLogin = async () => {
    setError(null);
    const emailTrimmed = email.trim();
    if (!emailTrimmed || !password) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });
      if (signInError) throw signInError;

      const loggedInContext = await loadCurrentAuthUserContext();
      router.replace(loggedInContext.onboardingCompleted ? appRoutes.home() : ACCEPT_INVITE_PATH);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to log in";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckAgain = async () => {
    setCheckingAgain(true);
    try {
      await refresh();
    } finally {
      setCheckingAgain(false);
    }
  };

  // While auth resolution is genuinely pending (including the fast native
  // definitively-offline path — see lib/auth/userContext.ts's
  // UserContextDeps doc — which still needs a moment to read the local
  // session/lease), never fall through to the login form below: that would
  // falsely suggest a login is required right before the app silently
  // authenticates offline without any user action. A password form the app
  // hasn't yet determined is even needed is exactly the misleading UX this
  // guards against.
  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-50 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <div className="mx-auto max-w-md space-y-4 px-4">
          <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <h1 className="text-2xl font-bold tracking-tight text-gray-950">Checking access…</h1>
            <p className="mt-2 text-sm text-gray-600">Restoring your session…</p>
          </header>
        </div>
      </main>
    );
  }

  // Offline (or the server is unavailable) with no usable lease: a
  // password form would just fail on submit, so say so honestly instead of
  // pretending it might work. Distinguishes an EXPIRED lease (truthful,
  // specific copy — this device DID work offline before) from never having
  // had one / an invalid one (the generic "no offline access" copy) per
  // the product spec. Native-only in practice: on the web build, authMode
  // never becomes "offline-locked" (see auth-state.ts's module doc), so
  // this branch simply never renders there.
  if (!authLoading && authMode === "offline-locked") {
    const isExpired = offlineLockReason === "expired";
    return (
      <main className="min-h-screen bg-slate-50 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <div className="mx-auto max-w-md space-y-4 px-4">
          <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <h1 className="text-2xl font-bold tracking-tight text-gray-950">
              {isExpired ? "Offline access has expired" : "No offline access on this device"}
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {isExpired
                ? "Connect to the internet to verify your account."
                : "Connect to the internet to sign in. This device has no previously saved session to work from offline."}
            </p>
            <button
              type="button"
              onClick={() => void handleCheckAgain()}
              disabled={checkingAgain}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {checkingAgain ? "Checking..." : "Check again"}
            </button>
          </header>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-md space-y-4 px-4">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Log in</h1>
          <p className="mt-1 text-sm text-gray-600">Use your Supabase email/password account.</p>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 sm:text-sm"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 sm:text-sm"
                autoComplete="current-password"
              />
            </div>
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

          <div className="mt-5 flex items-center justify-between">
            <Link href={appRoutes.home()} className="text-sm font-semibold text-blue-700 hover:underline">
              Back to app
            </Link>
            <button
              type="button"
              onClick={() => void handleLogin()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? "Logging in..." : "Log in"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
