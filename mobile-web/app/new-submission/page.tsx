"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { appRoutes } from "@/lib/app-routes";
import { SELECTED_PROJECT_ID_KEY } from "@/lib/active-project-context";
import { getProjectWorkPackageRepository } from "@/lib/project-work-package";
import { getCompanyProductDefinitionsRepository } from "@/lib/product-config";
import { NewSubmissionForm } from "@/components/NewSubmissionForm";

/**
 * Phase 2E — defense in depth alongside ProjectDetailScreen's own
 * offline-authorized gate on its "New Submission" link (deep link, a
 * stale bookmark, or the browser back/forward cache could otherwise land
 * here directly): offline-authorized rendering requires BOTH a locally
 * provisioned ProjectWorkPackage for the currently selected project AND a
 * synced CompanyProductDefinitionsPackage for its company — package
 * existence alone is never treated as authorization (see
 * lib/product-config/company-product-definitions.ts's own doc).
 */
export default function NewSubmissionPage() {
  const router = useRouter();
  const { loading: authLoading, context, authMode } = useAuthUserContext();
  const userId = context.userId;
  const isOfflineAuthorized = authMode === "offline-authorized";
  const [offlineGate, setOfflineGate] = useState<"checking" | "ready" | "blocked">("checking");

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace(appRoutes.login());
    }
  }, [authLoading, userId, router]);

  useEffect(() => {
    if (authLoading || !userId) return;
    if (!isOfflineAuthorized) {
      setOfflineGate("ready");
      return;
    }
    let cancelled = false;
    setOfflineGate("checking");
    const check = async () => {
      const projectId =
        typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "" : "";
      if (!projectId) {
        if (!cancelled) setOfflineGate("blocked");
        return;
      }
      try {
        const pkg = await getProjectWorkPackageRepository().loadProjectWorkPackage(userId, projectId);
        if (cancelled) return;
        if (!pkg) {
          setOfflineGate("blocked");
          return;
        }
        const productDefs = await getCompanyProductDefinitionsRepository().loadCompanyProductDefinitions(pkg.companyId);
        if (cancelled) return;
        setOfflineGate(productDefs ? "ready" : "blocked");
      } catch {
        if (!cancelled) setOfflineGate("blocked");
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, isOfflineAuthorized]);

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

  if (offlineGate === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking offline availability…</p>
      </main>
    );
  }

  if (offlineGate === "blocked") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-lg font-bold text-gray-900">Not available offline</h1>
          <p className="mt-2 text-sm text-gray-600">
            Submission setup for this project hasn&apos;t been saved to this device yet. Connect to the internet to
            synchronize it.
          </p>
        </div>
      </main>
    );
  }

  return <NewSubmissionForm />;
}
