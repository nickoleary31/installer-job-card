"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type CompanyRow = {
  id: string;
  name: string;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase.from("companies").select("id, name").order("name", { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        setCompanies((data as CompanyRow[]) || []);
        setLoadError(null);
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

        {!loading && !loadError ? (
          companies.length === 0 ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600">No companies found.</section>
          ) : (
            <section className="space-y-3">
              <h2 className="px-1 text-base font-bold tracking-tight text-gray-900">Select Company</h2>
              {companies.map((company) => (
                <Link
                  key={company.id}
                  href={`/companies/${encodeURIComponent(company.id)}/projects`}
                  className="block rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-blue-300 hover:bg-blue-50/50"
                >
                  <h3 className="text-lg font-bold text-gray-900">{company.name}</h3>
                  <p className="mt-1 text-sm text-gray-600">Open projects</p>
                </Link>
              ))}
            </section>
          )
        ) : null}
      </div>
    </main>
  );
}

