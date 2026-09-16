"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { appRoutes } from "@/lib/app-routes";
import { NewSubmissionForm } from "@/components/NewSubmissionForm";

export default function NewSubmissionPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const userId = context.userId;

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

  return <NewSubmissionForm />;
}
