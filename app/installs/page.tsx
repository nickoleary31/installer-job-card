"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { ActiveProjectsScreen } from "@/components/ActiveProjectsScreen";

export default function InstallsHubPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const userId = context.userId;

  useEffect(() => {
    if (authLoading) return;
    if (!userId) router.replace("/login");
  }, [authLoading, userId, router]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600 dark:text-slate-400">Checking sign-in…</p>
      </main>
    );
  }

  if (!userId) return null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-6 dark:bg-slate-950 sm:px-5">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <Link
            href="/home"
            className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
          >
            ← Home
          </Link>
          <div className="flex gap-3 text-sm font-semibold text-blue-700 dark:text-blue-400">
            <Link href="/drafts" className="underline-offset-2 hover:underline">
              Cloud Drafts
            </Link>
            <Link href="/submitted" className="underline-offset-2 hover:underline">
              Submitted Jobs
            </Link>
          </div>
        </div>

        <ActiveProjectsScreen />
      </div>
    </main>
  );
}
