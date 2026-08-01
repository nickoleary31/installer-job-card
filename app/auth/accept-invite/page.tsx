"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import {
  HOME_PATH,
  LOGIN_PATH,
  buildOnboardingProfileUpdate,
  describeInvalidInviteSessionMessage,
  hasOnboardingFormErrors,
  nextOnboardingWriteStep,
  urlLooksLikeInviteAuthCallback,
  validateOnboardingForm,
} from "@/lib/auth/onboarding";
import { loadCurrentAuthUserContext } from "@/lib/auth/userContext";
import { supabase } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

type SessionStatus = "loading" | "ready" | "missing";

function clearAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  for (const key of ["code", "token_hash", "type", "error", "error_description", "error_code"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

/**
 * Recover invite session from PKCE code, token_hash+type, or legacy hash tokens.
 * Must complete before any /login redirect from other pages.
 */
async function establishInviteSession(): Promise<{ ok: boolean; error?: string }> {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");

  const errorDescription =
    url.searchParams.get("error_description") ||
    url.searchParams.get("error") ||
    hashParams.get("error_description") ||
    hashParams.get("error");
  if (errorDescription) {
    return { ok: false, error: describeInvalidInviteSessionMessage() };
  }

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return { ok: false, error: describeInvalidInviteSessionMessage() };
    }
    clearAuthParamsFromUrl();
  } else {
    const tokenHash = url.searchParams.get("token_hash") || hashParams.get("token_hash");
    const typeRaw = (url.searchParams.get("type") || hashParams.get("type") || "").toLowerCase();
    if (tokenHash) {
      const type = (typeRaw || "invite") as EmailOtpType;
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (error) {
        return { ok: false, error: describeInvalidInviteSessionMessage() };
      }
      clearAuthParamsFromUrl();
      if (url.hash) {
        window.history.replaceState({}, document.title, url.pathname + url.search);
      }
    } else if (hashParams.has("access_token")) {
      // Legacy implicit invite hash — supabase-js parses hash when detectSessionInUrl is enabled.
      // Give the client a tick, then read the session.
      await new Promise((r) => setTimeout(r, 0));
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.user) {
        // Force a second read after getSessionFromUrl-style settle.
        await new Promise((r) => setTimeout(r, 50));
      }
      window.history.replaceState({}, document.title, url.pathname + url.search);
    }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (!userError && userData.user) return { ok: true };

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return { ok: true };

  // Still processing a callback URL — keep loading, do not mark invalid yet.
  if (typeof window !== "undefined" && urlLooksLikeInviteAuthCallback(window.location.href)) {
    return { ok: false, error: describeInvalidInviteSessionMessage() };
  }

  return { ok: false, error: describeInvalidInviteSessionMessage() };
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const { loading: authLoading, context, refresh } = useAuthUserContext();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passwordCreated, setPasswordCreated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSessionError(null);
      setSessionStatus("loading");
      const result = await establishInviteSession();
      if (cancelled) return;
      if (!result.ok) {
        setSessionStatus("missing");
        setSessionError(result.error || describeInvalidInviteSessionMessage());
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      const email = userData.user?.email?.trim() || "";
      setConfirmedEmail(email);

      await refresh();
      const latest = await loadCurrentAuthUserContext();
      if (cancelled) return;
      if (latest.onboardingCompleted) {
        router.replace(HOME_PATH);
        return;
      }
      if (latest.displayName) setFullName(latest.displayName);
      if (latest.phone) setPhone(latest.phone);
      if (latest.jobTitle) setJobTitle(latest.jobTitle);
      if (!email && latest.email) setConfirmedEmail(latest.email);
      setSessionStatus("ready");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [refresh, router]);

  useEffect(() => {
    if (sessionStatus !== "ready") return;
    if (authLoading) return;
    if (!context.userId) return;
    if (context.onboardingCompleted) {
      router.replace(HOME_PATH);
    }
  }, [authLoading, context.onboardingCompleted, context.userId, router, sessionStatus]);

  const handleSubmit = async () => {
    setError(null);
    setInfo(null);

    const formErrors = validateOnboardingForm({
      fullName,
      phone,
      jobTitle,
      password,
      confirmPassword,
    });
    if (hasOnboardingFormErrors(formErrors)) {
      setError(
        formErrors.fullName ||
          formErrors.phone ||
          formErrors.password ||
          formErrors.confirmPassword ||
          "Please fix the form and try again.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userData.user;
      if (!user) throw new Error(describeInvalidInviteSessionMessage());

      if (nextOnboardingWriteStep(passwordCreated) === "password" || !passwordCreated) {
        const { error: passwordError } = await supabase.auth.updateUser({ password });
        if (passwordError) throw passwordError;
        setPasswordCreated(true);
        setInfo("Password saved. Finishing your profile…");
      }

      const patch = buildOnboardingProfileUpdate({
        fullName,
        phone,
        jobTitle,
        email: user.email?.trim().toLowerCase() || confirmedEmail || null,
      });
      const { error: profileError } = await supabase.from("user_profiles").update(patch).eq("id", user.id);

      if (profileError) {
        throw new Error(
          `${profileError.message} Your password was saved. Sign in and return here to finish setup.`,
        );
      }

      await refresh();
      router.replace(HOME_PATH);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to complete onboarding.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (sessionStatus === "loading" || (sessionStatus === "ready" && authLoading)) {
    return (
      <main className="min-h-screen bg-slate-50 py-10">
        <div className="mx-auto max-w-md px-4">
          <p className="text-sm font-semibold text-gray-800">Verifying invitation…</p>
          <p className="mt-2 text-sm text-gray-600">Please wait while we confirm your invite session.</p>
        </div>
      </main>
    );
  }

  if (sessionStatus === "missing") {
    return (
      <main className="min-h-screen bg-slate-50 py-10">
        <div className="mx-auto max-w-md space-y-4 px-4">
          <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <h1 className="text-2xl font-bold tracking-tight text-gray-950">Accept invite</h1>
            <p className="mt-2 text-sm text-gray-600">{sessionError}</p>
          </header>
          <p className="text-sm text-gray-700">
            Already created a password?{" "}
            <Link href={LOGIN_PATH} className="font-semibold text-blue-700 hover:underline">
              Sign in
            </Link>{" "}
            to finish setup.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-md space-y-4 px-4">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Finish account setup</h1>
          <p className="mt-1 text-sm text-gray-600">
            Create your password first, then confirm your contact details. You cannot use the app until this is
            complete.
          </p>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Email</label>
              <input
                type="email"
                value={confirmedEmail || context.email || ""}
                readOnly
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">
                Job Title <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="organization-title"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Create Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="new-password"
              />
            </div>
          </div>

          {info ? <p className="mt-3 text-sm font-semibold text-emerald-700">{info}</p> : null}
          {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

          <div className="mt-5 flex items-center justify-end">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Save and continue"}
            </button>
          </div>

          <p className="mt-4 text-xs text-gray-500">
            If profile save fails after password creation, sign in again and return here to finish setup.
          </p>
        </section>
      </div>
    </main>
  );
}
