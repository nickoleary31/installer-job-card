"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

type CompanyRow = {
  id: string;
  name: string;
  active?: boolean;
};

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

  const isGlobalAdmin = context.globalRole === "admin";

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
      try {
        await loadCompanies();
        if (cancelled) return;
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
  }, []);

  const visibleCompanies = useMemo(() => {
    // Never show anything while auth is loading
    if (authLoading) return [];

    // Not logged in → show nothing
    if (!context.userId) return [];

    // globalRole "admin" is treated as a super user with access to all companies
    if (isGlobalAdmin) {
      return companies;
    }

    // Normal users → membership-based
    if (context.companyIds.length === 0) return [];

    const allowed = new Set(context.companyIds);
    return companies.filter((company) => allowed.has(company.id));
  }, [authLoading, companies, context, isGlobalAdmin]);

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

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/icon.svg" alt="Installer Sheetz" className="h-10 w-10 sm:h-12 sm:w-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Installer Sheetz</h1>
          <p className="mt-1 text-sm text-gray-600">Digital Job Cards for Field Technicians</p>
        </header>

        {loading ? <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading companies...</section> : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load companies: {loadError}
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
                disabled={savingCompanyKey === "create"}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {savingCompanyKey === "create" ? "Creating..." : "Create Company"}
              </button>
            </div>
          </section>
        ) : null}

        {!loading && !loadError ? (
          visibleCompanies.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              {!authLoading && !context.userId
                ? "No companies available. Log in to view your assigned companies."
                : !authLoading && context.userId && context.companyIds.length === 0
                  ? "No companies assigned to your account yet."
                  : "No companies found."}
            </section>
          ) : (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-bold tracking-tight text-gray-900">Select Company</h2>
              {visibleCompanies.map((company) => {
                const roleForCompany = context.companyRolesById[company.id];
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
                      <Link
                        href={`/companies/${encodeURIComponent(company.id)}/projects`}
                        className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Projects
                      </Link>
                      <Link
                        href={`/companies/${encodeURIComponent(company.id)}/customers`}
                        className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Customers / Sites
                      </Link>
                      {canManageCompanyUsers ? (
                        <Link
                          href={`/companies/${encodeURIComponent(company.id)}/assignments`}
                          className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Assignments / Users
                        </Link>
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
                            className="inline-flex rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Edit Company
                          </button>
                          {supportsCompanyActive ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleCompanyActive(company)}
                              disabled={savingCompanyKey === `active::${company.id}`}
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

