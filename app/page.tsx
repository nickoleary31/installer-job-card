"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { urlLooksLikeInviteAuthCallback } from "@/lib/auth/onboarding";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Supabase may rewrite invite redirect_to to Site URL (/). Keep the root
    // page from bouncing invite sessions into /home -> /login before accept-invite.
    if (typeof window !== "undefined" && urlLooksLikeInviteAuthCallback(window.location.href)) {
      return;
    }
    router.replace("/home");
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl px-4 sm:px-5 sm:py-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <p className="text-sm font-medium text-gray-700">Opening home...</p>
          <Link href="/home" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:underline">
            Continue
          </Link>
        </section>
      </div>
    </main>
  );
}
