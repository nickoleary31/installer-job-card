import { clearLease } from "./offline-access-lease.ts";
import { clearActiveProject } from "../active-project-context.ts";
import { isNativeRuntime } from "../native/runtime.ts";
import { supabase } from "../supabase/client.ts";

/**
 * Explicit technician logout — deliberately different from losing
 * connectivity (see lib/auth/auth-state.ts's offline-fallback path, which
 * this must never be confused with). Invalidates the Phase 2C offline
 * access lease so this device cannot silently re-enter offline access as
 * this user — airplane mode + force-stop + reopen after this must NOT
 * resume the technician's session — plus the existing starter-data-cache
 * cleanup, then signs out of Supabase itself. The lease is native-only
 * (see auth-state.ts's module doc); clearLease() is a harmless no-op if
 * nothing was ever written, so this stays safe to call unconditionally.
 *
 * Checkpoint 1 — on native, also clears the selected company/project
 * navigation pointer (lib/active-project-context.ts), so the next person to
 * sign in on this device starts with no project selected instead of
 * inheriting this user's. That pointer is only navigation state: a job
 * card's project lives with the job card itself (lib/submission-binding.ts),
 * and native only ever seeds a new job card from a pointer the same user set
 * (readActiveProjectForUser) — which is what protects the next user when a
 * session ends without this function running at all.
 *
 * Deliberately does NOT delete the Phase 2B field package for this user —
 * it stays app-private (inaccessible without a valid lease or a fresh
 * online login) rather than being physically erased, so the same user
 * logging back in later can reuse it instead of starting from an empty
 * cache. Revisit if a stronger logout guarantee is ever required. Likewise
 * never touches local submissions, local photos or the outbox, for this
 * user or any other: pending work stays on the device, bound to the user
 * and project it was created under, and syncs the next time that same user
 * is signed in and online here.
 */
export type SignOutDeps = {
  deleteStarterDataSnapshot: (userId: string) => Promise<void>;
  isNative: () => boolean;
  clearLease: () => Promise<void>;
  clearActiveProject: () => void;
  signOut: () => Promise<{ error: Error | null }>;
};

const defaultSignOutDeps: SignOutDeps = {
  // Dynamically imported — same pattern as userContext.ts's own use of this
  // module — so a plain Node test run never has to resolve its "@/..." imports.
  deleteStarterDataSnapshot: async (userId) => {
    const { deleteStarterDataSnapshot } = await import("../starter-data-cache.ts");
    await deleteStarterDataSnapshot(userId);
  },
  isNative: isNativeRuntime,
  clearLease,
  clearActiveProject: () => clearActiveProject(),
  signOut: () => supabase.auth.signOut(),
};

export async function signOutAndClearOfflineState(userId: string | null, deps: SignOutDeps = defaultSignOutDeps): Promise<void> {
  if (userId) {
    try {
      await deps.deleteStarterDataSnapshot(userId);
    } catch {
      // ignore cache cleanup errors on logout
    }
  }
  if (deps.isNative()) {
    try {
      await deps.clearLease();
    } catch {
      // Logout should still proceed even if secure storage is unavailable.
    }
    // Native only: on the web, an empty pointer would send a later
    // /new-submission to the web-only Powerfleet "Default Project" fallback
    // instead of the user's last project — the web keeps its existing
    // behavior until that fallback itself is removed.
    deps.clearActiveProject();
  }
  const { error } = await deps.signOut();
  if (error) throw error;
}
