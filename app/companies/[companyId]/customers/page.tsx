"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";

type CompanyRow = {
  name: string;
};

type CustomerListRow = {
  id: string;
  customer_name: string | null;
  full_address: string | null;
  site_contact_name: string | null;
  contact_number: string | null;
};

function displayCell(value: string | null) {
  const t = value?.trim();
  return t ? t : "—";
}

export default function CompanyCustomersPage() {
  const params = useParams<{ companyId: string }>();
  const searchParams = useSearchParams();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const companyId = String(params.companyId || "");
  const wasCreated = searchParams.get("created") === "1";
  const [companyName, setCompanyName] = useState("—");
  const [customers, setCustomers] = useState<CustomerListRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(() => companyId.length > 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const companyRole = userContext.companyRolesById[companyId];
  const isGlobalAdmin = userContext.globalRole === "admin";
  const isActiveCompanyAdmin = companyRole === "admin";
  const canManageCompanyData = isGlobalAdmin || isActiveCompanyAdmin;

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
    const loadCompanyName = async () => {
      if (!companyId) return;
      try {
        const { data, error } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle<CompanyRow>();
        if (error || cancelled || !data?.name) return;
        setCompanyName(data.name.trim() || "—");
      } catch {
        // keep fallback
      }
    };
    void loadCompanyName();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        let allowedIds: Set<string> | null = null;
        if (companyRole === "technician" && userContext.userId) {
          const { data: assignments, error: assignmentError } = await supabase
            .from("project_assignments")
            .select("project_id")
            .eq("user_id", userContext.userId)
            .eq("is_active", true);
          if (assignmentError) throw assignmentError;

          const assignedProjectIds = ((assignments as { project_id: string }[]) || []).map((row) => row.project_id).filter(Boolean);
          if (assignedProjectIds.length > 0) {
            const { data: projectRows, error: projectError } = await supabase
              .from("projects")
              .select("customer_id")
              .eq("company_id", companyId)
              .in("id", assignedProjectIds);
            if (projectError) throw projectError;

            allowedIds = new Set(
              ((projectRows as { customer_id: string | null }[]) || []).map((row) => row.customer_id).filter((value): value is string => !!value),
            );
          } else {
            allowedIds = new Set();
          }
        }

        const { data, error } = await supabase
          .from("customers")
          .select("id, customer_name, full_address, site_contact_name, contact_number")
          .eq("company_id", companyId)
          .order("customer_name", { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        const customerRows = (data as CustomerListRow[]) || [];
        const visibleCustomers = allowedIds ? customerRows.filter((row) => allowedIds?.has(row.id)) : customerRows;
        setCustomers(visibleCustomers);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load customers";
          setLoadError(msg);
          setCustomers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, companyId, companyRole, userContext.userId]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const name = (c.customer_name || "").toLowerCase();
      const addr = (c.full_address || "").toLowerCase();
      return name.includes(q) || addr.includes(q);
    });
  }, [customers, searchQuery]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-5xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <p className="text-center text-lg font-semibold text-gray-700 dark:text-gray-300">Company: {companyName}</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Customers / Sites</h1>
          <p className="mt-1 text-sm text-gray-600">Browse customers and sites for this company.</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                href={`/companies/${encodeURIComponent(companyId)}/projects`}
                className="inline-flex text-sm font-semibold text-blue-700 hover:underline"
              >
                Back to Projects
              </Link>
            </div>
            {canManageCompanyData ? (
              <Link
                href={`/companies/${encodeURIComponent(companyId)}/customers/new`}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
              >
                New Customer / Site
              </Link>
            ) : null}
          </div>
        </header>

        {wasCreated ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            Customer saved.
          </section>
        ) : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <label className="mb-2 block text-sm font-semibold text-gray-800" htmlFor="customer-search">
            Search by customer or site
          </label>
          <input
            id="customer-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name or address…"
            className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
            autoComplete="off"
          />
        </section>

        {loading ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">Loading customers…</section>
        ) : null}
        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Could not load customers: {loadError}
          </section>
        ) : null}

        {!loading && !loadError ? (
          filteredCustomers.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              {customers.length === 0
                ? "No customers/sites yet. Add one or create one while adding a project."
                : "No customers match your search."}
              {canManageCompanyData ? (
                <div className="mt-3">
                  <Link
                    href={`/companies/${encodeURIComponent(companyId)}/customers/new`}
                    className="inline-flex rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Add Customer / Site
                  </Link>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold text-gray-800">
                      Customer / site
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-gray-800">
                      Address
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-gray-800">
                      Site contact
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-gray-800">
                      Contact number
                    </th>
                    <th scope="col" className="w-28 px-4 py-3 font-semibold text-gray-800">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredCustomers.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 font-medium text-gray-900">{displayCell(row.customer_name)}</td>
                      <td className="max-w-xs px-4 py-3 text-gray-800">{displayCell(row.full_address)}</td>
                      <td className="px-4 py-3 text-gray-800">{displayCell(row.site_contact_name)}</td>
                      <td className="px-4 py-3 text-gray-800">{displayCell(row.contact_number)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/companies/${encodeURIComponent(companyId)}/customers/${encodeURIComponent(row.id)}`}
                          className="inline-flex rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>
    </main>
  );
}
