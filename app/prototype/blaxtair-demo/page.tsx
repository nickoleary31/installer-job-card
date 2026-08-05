"use client";

/**
 * NON-PRODUCTION: local Blaxtair AHD OCR demo. No database / Storage writes.
 * Behind NEXT_PUBLIC_BLAXTAIR_DEMO (default off). Not linked from production nav.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { isBlaxtairDemoEnabled } from "@/lib/prototype/label-scan/blaxtair-demo-flag";

// Reads localStorage for draft resume — client-only, no SSR render.
const BlaxtairOcrDemoPanel = dynamic(
  () => import("@/components/product-devices/BlaxtairOcrDemoPanel").then((m) => m.BlaxtairOcrDemoPanel),
  { ssr: false },
);

export default function BlaxtairDemoPage() {
  if (!isBlaxtairDemoEnabled()) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-slate-100">
        <h1 className="text-lg font-semibold">Blaxtair OCR demo disabled</h1>
        <p className="mt-2 text-sm text-slate-400">
          Set <code className="rounded bg-slate-800 px-1">NEXT_PUBLIC_BLAXTAIR_DEMO=on</code> in{" "}
          <code className="rounded bg-slate-800 px-1">.env.local</code> and restart{" "}
          <code className="rounded bg-slate-800 px-1">next dev</code> to view this local demo.
        </p>
        <p className="mt-4 text-sm">
          <Link className="text-emerald-300 underline" href="/prototype/label-scan">
            Classic LinxUp label-scan prototype
          </Link>
        </p>
      </div>
    );
  }

  return <BlaxtairOcrDemoPanel />;
}
