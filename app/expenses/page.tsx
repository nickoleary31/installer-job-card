"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";

export default function ExpensesHubPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const userId = context.userId;

  const isReviewCapable = useMemo(
    () => context.globalRole === "admin" || Object.values(context.companyRolesById).some((r) => r === "admin"),
    [context.companyRolesById, context.globalRole],
  );

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
      <div className="mx-auto max-w-lg space-y-5">
        <header>
          <Link
            href="/home"
            className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
          >
            ← Home
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-950 dark:text-slate-50">Expenses</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Receipts, lost receipts, and project costs.</p>
        </header>

        <div className="flex flex-col gap-3">
          <Link
            href="/companies"
            className="flex min-h-[88px] flex-col justify-center rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-4 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-100/80 active:scale-[0.99] dark:border-emerald-800 dark:bg-emerald-950/40 dark:hover:border-emerald-600"
          >
            <span className="text-base font-bold text-emerald-950 dark:text-emerald-100">Add expense</span>
            <span className="mt-1 text-sm font-medium text-emerald-900/90 dark:text-emerald-200/90">
              Open a company and project — add expenses from the project screen.
            </span>
          </Link>

          <Link
            href="/companies"
            className="flex min-h-[72px] flex-col justify-center rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-[0.99] dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-800 dark:hover:bg-slate-800"
          >
            <span className="text-base font-bold text-gray-900 dark:text-slate-100">Project expenses</span>
            <span className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              View totals, history, and receipt status per project.
            </span>
          </Link>

          {isReviewCapable ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-800 dark:bg-amber-950/30">
              <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                Admin / review
              </h2>
              <p className="mt-2 text-sm text-amber-950/90 dark:text-amber-100/90">
                Flagged and lost-receipt lines are reviewed on each project&apos;s{" "}
                <span className="font-semibold">Expenses</span> section. Open a project from{" "}
                <Link href="/companies" className="font-semibold text-blue-800 underline dark:text-blue-300">
                  Companies
                </Link>{" "}
                to approve or reject.
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
