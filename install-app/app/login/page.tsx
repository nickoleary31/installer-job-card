"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    setError(null);
    const emailTrimmed = email.trim();
    if (!emailTrimmed || !password) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });
      if (signInError) throw signInError;
      router.push("/companies");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to log in";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-md space-y-4 px-4">
        <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Log in</h1>
          <p className="mt-1 text-sm text-gray-600">Use your Supabase email/password account.</p>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                autoComplete="current-password"
              />
            </div>
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

          <div className="mt-5 flex items-center justify-between">
            <Link href="/companies" className="text-sm font-semibold text-blue-700 hover:underline">
              Back to app
            </Link>
            <button
              type="button"
              onClick={() => void handleLogin()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? "Logging in..." : "Log in"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

