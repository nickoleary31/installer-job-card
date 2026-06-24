"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";

const hubLinks = [
  {
    href: "/new-submission",
    title: "New Job Card",
    subtitle: "Start or continue a field install job card.",
  },
  {
    href: "/drafts",
    title: "Cloud Drafts",
    subtitle: "Drafts saved to your account.",
  },
  {
    href: "/submitted",
    title: "Submitted Jobs",
    subtitle: "Completed submissions history.",
  },
  {
    href: "/companies",
    title: "Projects",
    subtitle: "Browse companies and open any project.",
  },
];

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
      <div className="mx-auto max-w-lg space-y-5">
        <header>
          <Link
            href="/home"
            className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
          >
            ← Home
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-950 dark:text-slate-50">Installs</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Job cards and field install workflows.</p>
        </header>

        <ul className="flex flex-col gap-3">
          {hubLinks.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-[72px] flex-col justify-center rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/50 active:scale-[0.99] dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-700 dark:hover:bg-slate-800"
              >
                <span className="text-base font-bold text-gray-900 dark:text-slate-100">{item.title}</span>
                <span className="mt-1 text-sm text-gray-600 dark:text-slate-400">{item.subtitle}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
