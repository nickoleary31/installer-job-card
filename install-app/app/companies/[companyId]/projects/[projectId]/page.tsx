"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

export default function ProjectDashboardPage() {
  const params = useParams<{ companyId: string; projectId: string }>();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");

  useEffect(() => {
    try {
      if (companyId) window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
      if (projectId) window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
    } catch {
      // ignore storage errors
    }
  }, [companyId, projectId]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Installer Sheetz</h1>
          <p className="text-base font-medium leading-tight text-gray-600">Digital Job Cards for Field Technicians</p>
          <Link
            href={`/companies/${encodeURIComponent(companyId)}/projects`}
            className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline"
          >
            Back to Projects
          </Link>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/new-submission"
            className="rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-blue-300 hover:bg-blue-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">New Submission</h2>
            <p className="mt-1 text-sm text-gray-600">Start a new installer job card.</p>
          </Link>

          <Link
            href="/drafts"
            className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-emerald-300 hover:bg-emerald-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">Saved Drafts</h2>
            <p className="mt-1 text-sm text-gray-600">Resume or manage unfinished job cards.</p>
          </Link>

          <Link
            href="/submitted"
            className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">Submitted Job Cards</h2>
            <p className="mt-1 text-sm text-gray-600">View completed submissions.</p>
          </Link>
        </section>
      </div>
    </main>
  );
}

