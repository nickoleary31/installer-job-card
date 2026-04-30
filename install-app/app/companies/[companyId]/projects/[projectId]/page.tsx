"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type ProjectContext = {
  companyName: string;
  projectName: string;
  customerName: string;
  location: string;
};

type ProjectContextRow = {
  project_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  location: string | null;
};

type CustomerContextRow = {
  customer_name: string | null;
  full_address: string | null;
};

export default function ProjectDashboardPage() {
  const params = useParams<{ companyId: string; projectId: string }>();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");
  const [projectContext, setProjectContext] = useState<ProjectContext>({
    companyName: "—",
    projectName: "—",
    customerName: "—",
    location: "—",
  });

  useEffect(() => {
    try {
      if (companyId) window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
      if (projectId) window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
    } catch {
      // ignore storage errors
    }
  }, [companyId, projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadProjectContext = async () => {
      if (!companyId || !projectId) return;
      try {
        const [{ data: companyRow, error: companyError }, { data: projectRow, error: projectError }] = await Promise.all([
          supabase.from("companies").select("name").eq("id", companyId).maybeSingle<{ name: string }>(),
          supabase
            .from("projects")
            .select("project_name, customer_id, customer_name, location")
            .eq("id", projectId)
            .eq("company_id", companyId)
            .maybeSingle<ProjectContextRow>(),
        ]);
        if (companyError || projectError || cancelled) return;
        if (!companyRow && !projectRow) return;

        let customerName = projectRow?.customer_name?.trim() || "—";
        let location = projectRow?.location?.trim() || "—";
        if (projectRow?.customer_id) {
          const { data: customerRow, error: customerError } = await supabase
            .from("customers")
            .select("customer_name, full_address")
            .eq("id", projectRow.customer_id)
            .maybeSingle<CustomerContextRow>();
          if (!customerError && customerRow) {
            const customerNameFromCustomer = customerRow.customer_name?.trim();
            const locationFromCustomer = customerRow.full_address?.trim();
            if (customerNameFromCustomer) customerName = customerNameFromCustomer;
            if (locationFromCustomer) location = locationFromCustomer;
          }
        }

        setProjectContext({
          companyName: companyRow?.name?.trim() || "—",
          projectName: projectRow?.project_name?.trim() || "—",
          customerName,
          location,
        });
      } catch {
        // keep fallback display values
      }
    };
    void loadProjectContext();
    return () => {
      cancelled = true;
    };
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

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-gray-900 sm:text-lg">Current Project</h2>
          <div className="mt-3 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-gray-600">Company:</span> {projectContext.companyName}
            </p>
            <p>
              <span className="font-semibold text-gray-600">Project:</span> {projectContext.projectName}
            </p>
            <p>
              <span className="font-semibold text-gray-600">Customer:</span> {projectContext.customerName}
            </p>
            <p>
              <span className="font-semibold text-gray-600">Location:</span> {projectContext.location}
            </p>
          </div>
        </section>

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

