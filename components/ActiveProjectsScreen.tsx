"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import {
  fromFieldPackageProjects,
  getActiveProjectsFieldPackage,
  resolveActiveProjectsLoadOutcome,
  toFieldPackageProjects,
  type ActiveProjectCard,
  type CompanyGroup,
} from "@/lib/active-projects-field-package";
import { appRoutes } from "@/lib/app-routes";
import { describeLeaseExpiry } from "@/lib/auth/offline-access-lease";
import { setActiveProject } from "@/lib/active-project-context";
import { filterVisibleActiveProjects } from "@/lib/active-projects-visibility";
import { getCompanyProductDefinitionsRepository, type CompanyFormProductRow } from "@/lib/product-config";
import {
  buildProvisionedProjectWorkPackages,
  getProjectWorkPackageRepository,
  type ActiveProjectForProvisioning,
} from "@/lib/project-work-package";
import { supabase } from "@/lib/supabase/client";

type CompanyRow = { id: string; name: string };

type LinkedCustomerRow = {
  customer_name: string | null;
  full_address: string | null;
  customer_account_id: string | null;
  site_contact_name: string | null;
  contact_number: string | null;
  contact_email: string | null;
};

type ActiveProjectRow = {
  id: string;
  company_id: string;
  project_name: string;
  location: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customers: LinkedCustomerRow | LinkedCustomerRow[] | null;
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

/**
 * A fresh remote load and a local persistence result are deliberately
 * separate states — a successful server response never implies the package
 * is safely stored on this device. "online-saving"/"online-saved"/
 * "online-save-failed" all show the SAME fresh remote groups; only the
 * status line differs, and only "online-saved" may ever claim the package
 * is available offline.
 */
type SyncStatus =
  | { kind: "online-saving" }
  | { kind: "online-saved"; syncedAt: string }
  | { kind: "online-save-failed" }
  | { kind: "offline-cached"; syncedAt: string }
  | { kind: "unavailable" };

export function ActiveProjectsScreen() {
  const router = useRouter();
  const { loading: authLoading, context, authMode, lease } = useAuthUserContext();
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [workPackageProvisioningFailed, setWorkPackageProvisioningFailed] = useState(false);
  const [productDefinitionsProvisioningFailed, setProductDefinitionsProvisioningFailed] = useState(false);

  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;

  useEffect(() => {
    let cancelled = false;

    /**
     * A successful, authorized (possibly empty) online result. Renders
     * immediately — a technician with service must see and use their
     * projects regardless of what happens next — then attempts to persist
     * it locally as a genuinely separate step. The UI only ever moves to
     * "saved for offline use" once that save has actually committed;
     * a save failure is reported honestly but never as a load error, and
     * never blocks or retroactively hides the already-rendered online data.
     *
     * Phase 2D.1 — `workPackages` is the SAME authorized project set,
     * proactively provisioned via lib/project-work-package.ts's
     * provisionProjectWorkPackages() right alongside the Active Projects
     * snapshot itself, so a technician never has to have manually opened
     * Project Detail online before it becomes available offline. This is a
     * genuinely separate local-persistence concern from the field-package
     * save above — its own failure is surfaced (workPackageProvisioningFailed)
     * but never blocks or downgrades the online render either.
     */
    const finishOnline = async (
      userId: string,
      nextGroups: CompanyGroup[],
      workPackages: ReturnType<typeof buildProvisionedProjectWorkPackages>,
      companyProductRowsByCompanyId: ReadonlyMap<string, CompanyFormProductRow[]>,
    ) => {
      if (cancelled) return;
      setGroups(nextGroups);
      setSyncStatus({ kind: "online-saving" });
      setLoadError(null);
      setLoading(false);
      try {
        const { syncedAt } = await getActiveProjectsFieldPackage().saveActiveProjectsSnapshot(
          userId,
          toFieldPackageProjects(nextGroups),
        );
        if (cancelled) return;
        setSyncStatus({ kind: "online-saved", syncedAt });
      } catch {
        // The previous valid local package (if any) is left untouched by a
        // failed save — see saveActiveProjectsSnapshot's own atomic-replace
        // contract. The fresh online result already rendered successfully,
        // so this must never surface as a load error or block the technician.
        if (cancelled) return;
        setSyncStatus({ kind: "online-save-failed" });
      }

      // Deliberately a SEPARATE try/catch from the field-package save above:
      // a Project Work Package provisioning failure must never downgrade or
      // block the Active Projects online render, and must never be
      // reported as a "load error" — see provisionProjectWorkPackages()'s
      // own atomic/preserve-previous contract for why the old packages are
      // always safe even when this rejects.
      try {
        await getProjectWorkPackageRepository().provisionProjectWorkPackages(userId, workPackages);
        if (!cancelled) setWorkPackageProvisioningFailed(false);
      } catch {
        if (!cancelled) setWorkPackageProvisioningFailed(true);
      }

      // Phase 2E — same independent, best-effort, never-blocks-online-render
      // contract as the work-package provisioning above. Writes ONE row per
      // authorized company (including an empty array for companies with no
      // custom products — see company-product-definitions.ts's own doc on
      // why that's a meaningful, distinct signal), never pruned here: a
      // company that temporarily drops out of one sync pass may safely keep
      // its cached definitions — actual offline USE is still gated by the
      // (lease + authorized ProjectWorkPackage) check, not by this row's
      // mere existence.
      try {
        const companyRepo = getCompanyProductDefinitionsRepository();
        for (const [companyId, rows] of companyProductRowsByCompanyId) {
          await companyRepo.saveCompanyProductDefinitions(companyId, rows);
        }
        if (!cancelled) setProductDefinitionsProvisioningFailed(false);
      } catch {
        if (!cancelled) setProductDefinitionsProvisioningFailed(true);
      }
    };

    /** Remote load failed — fall back to whatever is locally cached, per the load policy. */
    const finishFailed = async (userId: string, error: string) => {
      let cachedSnapshot = null;
      try {
        cachedSnapshot = await getActiveProjectsFieldPackage().loadActiveProjectsSnapshot(userId);
      } catch {
        // Local read failure is treated the same as no cache — fall through to "unavailable".
      }
      if (cancelled) return;
      const outcome = resolveActiveProjectsLoadOutcome({ remote: { ok: false, error }, cachedSnapshot });
      if (outcome.kind === "offline-cached") {
        setGroups(outcome.groups);
        setSyncStatus({ kind: "offline-cached", syncedAt: outcome.syncedAt });
        setLoadError(null);
      } else {
        setGroups([]);
        setSyncStatus({ kind: "unavailable" });
        setLoadError(
          `Could not reach the server and no projects have been saved to this device yet (${
            outcome.kind === "unavailable" ? outcome.error : error
          }).`,
        );
      }
      setLoading(false);
    };

    /**
     * Phase 2C offline-authorized path — the auth layer has already
     * determined (independent of this component) that the server is
     * unreachable and this device holds a currently valid, unexpired
     * offline access lease for this exact userId. No assignment/role logic
     * is recomputed here and no Supabase call is attempted: the
     * already-authorized field package is the sole source of truth for
     * what this technician may see offline.
     */
    const loadOfflineAuthorized = async (userId: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const snapshot = await getActiveProjectsFieldPackage().loadActiveProjectsSnapshot(userId);
        if (cancelled) return;
        if (snapshot) {
          setGroups(fromFieldPackageProjects(snapshot.projects));
          setSyncStatus({ kind: "offline-cached", syncedAt: snapshot.syncedAt });
        } else {
          setGroups([]);
          setSyncStatus({ kind: "unavailable" });
          setLoadError("Offline, and no projects have been saved to this device yet for this account.");
        }
      } catch (e) {
        if (cancelled) return;
        setGroups([]);
        setSyncStatus({ kind: "unavailable" });
        setLoadError(`Offline, and the saved projects on this device could not be read (${e instanceof Error ? e.message : String(e)}).`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const load = async () => {
      if (authLoading) return;

      if (authMode === "offline-authorized" && context.userId) {
        await loadOfflineAuthorized(context.userId);
        return;
      }

      if (!context.userId) {
        if (!cancelled) {
          setGroups([]);
          setLoading(false);
        }
        return;
      }
      const userId = context.userId;

      setLoading(true);
      setLoadError(null);
      try {
        // 1. Accessible companies + names, one query (never one query per project).
        let companiesQuery = supabase.from("companies").select("id, name").order("name", { ascending: true });
        if (!isGlobalAdmin) {
          if (context.companyIds.length === 0) {
            await finishOnline(userId, [], [], new Map());
            return;
          }
          companiesQuery = companiesQuery.in("id", context.companyIds);
        }
        const { data: companiesData, error: companiesError } = await companiesQuery;
        if (companiesError) throw companiesError;
        const companies = (companiesData as CompanyRow[]) || [];
        const companyIds = companies.map((c) => c.id);
        if (companyIds.length === 0) {
          await finishOnline(userId, [], [], new Map());
          return;
        }
        const companyNamesById = new Map(companies.map((c) => [c.id, c.name]));

        // 2. Active projects across those companies. customer_account_id and
        // the three Phase 2E contact fields are selected alongside the
        // existing customer fields (same bulk query, no extra round trip)
        // specifically to provision ProjectWorkPackage below without a
        // per-project fetch. See ProjectWorkPackage's own doc for why only
        // these three Site Info fields, and no others.
        const { data: projectsData, error: projectsError } = await supabase
          .from("projects")
          .select(
            "id, company_id, project_name, location, customer_id, customer_name, customers:customer_id(customer_name, full_address, customer_account_id, site_contact_name, contact_number, contact_email)",
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

        // 5. One bulk customer_accounts lookup across every distinct
        // customer_account_id in the authorized set — never one query per
        // project, and never a Zoho request at all (Zoho enrichment stays
        // an online-Project-Detail-visit concern; see
        // buildProvisionedProjectWorkPackages()'s own doc). A failure here
        // degrades to no customer-account names rather than blocking the
        // Active Projects render, which does not depend on this data.
        const customerAccountIds = Array.from(
          new Set(
            visibleProjects
              .map((row) => (Array.isArray(row.customers) ? row.customers[0] : row.customers)?.customer_account_id ?? null)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        let customerAccountNamesById: Record<string, string> = {};
        if (customerAccountIds.length > 0) {
          try {
            const { data: accountsData, error: accountsError } = await supabase
              .from("customer_accounts")
              .select("id, name")
              .in("id", customerAccountIds);
            if (accountsError) throw accountsError;
            customerAccountNamesById = ((accountsData as { id: string; name: string | null }[] | null) || []).reduce<
              Record<string, string>
            >((acc, row) => {
              if (row.name?.trim()) acc[row.id] = row.name.trim();
              return acc;
            }, {});
          } catch {
            // customerAccountName is optional enrichment on the work package — leave it empty rather than failing the whole load.
          }
        }

        const provisioningInputs: ActiveProjectForProvisioning[] = visibleProjects.map((row) => {
          const linked = Array.isArray(row.customers) ? row.customers[0] : row.customers;
          const fromCustomer = linked?.customer_name?.trim() || "";
          const fromProject = row.customer_name?.trim() || "";
          const addressFromCustomer = linked?.full_address?.trim() || "";
          const fromProjectLocation = row.location?.trim() || "";
          return {
            projectId: row.id,
            companyId: row.company_id,
            companyName: companyNamesById.get(row.company_id) || "—",
            projectName: row.project_name,
            customerName: fromCustomer || fromProject || "—",
            customerAccountId: linked?.customer_account_id ?? null,
            location: addressFromCustomer || fromProjectLocation || "—",
            primaryContact: linked?.site_contact_name?.trim() || null,
            contactNumber: linked?.contact_number?.trim() || null,
            contactEmail: linked?.contact_email?.trim() || null,
          };
        });
        const workPackages = buildProvisionedProjectWorkPackages(userId, provisioningInputs, customerAccountNamesById);

        // 6. Phase 2E — ONE bulk company_form_products query across every
        // authorized company (not one query per company, and never one per
        // project or product) — see lib/product-config/company-product-definitions.ts's
        // own doc on why this is cached company-scoped rather than
        // duplicated into every project. A row is written for EVERY
        // authorized company, including an empty array for companies with
        // no custom products — see that doc on why an empty-but-present
        // package is a meaningful, distinct signal from "never checked."
        let companyProductRowsByCompanyId = new Map<string, CompanyFormProductRow[]>();
        try {
          const { data: productRowsData, error: productRowsError } = await supabase
            .from("company_form_products")
            .select(
              "id, company_id, product_key, display_label, base_form_id, section_key, submission_type, draft_key, allow_primary, allow_additional, active, display_order, configuration, created_at, updated_at",
            )
            .in("company_id", companyIds)
            .order("display_order", { ascending: true });
          if (productRowsError) throw productRowsError;
          // Pre-seed EVERY authorized company with an empty array first, so
          // a company with zero custom products still gets a row written
          // below — that presence (not its content) is what tells the
          // offline gate "we successfully checked this company."
          const seeded = new Map<string, CompanyFormProductRow[]>(companyIds.map((id) => [id, []]));
          for (const row of (productRowsData as CompanyFormProductRow[] | null) || []) {
            const list = seeded.get(row.company_id) || [];
            list.push(row);
            seeded.set(row.company_id, list);
          }
          companyProductRowsByCompanyId = seeded;
        } catch {
          // Provisioning-time company_form_products read is best-effort — a
          // failure here is surfaced (productDefinitionsProvisioningFailed)
          // but must never block the Active Projects online render, which
          // does not depend on this data at all. Leaving the map empty here
          // means NOTHING gets (re)written this pass — any previously
          // cached definitions are left exactly as they were.
        }

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

        await finishOnline(userId, nextGroups, workPackages, companyProductRowsByCompanyId);
      } catch (e) {
        await finishFailed(userId, e instanceof Error ? e.message : "Failed to load active projects.");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, authMode, context.companyIds, context.companyRolesById, context.userId, isGlobalAdmin]);

  const totalProjects = useMemo(() => groups.reduce((sum, g) => sum + g.projects.length, 0), [groups]);

  const openProject = (companyId: string, projectId: string) => {
    setActiveProject({ companyId, projectId, userId: context.userId });
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

      {syncStatus?.kind === "online-saved" ? (
        <p className="px-1 text-xs text-gray-500 dark:text-slate-500">
          Saved for offline use. Last synced {new Date(syncStatus.syncedAt).toLocaleString()}.
        </p>
      ) : null}

      {syncStatus?.kind === "online-save-failed" ? (
        <p className="px-1 text-xs text-gray-500 dark:text-slate-500">Online — could not save for offline use.</p>
      ) : null}

      {syncStatus?.kind === "online-saved" && (workPackageProvisioningFailed || productDefinitionsProvisioningFailed) ? (
        <p className="px-1 text-xs text-amber-700 dark:text-amber-400">
          Some project details may not be available offline yet — will retry next sync.
        </p>
      ) : null}

      {syncStatus?.kind === "offline-cached" ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p>Offline — showing projects saved on this device. Last synced {new Date(syncStatus.syncedAt).toLocaleString()}.</p>
          {authMode === "offline-authorized" && lease
            ? (() => {
                const expiry = describeLeaseExpiry(lease, new Date().toISOString());
                return <p className={expiry.urgent ? "mt-1 font-semibold" : "mt-1"}>{expiry.text}</p>;
              })()
            : null}
        </section>
      ) : null}

      {loadError ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {loadError}
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
