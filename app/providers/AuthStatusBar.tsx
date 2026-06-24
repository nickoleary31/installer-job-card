"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { deleteStarterDataSnapshot } from "@/lib/starter-data-cache";
import { supabase } from "@/lib/supabase/client";
import { useAuthUserContext } from "./AuthUserContextProvider";

export default function AuthStatusBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, context } = useAuthUserContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const isOnline = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("online", onStoreChange);
      window.addEventListener("offline", onStoreChange);
      return () => {
        window.removeEventListener("online", onStoreChange);
        window.removeEventListener("offline", onStoreChange);
      };
    },
    () => (typeof window === "undefined" ? true : window.navigator.onLine),
    () => true,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch((registerError) => {
      console.warn("Service worker registration failed:", registerError);
    });
  }, []);

  const handleLogout = async () => {
    setIsSigningOut(true);
    setError(null);
    try {
      if (context.userId) {
        try {
          await deleteStarterDataSnapshot(context.userId);
        } catch {
          // ignore cache cleanup errors on logout
        }
      }
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

  const signedInIdentity =
    context.displayName?.trim() || context.email?.trim() || context.userId || null;

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {hasMounted && !isOnline ? (
        <p className="mx-auto mb-2 w-full max-w-6xl rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
          Offline — changes will be saved locally when supported.
        </p>
      ) : null}
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/home" className="flex min-w-0 items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <Image src="/icon.png" alt="Installer Sheetz" width={24} height={24} className="h-6 w-6 rounded" />
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">Installer Sheetz</p>
          </Link>
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
        <div className="mt-2 hidden flex-wrap items-center justify-between gap-2 sm:flex">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/home" className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
              Home
            </Link>
            <Link
              href="/companies"
              className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              Companies
            </Link>
            <Link href="/drafts" className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
              Drafts
            </Link>
            <Link
              href="/offline-drafts"
              className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              Saved on this device
            </Link>
            <Link href="/submitted" className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
              Submitted
            </Link>
          </div>
          <p className="truncate">
            {loading
              ? "Checking session..."
              : context.userId
                ? `Signed in as ${signedInIdentity}`
                : "Not signed in"}
          </p>
        </div>
      </div>
      {error ? <p className="mx-auto mt-1 w-full max-w-6xl text-red-700">{error}</p> : null}
    </div>
  );
}

