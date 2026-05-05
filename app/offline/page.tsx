"use client";

import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <h1 className="text-2xl font-bold text-gray-900">You are offline</h1>
        <p className="mt-2 text-sm text-gray-600">
          Installer Sheetz can open cached screens while offline. Reconnect to sync changes and access live data.
        </p>
        <Link
          href="/companies"
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
        >
          Back to Companies
        </Link>
      </section>
    </main>
  );
}
