"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import {
  type CachedProjectItem,
  type StarterDataSnapshot,
  getBestStarterSnapshotForOffline,
  upsertStarterDataSnapshot,
} from "@/lib/starter-data-cache";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

function logOfflineStarterCacheError(e: unknown): void {
  if (e instanceof Error) {
    console.error("[companies] offline starter cache read failed", {
      name: e.name,
      message: e.message,
      stack: e.stack,
      raw: e,
    });
    return;
  }
  console.error("[companies] offline starter cache read failed", {
    name: typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined,
    message: String(e),
    stack: typeof e === "object" && e !== null ? (e as { stack?: string }).stack : undefined,
    raw: e,
  });
}

function offlineStarterCacheUserMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/IndexedDB unavailable/i.test(msg) || /indexedDB is missing/i.test(msg)) {
    return `${msg} Try allowing site data (not private mode), then open this page online once.`;
  }
  if (/IndexedDB read failed/i.test(msg) || /IndexedDB open failed/i.test(msg)) {
    return `${msg} If this persists, open Companies while online once to refresh the cache.`;
  }
  return `Could not read offline company cache: ${msg}`;
}

type CompanyRow = {
  id: string;
  name: string;
  active?: boolean;
};

/** NewSubmissionForm reads these keys before fetching default company/project online. */
function OfflineStartJobCardLink({ companyId, projectId }: { companyId: string; projectId: string }) {
  return (
    <div className="mt-2">
      <a
        href="/new-submission"
        className="inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        onClick={() => {
          try {
            window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
            window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
          } catch {
            // ignore storage failures
          }
        }}
      >
        Start local job card
      </a>
      <p className="mt-1 max-w-[20rem] text-xs text-gray-600">
        If this does not load: offline app shell could not load. Open New Submission once online before using offline.
      </p>
    </div>
  );
}

export default function CompaniesPage() {
  const { loading: authLoading, context } = useAuthUserContext();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supportsCompanyActive, setSupportsCompanyActive] = useState<boolean | null>(null);
  const [companyNameInput, setCompanyNameInput] = useState("");
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState("");
  const [managementError, setManagementError] = useState<string | null>(null);
  const [managementNotice, setManagementNotice] = useState<string | null>(null);
  const [savingCompanyKey, setSavingCompanyKey] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(() => (typeof window !== "undefined" ? !window.navigator.onLine : false));
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [offlineSnapshot, setOfflineSnapshot] = useState<StarterDataSnapshot | null>(null);
  const [offlineCacheMiss, setOfflineCacheMiss] = useState(false);

  const isGlobalAdmin = useMemo(() => {
    if (isOffline && offlineSnapshot) return offlineSnapshot.profile.globalRole === "admin";
    return context.globalRole === "admin";
  }, [context.globalRole, isOffline, offlineSnapshot]);

  const companyRolesForDisplay = useMemo(() => {
    if (isOffline && offlineSnapshot) return offlineSnapshot.profile.companyRolesById;
    return context.companyRolesById;
  }, [context.companyRolesById, isOffline, offlineSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIsOffline(!window.navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const loadCompanies = async () => {
    try {
      const { data, error } = await supabase.from("companies").select("id, name, active").order("name", { ascending: true });
      if (error) throw error;
      setCompanies((data as CompanyRow[]) || []);
      setSupportsCompanyActive(true);
      setLoadError(null);
    } catch {
      const { data, error } = await supabase.from("companies").select("id, name").order("name", { ascending: true });
      if (error) throw error;
      setCompanies((data as CompanyRow[]) || []);
      setSupportsCompanyActive(false);
      setLoadError(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === "undefined") return;

      /** Immediate offline path: IndexedDB only, no Supabase (avoids long network timeouts). */
      if (!window.navigator.onLine) {
        console.log("[companies] offline detected");
        setLoadError(null);
        try {
          const snap = await getBestStarterSnapshotForOffline(context.userId);
          if (cancelled) return;
          if (!snap) {
            console.log("[companies] offline: no starter snapshot found (IndexedDB empty or no rows for user)");
            setOfflineSnapshot(null);
            setOfflineCacheMiss(true);
            setCompanies([]);
            setCachedAt(null);
            setSupportsCompanyActive(null);
            console.log("[companies] cached company count", 0);
          } else {
            console.log("[companies] cached snapshot found", { userId: snap.userId });
            console.log("[companies] cached company count", snap.companies.length);
            setOfflineSnapshot(snap);
            setOfflineCacheMiss(false);
            setCompanies(snap.companies as CompanyRow[]);
            setCachedAt(snap.cachedAt);
            setSupportsCompanyActive(snap.companies.some((c) => typeof c.active === "boolean"));
          }
        } catch (e) {
          if (!cancelled) {
            logOfflineStarterCacheError(e);
            setLoadError(offlineStarterCacheUserMessage(e));
            setCompanies([]);
            setOfflineSnapshot(null);
            setOfflineCacheMiss(false);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      setOfflineSnapshot(null);
      setOfflineCacheMiss(false);

      if (authLoading) return;

      if (!context.userId) {
        if (!cancelled) {
          setCompanies([]);
          setLoading(false);
          setCachedAt(null);
          setLoadError(null);
        }
        return;
      }

      if (!cancelled) setLoading(true);
      try {
        await loadCompanies();
        if (!cancelled) setCachedAt(null);
        if (cancelled) return;
        if (!cancelled) setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load companies";
          setLoadError(msg);
          setCompanies([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authLoading, context.userId, isOffline]);

  const visibleCompanies = useMemo(() => {
    if (isOffline && offlineSnapshot) {
      const list = companies;
      if (offlineSnapshot.profile.globalRole === "admin") return list;
      const ids = offlineSnapshot.profile.companyIds;
      if (ids.length === 0) return [];
      const allowed = new Set(ids);
      return list.filter((company) => allowed.has(company.id));
    }

    if (authLoading) return [];
    if (!context.userId) return [];
    if (isGlobalAdmin) return companies;
    if (context.companyIds.length === 0) return [];
    const allowed = new Set(context.companyIds);
    return companies.filter((company) => allowed.has(company.id));
  }, [authLoading, companies, context.companyIds, context.userId, isGlobalAdmin, isOffline, offlineSnapshot]);

  const handleCreateCompany = async () => {
    const name = companyNameInput.trim();
    if (!name) {
      setManagementError("Company name is required.");
      setManagementNotice(null);
      return;
    }
    if (!context.userId || !isGlobalAdmin) {
      setManagementError("Only global admins can create companies.");
      setManagementNotice(null);
      return;
    }
    if (isOffline) {
      setManagementError("Offline mode: company creation requires connection.");
      setManagementNotice(null);
      return;
    }

    setSavingCompanyKey("create");
    setManagementError(null);
    setManagementNotice(null);
    try {
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .insert({ name })
        .select("id")
        .single<{ id: string }>();
      if (companyError) throw companyError;
      if (!companyData?.id) throw new Error("Failed to create company.");

      const { error: membershipError } = await supabase.from("company_memberships").insert({
        user_id: context.userId,
        company_id: companyData.id,
        role: "admin",
        is_active: true,
        updated_at: new Date().toISOString(),
      });
      if (membershipError) throw membershipError;

      await loadCompanies();
      setCompanyNameInput("");
      setManagementNotice("Company created.");
    } catch (e) {
      setManagementError(e instanceof Error ? e.message : "Failed to create company.");
      setManagementNotice(null);
    } finally {
      setSavingCompanyKey(null);
    }
  };

  const handleSaveCompanyName = async (companyId: string) => {
    const name = editingCompanyName.trim();
    if (!name) {
      setManagementError("Company name is required.");
      setManagementNotice(null);
      return;
    }
    if (!isGlobalAdmin) {
      setManagementError("Only global admins can edit company names.");
      setManagementNotice(null);
      return;
    }
    if (isOffline) {
      setManagementError("Offline mode: company edits require connection.");
      setManagementNotice(null);
      return;
    }
    setSavingCompanyKey(`edit::${companyId}`);
    setManagementError(null);
    setManagementNotice(null);
    try {
      const { error } = await supabase.from("companies").update({ name }).eq("id", companyId);
      if (error) throw error;
      await loadCompanies();
      setEditingCompanyId(null);
      setEditingCompanyName("");
      setManagementNotice("Company name updated.");
    } catch (e) {
      setManagementError(e instanceof Error ? e.message : "Failed to update company.");
      setManagementNotice(null);
    } finally {
      setSavingCompanyKey(null);
    }
  };

  const handleToggleCompanyActive = async (company: CompanyRow) => {
    if (!isGlobalAdmin) {
      setManagementError("Only global admins can change company status.");
      setManagementNotice(null);
      return;
    }
    if (!supportsCompanyActive) return;
    if (isOffline) {
      setManagementError("Offline mode: company status updates require connection.");
      setManagementNotice(null);
      return;
    }
    const nextActive = !company.active;
    setSavingCompanyKey(`active::${company.id}`);
    setManagementError(null);
    setManagementNotice(null);
    try {
      const { error } = await supabase.from("companies").update({ active: nextActive }).eq("id", company.id);
      if (error) throw error;
      await loadCompanies();
      setManagementNotice(nextActive ? "Company activated." : "Company deactivated.");
    } catch (e) {
      setManagementError(e instanceof Error ? e.message : "Failed to update company status.");
      setManagementNotice(null);
    } finally {
      setSavingCompanyKey(null);
    }
  };

  useEffect(() => {
    if (!context.userId || authLoading || isOffline) return;
    void upsertStarterDataSnapshot(context.userId, (prev) => ({
      userId: context.userId!,
      cachedAt: new Date().toISOString(),
      profile: {
        globalRole: context.globalRole,
        companyIds: [...context.companyIds],
        companyRolesById: { ...context.companyRolesById },
      },
      companies: visibleCompanies.map((company) => ({
        id: company.id,
        name: company.name,
        active: company.active,
      })),
      projectsByCompanyId: prev?.projectsByCompanyId || {},
    }))
      .then(() => {
        console.log("[starter-cache] saved companies", context.userId, visibleCompanies.length);
      })
      .catch((err) => {
        console.error("[starter-cache] companies write failed", err);
      });
  }, [authLoading, context, isOffline, visibleCompanies]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/icon.svg" alt="Installer Sheetz" className="h-10 w-10 sm:h-12 sm:w-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Installer Sheetz</h1>
          <p className="mt-1 text-sm text-gray-600">Digital Job Cards for Field Technicians</p>
        </header>

        {loading ? <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading companies...</section> : null}
        {!loading && isOffline && offlineSnapshot ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">Offline — showing cached companies</p>
            {cachedAt ? <p className="mt-1 text-xs">Cached data from {new Date(cachedAt).toLocaleString()}</p> : null}
          </section>
        ) : null}
        {!loading && isOffline && offlineCacheMiss && !loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">No cached companies found. Open this page online once before using offline.</p>
            {process.env.NODE_ENV === "development" ? (
              <p className="mt-2 font-mono text-xs text-amber-800/90">
                [dev] IndexedDB readable but starter snapshot missing — Companies list was never cached for this signed-in user on
                this device.
              </p>
            ) : null}
          </section>
        ) : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load companies: {loadError}
            {process.env.NODE_ENV === "development" && isOffline ? (
              <p className="mt-2 font-mono text-xs text-amber-800/90">
                [dev] Offline path uses IndexedDB only (see console for IndexedDB unavailable vs read failure).
              </p>
            ) : null}
          </section>
        ) : null}
        {managementError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{managementError}</section>
        ) : null}
        {managementNotice ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">{managementNotice}</section>
        ) : null}

        {!loading && !loadError && isGlobalAdmin ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <h2 className="text-base font-bold tracking-tight text-gray-900">Company Management</h2>
            <p className="mt-1 text-sm text-gray-600">Create companies and manage names from the app.</p>
            {supportsCompanyActive === false ? (
              <p className="mt-2 text-xs text-amber-700">
                Company activate/deactivate is unavailable because no `companies.active` field was detected.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={companyNameInput}
                onChange={(e) => setCompanyNameInput(e.target.value)}
                placeholder="New company name"
                className="min-h-[40px] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <button
                type="button"
                onClick={() => void handleCreateCompany()}
                disabled={savingCompanyKey === "create" || isOffline}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {savingCompanyKey === "create" ? "Creating..." : "Create Company"}
              </button>
            </div>
          </section>
        ) : null}

        {!loading && !loadError ? (
          visibleCompanies.length === 0 ? (
            isOffline && offlineCacheMiss ? null : (
              <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
                {isOffline && offlineSnapshot
                  ? "No companies match your cached access for this account."
                  : !authLoading && !context.userId
                    ? "No companies available. Log in to view your assigned companies."
                    : !authLoading && context.userId && context.companyIds.length === 0
                      ? "No companies assigned to your account yet."
                      : "No companies found."}
              </section>
            )
          ) : (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-bold tracking-tight text-gray-900">Select Company</h2>
              {visibleCompanies.map((company) => {
                const roleForCompany = companyRolesForDisplay[company.id];
                const canManageCompanyUsers = isGlobalAdmin || roleForCompany === "admin";
                return (
                  <section
                    key={company.id}
                    className="rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
                  >
                    {editingCompanyId === company.id ? (
                      <div className="space-y-2">
                        <input
                          value={editingCompanyName}
                          onChange={(e) => setEditingCompanyName(e.target.value)}
                          className="w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveCompanyName(company.id)}
                            disabled={savingCompanyKey === `edit::${company.id}`}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            {savingCompanyKey === `edit::${company.id}` ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCompanyId(null);
                              setEditingCompanyName("");
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-lg font-bold text-gray-900">{company.name}</h3>
                        <p className="mt-1 text-sm text-gray-600">Company dashboard</p>
                      </>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!isOffline ? (
                        <Link
                          href={`/companies/${encodeURIComponent(company.id)}/projects`}
                          className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Projects
                        </Link>
                      ) : null}
                      <Link
                        href={`/companies/${encodeURIComponent(company.id)}/customers`}
                        className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Customers / Sites
                      </Link>
                      {canManageCompanyUsers ? (
                        isOffline ? (
                          <span className="inline-flex rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-500">
                            Assignments / Users (online only)
                          </span>
                        ) : (
                          <Link
                            href={`/companies/${encodeURIComponent(company.id)}/assignments`}
                            className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Assignments / Users
                          </Link>
                        )
                      ) : null}
                      {isGlobalAdmin ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCompanyId(company.id);
                              setEditingCompanyName(company.name);
                              setManagementError(null);
                            }}
                            disabled={isOffline}
                            className="inline-flex rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Edit Company
                          </button>
                          {supportsCompanyActive ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleCompanyActive(company)}
                              disabled={savingCompanyKey === `active::${company.id}` || isOffline}
                              className="inline-flex rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                            >
                              {savingCompanyKey === `active::${company.id}`
                                ? "Saving..."
                                : company.active
                                  ? "Deactivate"
                                  : "Activate"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    {isOffline && offlineSnapshot ? (
                      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-600">
                        <h4 className="text-sm font-bold tracking-tight text-gray-900">Cached projects</h4>
                        {(offlineSnapshot.projectsByCompanyId[company.id] ?? []).length === 0 ? (
                          <p className="mt-2 text-sm text-gray-600">
                            No projects cached for this company. Open this company&apos;s Projects page online once.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {(offlineSnapshot.projectsByCompanyId[company.id] ?? []).map((project: CachedProjectItem) => (
                              <li
                                key={project.id}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/60"
                              >
                                <p className="font-semibold text-gray-900 dark:text-slate-100">{project.project_name}</p>
                                <p className="text-xs text-gray-600 dark:text-slate-400">
                                  Customer/site: {project.displayCustomerName?.trim() || "—"}
                                </p>
                                <OfflineStartJobCardLink companyId={company.id} projectId={project.id} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </section>
          )
        ) : null}
      </div>
    </main>
  );
}

