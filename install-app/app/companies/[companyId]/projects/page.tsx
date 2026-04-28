"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type ProjectRow = {
  id: string;
  project_name: string;
  active: boolean;
};

export default function CompanyProjectsPage() {
  const params = useParams<{ companyId: string }>();
  const router = useRouter();
  const companyId = String(params.companyId || "");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    try {
      window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
    } catch {
      // ignore storage errors
    }
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId) return;
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("id, project_name, active")
          .eq("company_id", companyId)
          .order("project_name", { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        setProjects((data as ProjectRow[]) || []);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load projects";
          setLoadError(msg);
          setProjects([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const openProjectDashboard = (projectId: string) => {
    try {
      window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
      window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
    } catch {
      // ignore storage errors
    }
    router.push(`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`);
  };

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Select Project</h1>
          <p className="mt-1 text-sm text-gray-600">Choose a project for this company.</p>
          <Link href="/companies" className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline">
            Back to Companies
          </Link>
        </header>

        {loading ? <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading projects...</section> : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load projects: {loadError}
          </section>
        ) : null}

        {!loading && !loadError ? (
          projects.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              No projects found for this company.
            </section>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openProjectDashboard(project.id)}
                className="block w-full rounded-2xl border border-indigo-200 bg-white p-5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <h2 className="text-lg font-bold text-gray-900">{project.project_name}</h2>
                <p className="mt-1 text-sm text-gray-600">{project.active ? "Active project" : "Inactive project"}</p>
              </button>
            ))
          )
        ) : null}
      </div>
    </main>
  );
}

