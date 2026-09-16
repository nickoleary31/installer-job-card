"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { appRoutes } from "@/lib/app-routes";
import { setActiveProject } from "@/lib/active-project-context";
import { filterVisibleActiveProjects } from "@/lib/active-projects-visibility";
import { supabase } from "@/lib/supabase/client";

type CompanyRow = { id: string; name: string };

type LinkedCustomerRow = { customer_name: string | null; full_address: string | null };

type ActiveProjectRow = {
  id: string;
  company_id: string;
  project_name: string;
  location: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customers: LinkedCustomerRow | LinkedCustomerRow[] | null;
};

type ActiveProjectCard = {
  id: string;
  companyId: string;
  projectName: string;
  displayCustomerName: string;
  displayLocation: string;
  completedSubmissionCount: number;
};

type CompanyGroup = {
  companyId: string;
  companyName: string;
  projects: ActiveProjectCard[];
};

/**
 * The cross-company "what work is available to me" landing page — shared by
 * Production web's /installs and mobile-web's /installs. Intentionally
 * simpler than the company-scoped ProjectsListScreen (no add-project/
 * add-customer admin modals — those stay on the company-scoped page) and
 * intentionally does not depend on the Zoho project-progress endpoint: this
 * screen must render from Installer Sheetz/Supabase data alone, even if
 * Zoho is slow or unavailable. See docs/Mobile_Development.md.
 *
 * Access-rule decision logic lives in lib/active-projects-visibility.ts
 * (extracted so the full matrix — global admin, company admin, technician
 * with/without assignments, per-company fallback, inactive projects — is
 * unit-testable without mocking Supabase). See that file's doc comment for
 * the full rationale.
 */
export function ActiveProjectsScreen() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (authLoading) return;
      if (!context.userId) {
        if (!cancelled) {
          setGroups([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        // 1. Accessible companies + names, one query (never one query per project).
        let companiesQuery = supabase.from("companies").select("id, name").order("name", { ascending: true });
        if (!isGlobalAdmin) {
          if (context.companyIds.length === 0) {
            if (!cancelled) {
              setGroups([]);
              setLoading(false);
            }
            return;
          }
          companiesQuery = companiesQuery.in("id", context.companyIds);
        }
        const { data: companiesData, error: companiesError } = await companiesQuery;
        if (companiesError) throw companiesError;
        const companies = (companiesData as CompanyRow[]) || [];
        const companyIds = companies.map((c) => c.id);
        if (companyIds.length === 0) {
          if (!cancelled) {
            setGroups([]);
            setLoading(false);
          }
          return;
        }

        // 2. Active projects across those companies.
        const { data: projectsData, error: projectsError } = await supabase
          .from("projects")
          .select(
            "id, company_id, project_name, location, customer_id, customer_name, customers:customer_id(customer_name, full_address)",
          )
          .in("company_id", companyIds)
          .eq("active", true)
          .order("project_name", { ascending: true });
        if (projectsError) throw projectsError;
        const projectsRaw = (projectsData as ActiveProjectRow[]) || [];

        // 3. Bulk completed-submission counts — one query across every visible project id, not
        // one query per company or per project.
        const projectIds = projectsRaw.map((p) => p.id);
        const countByProject = new Map<string, number>();
        if (projectIds.length > 0) {
          const { data: subData, error: subError } = await supabase
            .from("job_card_submissions")
            .select("project_id")
            .in("project_id", projectIds);
          if (subError) throw subError;
          for (const row of (subData as { project_id: string }[]) || []) {
            if (!row.project_id) continue;
            countByProject.set(row.project_id, (countByProject.get(row.project_id) || 0) + 1);
          }
        }

        // 4. Technician assignments — global, not company-scoped (matches the company-scoped
        // screen's own query shape); filterVisibleActiveProjects groups them per company itself.
        let assignedProjectIds: string[] = [];
        if (!isGlobalAdmin) {
          const { data: assignmentData, error: assignmentError } = await supabase
            .from("project_assignments")
            .select("project_id")
            .eq("user_id", context.userId)
            .eq("is_active", true);
          if (!assignmentError) {
            assignedProjectIds = ((assignmentData as { project_id: string }[]) || [])
              .map((r) => r.project_id)
              .filter(Boolean);
          }
        }

        const visibleProjects = filterVisibleActiveProjects(
          projectsRaw.map((row) => ({ id: row.id, companyId: row.company_id, active: true, row })),
          {
            isGlobalAdmin,
            companyRolesById: context.companyRolesById,
            assignedProjectIds,
          },
        ).map((entry) => entry.row);

        const cardsByCompany = new Map<string, ActiveProjectCard[]>();
        for (const row of visibleProjects) {
          const linked = Array.isArray(row.customers) ? row.customers[0] : row.customers;
          const fromCustomer = linked?.customer_name?.trim() || "";
          const fromProject = row.customer_name?.trim() || "";
          const addressFromCustomer = linked?.full_address?.trim() || "";
          const fromProjectLocation = row.location?.trim() || "";
          const card: ActiveProjectCard = {
            id: row.id,
            companyId: row.company_id,
            projectName: row.project_name,
            displayCustomerName: fromCustomer || fromProject || "—",
            displayLocation: addressFromCustomer || fromProjectLocation || "",
            completedSubmissionCount: countByProject.get(row.id) ?? 0,
          };
          const list = cardsByCompany.get(row.company_id) || [];
          list.push(card);
          cardsByCompany.set(row.company_id, list);
        }

        const nextGroups: CompanyGroup[] = companies
          .filter((c) => (cardsByCompany.get(c.id) || []).length > 0)
          .map((c) => ({ companyId: c.id, companyName: c.name, projects: cardsByCompany.get(c.id) || [] }));

        if (!cancelled) {
          setGroups(nextGroups);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load active projects.");
          setGroups([]);
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, context.companyIds, context.companyRolesById, context.userId, isGlobalAdmin]);

  const totalProjects = useMemo(() => groups.reduce((sum, g) => sum + g.projects.length, 0), [groups]);

  const openProject = (companyId: string, projectId: string) => {
    setActiveProject({ companyId, projectId });
    router.push(appRoutes.project(companyId, projectId));
  };

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-bold tracking-tight text-gray-950 dark:text-slate-50 sm:text-2xl">Active Projects</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">What you're authorized to work on right now.</p>
      </header>

      {authLoading || loading ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Loading active projects...
        </section>
      ) : null}

      {!authLoading && !loading && !context.userId ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Log in to view your active projects.
        </section>
      ) : null}

      {loadError ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Could not load active projects: {loadError}
        </section>
      ) : null}

      {!authLoading && !loading && context.userId && !loadError && totalProjects === 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No active projects assigned to you right now.
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.companyId} className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            {group.companyName}
          </h2>
          <div className="space-y-3">
            {group.projects.map((project) => (
              <article
                key={project.id}
                className="rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:border-blue-900 dark:bg-slate-900"
              >
                <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{project.projectName}</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{project.displayCustomerName}</p>
                {project.displayLocation ? (
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-500">{project.displayLocation}</p>
                ) : null}
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                  {project.completedSubmissionCount} completed submission{project.completedSubmissionCount === 1 ? "" : "s"}
                </p>
                <button
                  type="button"
                  onClick={() => openProject(project.companyId, project.id)}
                  className="mt-3 inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Open Project
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
