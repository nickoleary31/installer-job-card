"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ACCEPT_INVITE_PATH,
  shouldForceOnboardingRedirect,
  urlLooksLikeInviteAuthCallback,
} from "@/lib/auth/onboarding";
import { useAuthUserContext } from "./AuthUserContextProvider";

/**
 * Until onboarding_completed_at is set, keep authenticated users on /auth/accept-invite.
 * Does not touch unauthenticated invite-callback processing (see InviteCallbackForwarder).
 */
export default function OnboardingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, context } = useAuthUserContext();

  const inviteCallbackPending =
    typeof window !== "undefined" && urlLooksLikeInviteAuthCallback(window.location.href);

  const shouldRedirect =
    !inviteCallbackPending &&
    shouldForceOnboardingRedirect({
      loading,
      userId: context.userId,
      onboardingCompleted: context.onboardingCompleted,
      pathname,
    });

  useEffect(() => {
    if (!shouldRedirect) return;
    router.replace(ACCEPT_INVITE_PATH);
    const timer = window.setTimeout(() => {
      if (window.location.pathname !== ACCEPT_INVITE_PATH) {
        window.location.assign(ACCEPT_INVITE_PATH);
      }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [shouldRedirect, router]);

  if (shouldRedirect) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <p className="text-sm text-gray-700 dark:text-slate-200">Redirecting to finish account setup…</p>
      </main>
    );
  }

  return <>{children}</>;
}
