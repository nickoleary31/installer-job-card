"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuthUserContext } from "./AuthUserContextProvider";

export default function AuthStatusBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, context } = useAuthUserContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    setIsSigningOut(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      router.replace("/login");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to log out";
      setError(msg);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <div className="truncate">
          {loading
            ? "Checking session..."
            : context.userId
              ? `Signed in as ${context.userId}`
              : "Not signed in"}
        </div>
        <div className="flex items-center gap-2">
          {context.userId ? (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              disabled={isSigningOut}
            >
              {isSigningOut ? "Logging out..." : "Log out"}
            </button>
          ) : pathname !== "/login" ? (
            <Link
              href="/login"
              className="rounded border border-blue-300 bg-blue-50 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50"
            >
              Log in
            </Link>
          ) : null}
        </div>
      </div>
      {error ? <p className="mx-auto mt-1 w-full max-w-6xl text-red-700">{error}</p> : null}
    </div>
  );
}

