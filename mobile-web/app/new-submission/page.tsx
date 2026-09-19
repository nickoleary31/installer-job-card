"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { appRoutes } from "@/lib/app-routes";
import { NewSubmissionForm } from "@/components/NewSubmissionForm";

/**
 * Phase 2D — defense in depth alongside ProjectDetailScreen's own
 * offline-authorized gate on its "New Submission" link (deep link, a
 * stale bookmark, or the browser back/forward cache could otherwise land
 * here directly): the full form needs online-only packages that don't
 * exist yet, so offline-authorized must never render it, even though
 * `context.userId` is truthy in that mode (see lib/auth/auth-state.ts).
 */
export default function NewSubmissionPage() {
  const router = useRouter();
  const { loading: authLoading, context, authMode } = useAuthUserContext();
  const userId = context.userId;
  const isOfflineAuthorized = authMode === "offline-authorized";

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace(appRoutes.login());
    }
  }, [authLoading, userId, router]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!userId) {
    return null;
  }

  if (isOfflineAuthorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-lg font-bold text-gray-900">Not available offline</h1>
          <p className="mt-2 text-sm text-gray-600">Submission setup is not yet available offline for this project.</p>
        </div>
      </main>
    );
  }

  return <NewSubmissionForm />;
}
