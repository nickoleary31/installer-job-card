"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";

export default function HomeDashboardPage() {
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
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-6 dark:bg-slate-950 sm:px-5 sm:pb-12 sm:pt-8">
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h1 className="text-xl font-bold tracking-tight text-gray-950 dark:text-slate-50 sm:text-2xl">Installer Sheetz</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">What are you working on today?</p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:gap-5">
          <Link
            href="/installs"
            className="group flex min-h-[112px] flex-col justify-center rounded-2xl border-2 border-blue-200 bg-blue-50 px-5 py-5 shadow-sm transition hover:border-blue-400 hover:bg-blue-100/90 active:scale-[0.99] dark:border-blue-800 dark:bg-blue-950/40 dark:hover:border-blue-600 dark:hover:bg-blue-950/70"
          >
            <span className="text-lg font-bold text-blue-950 dark:text-blue-100 sm:text-xl">Installs</span>
            <span className="mt-2 text-sm font-medium leading-snug text-blue-900/90 dark:text-blue-200/90">
              Job cards, drafts, saved local work, submitted installs
            </span>
          </Link>

          <Link
            href="/expenses"
            className="group flex min-h-[112px] flex-col justify-center rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-5 py-5 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-100/90 active:scale-[0.99] dark:border-emerald-800 dark:bg-emerald-950/40 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/70"
          >
            <span className="text-lg font-bold text-emerald-950 dark:text-emerald-100 sm:text-xl">Expenses</span>
            <span className="mt-2 text-sm font-medium leading-snug text-emerald-900/90 dark:text-emerald-200/90">
              Add receipts, lost receipts, and project expenses
            </span>
          </Link>

          <Link
            href="/offline-drafts"
            className="group flex min-h-[112px] flex-col justify-center rounded-2xl border-2 border-amber-200 bg-amber-50 px-5 py-5 shadow-sm transition hover:border-amber-400 hover:bg-amber-100/90 active:scale-[0.99] dark:border-amber-800 dark:bg-amber-950/40 dark:hover:border-amber-600 dark:hover:bg-amber-950/70"
          >
            <span className="text-lg font-bold text-amber-950 dark:text-amber-100 sm:text-xl">Local Storage</span>
            <span className="mt-2 text-sm font-medium leading-snug text-amber-900/90 dark:text-amber-200/90">
              Saved on this device for offline use
            </span>
          </Link>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Installs quick links</h2>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <Link href="/companies" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
              Projects/Companies
            </Link>
            <Link href="/new-submission" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
              New Job Card
            </Link>
            <Link href="/drafts" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
              Drafts
            </Link>
            <Link href="/submitted" className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
              Submitted
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
