"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type CustomerNameRow = {
  customer_name: string | null;
};

type ProjectRow = {
  id: string;
  project_name: string;
  active: boolean;
};

type ProjectCard = ProjectRow & {
  completedSubmissionCount: number;
};

export default function CustomerAssociatedProjectsPage() {
  const params = useParams<{ companyId: string; customerId: string }>();
  const companyId = String(params.companyId || "");
  const customerId = String(params.customerId || "");
  const [customerName, setCustomerName] = useState("—");
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || !customerId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [{ data: customerData, error: customerError }, { data: projectData, error: projectError }] = await Promise.all([
          supabase
            .from("customers")
            .select("customer_name")
            .eq("id", customerId)
            .eq("company_id", companyId)
            .maybeSingle<CustomerNameRow>(),
          supabase
            .from("projects")
            .select("id, project_name, active")
            .eq("company_id", companyId)
            .eq("customer_id", customerId)
            .order("project_name", { ascending: true }),
        ]);
        if (cancelled) return;
        if (customerError) throw customerError;
        if (projectError) throw projectError;

        setCustomerName(customerData?.customer_name?.trim() || "—");

        const baseProjects = (projectData as ProjectRow[]) || [];
        const projectIds = baseProjects.map((p) => p.id);
        let submissionRows: { project_id: string }[] = [];
        if (projectIds.length > 0) {
          const { data: subData, error: subError } = await supabase
            .from("job_card_submissions")
            .select("project_id")
            .eq("company_id", companyId)
            .in("project_id", projectIds);
          if (subError) throw subError;
          submissionRows = (subData as { project_id: string }[]) || [];
        }
        const countByProject = new Map<string, number>();
        for (const row of submissionRows) {
          if (!row.project_id) continue;
          countByProject.set(row.project_id, (countByProject.get(row.project_id) || 0) + 1);
        }
        const cards = baseProjects.map((p) => ({
          ...p,
          completedSubmissionCount: countByProject.get(p.id) ?? 0,
        }));
        setProjects(cards);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load associated projects";
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
  }, [companyId, customerId]);

  const hasProjects = useMemo(() => projects.length > 0, [projects]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-bold tracking-tight text-gray-950">Associated Projects</h1>
          <p className="mt-1 text-sm text-gray-600">Customer / Site: {customerName}</p>
          <div className="mt-4">
            <Link
              href={`/companies/${encodeURIComponent(companyId)}/customers/${encodeURIComponent(customerId)}`}
              className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
            >
              ← Back to Customer / Site
            </Link>
          </div>
        </header>

        {loading ? <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading projects...</section> : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load associated projects: {loadError}
          </section>
        ) : null}

        {!loading && !loadError ? (
          hasProjects ? (
            projects.map((project) => (
              <Link
                key={project.id}
                href={`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(project.id)}`}
                className="block rounded-2xl border border-indigo-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <h2 className="text-lg font-bold text-gray-900">{project.project_name}</h2>
                <p className="mt-0.5 text-sm text-gray-700">
                  <span className="font-semibold text-gray-600">Completed submissions:</span> {project.completedSubmissionCount}
                </p>
                <p className="mt-1 text-sm text-gray-600">{project.active ? "Active project" : "Inactive project"}</p>
              </Link>
            ))
          ) : (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              No projects are currently linked to this customer/site.
            </section>
          )
        ) : null}
      </div>
    </main>
  );
}

