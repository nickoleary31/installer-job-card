import { clearLease } from "./offline-access-lease.ts";
import { isNativeRuntime } from "../native/runtime.ts";
import { deleteStarterDataSnapshot } from "../starter-data-cache.ts";
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
 * Deliberately does NOT delete the Phase 2B field package for this user —
 * it stays app-private (inaccessible without a valid lease or a fresh
 * online login) rather than being physically erased, so the same user
 * logging back in later can reuse it instead of starting from an empty
 * cache. Revisit if a stronger logout guarantee is ever required.
 */
export async function signOutAndClearOfflineState(userId: string | null): Promise<void> {
  if (userId) {
    try {
      await deleteStarterDataSnapshot(userId);
    } catch {
      // ignore cache cleanup errors on logout
    }
  }
  if (isNativeRuntime()) {
    try {
      await clearLease();
    } catch {
      // Logout should still proceed even if secure storage is unavailable.
    }
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
