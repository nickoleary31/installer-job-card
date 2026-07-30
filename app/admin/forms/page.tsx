"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";

type CompanyRow = {
  id: string;
  name: string;
  productCount: number;
  configMode: "registry" | "database";
};

export default function AdminFormsPage() {
  const router = useRouter();
  const { loading: authLoading, context } = useAuthUserContext();
  const isGlobalAdmin = context.globalRole === "admin" && context.profileIsActive;

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [tableAvailable, setTableAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token?.trim() || "";
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch("/api/admin/form-products", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as {
        error?: string;
        companies?: CompanyRow[];
        tableAvailable?: boolean;
      };
      if (!res.ok) throw new Error(json.error || `Failed to load (${res.status})`);
      setCompanies(json.companies || []);
      setTableAvailable(json.tableAvailable !== false);
    } catch (e) {
      setCompanies([]);
      setError(e instanceof Error ? e.message : "Failed to load companies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!context.userId) {
      router.replace("/login");
      return;
    }
    if (!isGlobalAdmin) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, context.userId, isGlobalAdmin, load, router]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!isGlobalAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          Only active global admins can manage form/product configuration.
          <div className="mt-3">
            <Link href="/home" className="font-semibold text-blue-700 underline">
              Return home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-12 pt-6 sm:px-5">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Admin</p>
              <h1 className="mt-1 text-2xl font-bold text-gray-950">Form / Product Admin</h1>
              <p className="mt-1 text-sm text-gray-600">
                Phase 1: map company products to existing base forms. Field builders come later.
              </p>
            </div>
            <Link
              href="/admin/users"
              className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800"
            >
              Global Users
            </Link>
          </div>
        </header>

        {!tableAvailable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>Migration not applied.</strong> The <code>company_form_products</code> table is
            unavailable. Companies still use registry configuration. Apply{" "}
            <code>20260730120000_company_form_products.sql</code> after review.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
        )}

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-bold text-gray-900">Companies</h2>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-sm text-gray-600">Loading…</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {companies.map((company) => (
                <li key={company.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-semibold text-gray-950">{company.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {company.productCount} database product{company.productCount === 1 ? "" : "s"} ·{" "}
                      {company.configMode === "database" ? "Database override" : "Registry fallback"}
                    </p>
                  </div>
                  <Link
                    href={`/admin/forms/${company.id}`}
                    className="inline-flex min-h-[40px] items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
                  >
                    Manage products
                  </Link>
                </li>
              ))}
              {companies.length === 0 && (
                <li className="px-5 py-6 text-sm text-gray-600">No companies found.</li>
              )}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
