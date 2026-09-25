import type { AuthUserContext, AuthUserContextResult } from "./userContext.ts";
import {
  checkLeaseValidity,
  clearLease,
  issueOrRefreshLease,
  loadLease,
  saveLease,
  type LeaseValidityVerdict,
  type OfflineAccessLease,
} from "./offline-access-lease.ts";
import { getDeviceInstallationId } from "../native/device-installation.ts";
import { getNetworkStatus } from "../native/network-status.ts";
import { isNativeRuntime } from "../native/runtime.ts";

/**
 * Phase 2C — the four materially different reasons the app might grant (or
 * refuse) access, deliberately not collapsed into a single isAuthenticated
 * boolean:
 *
 *  - "online": Supabase/Installer Sheetz confirmed this user right now.
 *  - "offline-authorized": the server could not be reached, or reported
 *    its own temporary trouble, or gave us nothing conclusive — see
 *    AuthUserContextSource's categories — but this NATIVE installation
 *    holds a currently valid, unexpired offline access lease (see
 *    offline-access-lease.ts). Access is scoped to exactly that lease's
 *    userId and to the Phase 2B field package already saved for it — no
 *    assignment/role logic is recomputed locally.
 *  - "offline-locked": offline (or server-unavailable) with no usable
 *    lease — missing, expired, or structurally/temporally invalid. See
 *    `offlineLockReason` for which. Deliberately distinct from
 *    "signed-out" so the UI can tell "you have no session, and you're
 *    online" apart from "you have no usable offline access right now."
 *  - "signed-out": online with no valid session (the ordinary "please log
 *    in" case), or an explicit server denial/revocation.
 *  - "web-unverified" (Checkpoint 1, WEB/PWA ONLY): the browser still holds
 *    its own Supabase session, but the server couldn't be reached (or
 *    reported temporary trouble) to re-confirm it right now. The context is
 *    whatever userContext.ts could resolve locally — the cached starter
 *    snapshot, else a minimal session-only context — exactly what the web
 *    app used before Phase 2C. It is NOT offline authorization: no lease,
 *    no offline project packages, no local-first submission; every
 *    offline-authorized code path checks for "offline-authorized" and so
 *    never runs for it.
 *
 * The offline access lease is a NATIVE-ONLY concept — see resolveAuthState()
 * below. The web/PWA build never consults or writes it; see
 * decideWebAuthMode() for what a non-"online" category means on web.
 */
export type AuthMode = "online" | "offline-authorized" | "offline-locked" | "signed-out" | "web-unverified";

export type OfflineLockReason = "no-lease" | "expired" | "invalid";

export type ResolvedAuthState = {
  mode: AuthMode;
  context: AuthUserContext;
  /** Set only when mode === "offline-authorized". */
  lease: OfflineAccessLease | null;
  /** Set only when mode === "offline-locked" — which UI copy to show. */
  offlineLockReason: OfflineLockReason | null;
};

/**
 * Pure — the actual state-machine decision, given the online resolution
 * outcome, the already-computed lease validity verdict (or `null` when the
 * lease concept does not apply at all — i.e. non-native), and whether the
 * device is currently offline. Unit-testable without any Supabase/secure-
 * storage/network I/O; see auth-state.test.ts. Does not itself persist
 * anything — resolveAuthState() below is the impure shell that reads/
 * writes the lease store and checks connectivity around this decision.
 *
 * Category-by-category eligibility (matching classify-supabase-error.ts's
 * four failure categories, plus "signed-out" for "no session to check"):
 *
 *  - "unavailable" / "offline-transport": both already carry POSITIVE,
 *    independent evidence of the problem (a real 5xx/429/infra response,
 *    or a confirmed no-response transport failure) — the lease is always
 *    consulted here, regardless of isDeviceOffline. A temporary backend
 *    outage can happen even while the device's own network is technically
 *    fine.
 *  - "unknown": no positive evidence either way. Must NOT unlock offline
 *    access on the strength of the unknown error alone — only when
 *    isDeviceOffline INDEPENDENTLY confirms the device is offline right
 *    now is the lease even consulted.
 *  - "signed-out": no local session was even found — same isDeviceOffline
 *    gate as "unknown", for the same reason: a never-logged-in visitor
 *    opening the app online on a shared device must never inherit a
 *    previous user's offline access just because no session was found.
 *  - "denied": never eligible — decided unconditionally signed-out here;
 *    invalidating the stored lease happens in resolveAuthState() (the
 *    impure shell), since this function only decides, never persists.
 */
export function decideAuthMode(
  result: AuthUserContextResult,
  leaseCheck: LeaseValidityVerdict | null,
  isDeviceOffline: boolean,
): ResolvedAuthState {
  switch (result.source.kind) {
    case "online":
      return { mode: "online", context: result.context, lease: null, offlineLockReason: null };

    case "denied":
      return signedOut();

    case "unavailable":
    case "offline-transport":
      return offlineOutcome(result, leaseCheck);

    case "unknown":
    case "signed-out":
      if (isDeviceOffline) {
        return offlineOutcome(result, leaseCheck);
      }
      return signedOut();
  }
}

function offlineOutcome(result: AuthUserContextResult, leaseCheck: LeaseValidityVerdict | null): ResolvedAuthState {
  if (leaseCheck === null) {
    // Not a native installation — the offline access lease never applies
    // to the browser/PWA build (see this file's module doc).
    return signedOut();
  }
  switch (leaseCheck.status) {
    case "missing":
      return offlineLocked("no-lease");
    case "expired":
      return offlineLocked("expired");
    case "invalid":
    case "clock-rollback":
      return offlineLocked("invalid");
    case "valid": {
      const lease = leaseCheck.lease;
      return {
        mode: "offline-authorized",
        context: {
          ...result.context,
          userId: lease.userId,
          displayName: lease.displayName,
          email: lease.email,
        },
        lease,
        offlineLockReason: null,
      };
    }
  }
}

/**
 * Checkpoint 1 — the WEB/PWA decision. A temporary connectivity loss or
 * server hiccup must not sign a browser user out: before Phase 2C the web
 * kept the locally-resolved context in exactly these cases (see
 * userContext.ts's resolveOfflineFallbackContext), and routing them to
 * "signed-out" bounced PC/Mac users to /login mid-form. Explicit denials and
 * "no session at all" still sign out, and a fallback with no user id (the
 * "unknown" category with nothing cached) still fails closed.
 */
export function decideWebAuthMode(result: AuthUserContextResult): ResolvedAuthState {
  switch (result.source.kind) {
    case "online":
      return { mode: "online", context: result.context, lease: null, offlineLockReason: null };
    case "unavailable":
    case "offline-transport":
    case "unknown":
      if (result.context.userId) {
        return { mode: "web-unverified", context: result.context, lease: null, offlineLockReason: null };
      }
      return signedOut();
    case "denied":
    case "signed-out":
      return signedOut();
  }
}

function offlineLocked(reason: OfflineLockReason): ResolvedAuthState {
  return { mode: "offline-locked", context: emptySignedOutContext(), lease: null, offlineLockReason: reason };
}

function signedOut(): ResolvedAuthState {
  return { mode: "signed-out", context: emptySignedOutContext(), lease: null, offlineLockReason: null };
}

function emptySignedOutContext(): AuthUserContext {
  return {
    userId: null,
    displayName: null,
    email: null,
    phone: null,
    jobTitle: null,
    globalRole: null,
    profileIsActive: false,
    onboardingCompleted: true,
    companyIds: [],
    companyRolesById: {},
  };
}

/**
 * Impure orchestration: resolves the online context, consults/updates the
 * offline access lease around decideAuthMode()'s pure decision.
 *
 *  - On "online" with an active profile: issues/refreshes the lease
 *    (lastValidatedAt bumped to now, offlineAccessExpiresAt recomputed as
 *    now + 7 days, issuedAt preserved for the same user+installation). A
 *    confirmed-online-but-inactive/zero-company result does NOT lease —
 *    decideAuthMode() only ever sees "online" here once that gate has
 *    passed.
 *  - On "denied" (explicit invalid-session/inactive-user response):
 *    invalidates any existing lease unconditionally — an explicit denial
 *    must never leave stale offline access behind. This is the ONLY
 *    category that ever clears the lease; "unavailable"/"offline-transport"/
 *    "unknown"/"signed-out" never do, matching the rule that a temporary
 *    server problem — or simply not finding a session — is not an
 *    authorization revocation.
 *  - On every other category: native-only. The web/PWA build returns
 *    straight to decideWebAuthMode() (never touching the lease store at
 *    all — see this file's module doc on why). The
 *    native build loads the lease, resolves its validity via
 *    checkLeaseValidity() against a FRESH network check and this
 *    installation's own id, opportunistically persists the validity
 *    check's clock-rollback-ratchet update (best-effort, never blocks the
 *    decision), and hands the verdict to decideAuthMode().
 *
 * `deps` defaults to the real secure-storage/network/native implementations
 * but is injectable so this orchestration's actual I/O calls (does it
 * clear? does it issue? does it even touch the lease?) — and the lease's
 * own time-dependent logic — are unit-testable with fakes/fake clocks
 * instead of a real device or the emulator's wall clock; see
 * auth-state.test.ts.
 */
export type AuthStateDeps = {
  clearLease: () => Promise<void>;
  loadLease: () => Promise<OfflineAccessLease | null>;
  saveLease: (lease: OfflineAccessLease) => Promise<void>;
  issueOrRefreshLease: (params: { userId: string; displayName: string | null; email: string | null }) => Promise<void>;
  isOnlineFresh: () => Promise<boolean>;
  isNative: () => boolean;
  now: () => string;
  getDeviceInstallationId: () => Promise<string>;
};

const defaultAuthStateDeps: AuthStateDeps = {
  clearLease,
  loadLease,
  saveLease,
  issueOrRefreshLease,
  isOnlineFresh: () => getNetworkStatus().isOnlineFresh(),
  isNative: isNativeRuntime,
  now: () => new Date().toISOString(),
  getDeviceInstallationId,
};

export async function resolveAuthState(
  result: AuthUserContextResult,
  deps: AuthStateDeps = defaultAuthStateDeps,
): Promise<ResolvedAuthState> {
  if (result.source.kind === "online" && result.context.userId && result.context.profileIsActive) {
    if (deps.isNative()) {
      await deps
        .issueOrRefreshLease({
          userId: result.context.userId,
          displayName: result.context.displayName,
          email: result.context.email,
        })
        .catch(() => {
          // The lease is a convenience for later offline access, not a
          // requirement for using the app online right now.
        });
    }
    return decideAuthMode(result, null, false);
  }

  if (result.source.kind === "denied") {
    if (deps.isNative()) {
      await deps.clearLease().catch(() => {});
    }
    return decideAuthMode(result, null, false);
  }

  if (!deps.isNative()) {
    // Web/PWA: the offline access lease never applies — see module doc and
    // decideWebAuthMode() for why a lost connection keeps the web session.
    return decideWebAuthMode(result);
  }

  // "unavailable" | "offline-transport" | "unknown" | "signed-out", native only.
  //
  // A fresh, awaited check — never the synchronous isOnline() snapshot —
  // because this decides whether to unlock offline access at all; reading
  // a stale "online" default here (e.g. right after a cold launch, before
  // the cache has self-corrected) would wrongly refuse a legitimate
  // offline-authorized entry. See network-status.ts's isOnlineFresh() doc.
  const isDeviceOffline = !(await deps.isOnlineFresh());
  const lease = await deps.loadLease().catch(() => null);
  const deviceInstallationId = await deps.getDeviceInstallationId().catch(() => "");
  const leaseCheck = checkLeaseValidity(lease, deps.now(), deviceInstallationId);

  if (leaseCheck.status === "valid" && leaseCheck.nextLease !== leaseCheck.lease) {
    // Clock-rollback ratchet update only — never extends expiresAt, never
    // blocks the decision below if the write itself fails.
    await deps.saveLease(leaseCheck.nextLease).catch(() => {});
  }

  return decideAuthMode(result, leaseCheck, isDeviceOffline);
}
