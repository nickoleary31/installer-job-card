import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideAuthMode, resolveAuthState, type AuthStateDeps } from "./auth-state.ts";
import { checkLeaseValidity, type LeaseValidityVerdict, type OfflineAccessLease } from "./offline-access-lease.ts";
import type { AuthUserContext, AuthUserContextResult, AuthUserContextSource } from "./userContext.ts";

const DEVICE_A = "device-aaaa-1111";

function onlineContext(overrides: Partial<AuthUserContext> = {}): AuthUserContext {
  return {
    userId: "user-1",
    displayName: "Jane Tech",
    email: "jane@example.com",
    phone: null,
    jobTitle: null,
    globalRole: "technician",
    profileIsActive: true,
    onboardingCompleted: true,
    companyIds: ["company-1"],
    companyRolesById: { "company-1": "technician" },
    ...overrides,
  };
}

function result(source: AuthUserContextSource, contextOverrides: Partial<AuthUserContext> = {}): AuthUserContextResult {
  return { source, context: onlineContext(contextOverrides) };
}

function lease(overrides: Partial<OfflineAccessLease> = {}): OfflineAccessLease {
  return {
    schemaVersion: 2,
    userId: "user-1",
    deviceInstallationId: DEVICE_A,
    issuedAt: "2026-01-01T00:00:00.000Z",
    lastValidatedAt: "2026-01-05T00:00:00.000Z",
    offlineAccessExpiresAt: "2026-01-12T00:00:00.000Z",
    lastObservedDeviceTime: "2026-01-05T00:00:00.000Z",
    displayName: "Jane Tech",
    email: "jane@example.com",
    ...overrides,
  };
}

/** Wraps checkLeaseValidity's own real logic so decideAuthMode's tests exercise real verdicts, not hand-built ones. */
function validVerdict(overrides: Partial<OfflineAccessLease> = {}, nowIso = "2026-01-06T00:00:00.000Z"): LeaseValidityVerdict {
  const verdict = checkLeaseValidity(lease(overrides), nowIso, DEVICE_A);
  assert.equal(verdict.status, "valid", "test setup expected a valid lease");
  return verdict;
}

const MISSING: LeaseValidityVerdict = { status: "missing" };
const EXPIRED: LeaseValidityVerdict = { status: "expired", lease: lease() };
const INVALID: LeaseValidityVerdict = { status: "invalid", lease: lease() };
const CLOCK_ROLLBACK: LeaseValidityVerdict = { status: "clock-rollback", lease: lease() };

describe("decideAuthMode", () => {
  it("online valid session -> online mode, using the fresh online context", () => {
    const state = decideAuthMode(result({ kind: "online" }), null, false);
    assert.equal(state.mode, "online");
    assert.equal(state.context.userId, "user-1");
    assert.equal(state.lease, null);
    assert.equal(state.offlineLockReason, null);
  });

  it("confirmed offline-transport + valid lease -> offline-authorized, scoped to the lease's userId", () => {
    const state = decideAuthMode(
      result({ kind: "offline-transport" }, { userId: "user-1", profileIsActive: false, companyIds: [], companyRolesById: {} }),
      validVerdict({ userId: "user-1" }),
      true,
    );
    assert.equal(state.mode, "offline-authorized");
    assert.equal(state.context.userId, "user-1");
    assert.ok(state.lease);
  });

  it("transport failure + valid lease -> permitted fallback even if isDeviceOffline reads false (already positive evidence)", () => {
    const state = decideAuthMode(result({ kind: "offline-transport" }), validVerdict(), false);
    assert.equal(state.mode, "offline-authorized");
  });

  it("server-reported unavailable (5xx/429) + valid lease -> permitted fallback, does NOT require isDeviceOffline", () => {
    const state = decideAuthMode(result({ kind: "unavailable" }), validVerdict(), false);
    assert.equal(state.mode, "offline-authorized");
    assert.equal(state.context.userId, lease().userId);
  });

  it("offline-transport + no lease (missing) -> offline-locked, reason no-lease", () => {
    const state = decideAuthMode(result({ kind: "offline-transport" }), MISSING, true);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "no-lease");
    assert.equal(state.context.userId, null);
  });

  it("unavailable + expired lease -> offline-locked, reason expired", () => {
    const state = decideAuthMode(result({ kind: "unavailable" }), EXPIRED, false);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "expired");
  });

  it("offline-transport + invalid lease (wrong device / malformed) -> offline-locked, reason invalid", () => {
    const state = decideAuthMode(result({ kind: "offline-transport" }), INVALID, true);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "invalid");
  });

  it("offline-transport + clock-rollback -> offline-locked, reason invalid (does not distinguish for the UI)", () => {
    const state = decideAuthMode(result({ kind: "offline-transport" }), CLOCK_ROLLBACK, true);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "invalid");
  });

  it("explicit invalid-session denial -> signed-out, must NOT fall back offline even if a valid lease exists", () => {
    const state = decideAuthMode(result({ kind: "denied", reason: "invalid-session" }, { userId: null }), validVerdict(), true);
    assert.equal(state.mode, "signed-out");
    assert.equal(state.context.userId, null);
  });

  it("explicit inactive-user denial -> signed-out, must NOT fall back offline even if a valid lease exists", () => {
    const state = decideAuthMode(result({ kind: "denied", reason: "inactive-user" }, { userId: null }), validVerdict(), true);
    assert.equal(state.mode, "signed-out");
  });

  it("unknown error, genuinely offline + valid lease -> offline-authorized (independently justified by isDeviceOffline)", () => {
    const state = decideAuthMode(result({ kind: "unknown" }), validVerdict(), true);
    assert.equal(state.mode, "offline-authorized");
  });

  it("SAFETY: unknown error while online must NOT silently grant offline access, even with a valid lease present", () => {
    const state = decideAuthMode(result({ kind: "unknown" }, { userId: null }), validVerdict({ userId: "previous-user" }), false);
    assert.equal(state.mode, "signed-out");
    assert.equal(state.context.userId, null);
  });

  it("SAFETY: unknown error + no independent offline confirmation + no lease -> signed-out", () => {
    const state = decideAuthMode(result({ kind: "unknown" }), MISSING, false);
    assert.equal(state.mode, "signed-out");
  });

  it("no local session found (signed-out) while genuinely OFFLINE + a valid lease exists -> offline-authorized", () => {
    // Covers a device whose cached Supabase session was cleared/lost while
    // a separate lease record still exists — the lease is independent of
    // Supabase's own token storage by design.
    const state = decideAuthMode(result({ kind: "signed-out" }, { userId: null }), validVerdict(), true);
    assert.equal(state.mode, "offline-authorized");
    assert.equal(state.context.userId, "user-1");
  });

  it("SAFETY: online + no Supabase session (signed-out) + a lease record present must NOT inherit the previous user's session", () => {
    // A never-logged-in visitor opening the app online on a shared device
    // must never be silently treated as a previous leased user —
    // isDeviceOffline=false must suppress the fallback entirely.
    const state = decideAuthMode(result({ kind: "signed-out" }, { userId: null }), validVerdict({ userId: "previous-user" }), false);
    assert.equal(state.mode, "signed-out");
    assert.equal(state.context.userId, null);
  });

  it("signed-out + offline + no lease -> offline-locked, reason no-lease (not plain signed-out)", () => {
    const state = decideAuthMode(result({ kind: "signed-out" }, { userId: null }), MISSING, true);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "no-lease");
  });

  it("User A's lease is never returned for User B — offline-authorized always reflects the stored lease's own userId", () => {
    const state = decideAuthMode(
      result({ kind: "offline-transport" }, { userId: "user-B-attempted" }),
      validVerdict({ userId: "user-A-actual" }),
      true,
    );
    assert.equal(state.mode, "offline-authorized");
    assert.equal(state.context.userId, "user-A-actual");
    assert.notEqual(state.context.userId, "user-B-attempted");
  });

  it("WEB/PWA: leaseCheck === null (lease concept not applicable) -> signed-out even when offline, never offline-locked/offline-authorized", () => {
    const state = decideAuthMode(result({ kind: "offline-transport" }), null, true);
    assert.equal(state.mode, "signed-out");
    assert.equal(state.offlineLockReason, null);
    assert.equal(state.lease, null);
  });
});

/** Fake deps that record every call, for asserting resolveAuthState()'s actual I/O behavior. */
function fakeDeps(overrides: Partial<AuthStateDeps> = {}): AuthStateDeps & {
  clearCalls: number;
  issueCalls: Array<{ userId: string; displayName: string | null; email: string | null }>;
  saveCalls: OfflineAccessLease[];
} {
  const clearCallsBox = { count: 0 };
  const issueCallsBox: Array<{ userId: string; displayName: string | null; email: string | null }> = [];
  const saveCallsBox: OfflineAccessLease[] = [];
  return {
    clearLease: async () => {
      clearCallsBox.count++;
    },
    loadLease: async () => lease(),
    saveLease: async (l) => {
      saveCallsBox.push(l);
    },
    issueOrRefreshLease: async (params) => {
      issueCallsBox.push(params);
    },
    isOnlineFresh: async () => true,
    isNative: () => true,
    now: () => "2026-01-06T00:00:00.000Z",
    getDeviceInstallationId: async () => DEVICE_A,
    ...overrides,
    get clearCalls() {
      return clearCallsBox.count;
    },
    issueCalls: issueCallsBox,
    saveCalls: saveCallsBox,
  };
}

describe("resolveAuthState (impure orchestration — actual lease I/O behavior)", () => {
  it("online + active profile, native -> issues/refreshes the lease, never clears it", async () => {
    const deps = fakeDeps();
    const state = await resolveAuthState(result({ kind: "online" }), deps);
    assert.equal(state.mode, "online");
    assert.equal(deps.issueCalls.length, 1);
    assert.equal(deps.issueCalls[0].userId, "user-1");
    assert.equal(deps.clearCalls, 0);
  });

  it("online + active profile, WEB (isNative false) -> never touches the lease at all", async () => {
    const deps = fakeDeps({ isNative: () => false });
    const state = await resolveAuthState(result({ kind: "online" }), deps);
    assert.equal(state.mode, "online");
    assert.equal(deps.issueCalls.length, 0);
    assert.equal(deps.clearCalls, 0);
  });

  it("explicit inactive-user denial, native -> clears the lease", async () => {
    const deps = fakeDeps();
    await resolveAuthState(result({ kind: "denied", reason: "inactive-user" }, { userId: null }), deps);
    assert.equal(deps.clearCalls, 1);
    assert.equal(deps.issueCalls.length, 0);
  });

  it("explicit invalid-session denial, native -> clears the lease", async () => {
    const deps = fakeDeps();
    await resolveAuthState(result({ kind: "denied", reason: "invalid-session" }, { userId: null }), deps);
    assert.equal(deps.clearCalls, 1);
  });

  it("explicit denial, WEB (isNative false) -> never touches the lease (nothing to clear)", async () => {
    const deps = fakeDeps({ isNative: () => false });
    await resolveAuthState(result({ kind: "denied", reason: "inactive-user" }, { userId: null }), deps);
    assert.equal(deps.clearCalls, 0);
  });

  it("500/service-unavailable + valid lease -> does NOT clear, resolves offline-authorized", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => true });
    const state = await resolveAuthState(result({ kind: "unavailable" }), deps);
    assert.equal(deps.clearCalls, 0);
    assert.equal(state.mode, "offline-authorized");
  });

  it("429 rate-limit-shaped unavailable failure -> does NOT clear the lease", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => true });
    await resolveAuthState(result({ kind: "unavailable" }), deps);
    assert.equal(deps.clearCalls, 0);
  });

  it("unknown error while online (isOnlineFresh true) -> does NOT clear, does NOT grant offline access", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => true });
    const state = await resolveAuthState(result({ kind: "unknown" }, { userId: null }), deps);
    assert.equal(deps.clearCalls, 0);
    assert.equal(state.mode, "signed-out");
  });

  it("no lease on record (missing) + offline -> offline-locked, never clears (nothing to clear)", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => false, loadLease: async () => null });
    const state = await resolveAuthState(result({ kind: "unknown" }, { userId: null }), deps);
    assert.equal(deps.clearCalls, 0);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "no-lease");
  });

  it("signed out explicitly (no local session) + online -> plain signed-out, lease left untouched", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => true, loadLease: async () => null });
    const state = await resolveAuthState(result({ kind: "signed-out" }, { userId: null }), deps);
    assert.equal(deps.clearCalls, 0);
    assert.equal(state.mode, "signed-out");
  });

  it("offline-transport failure -> consults but never clears the lease", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => false });
    const state = await resolveAuthState(result({ kind: "offline-transport" }), deps);
    assert.equal(deps.clearCalls, 0);
    assert.equal(state.mode, "offline-authorized");
  });

  it("expired lease + offline -> offline-locked, reason expired, never clears the expired record itself", async () => {
    const expired = lease({ offlineAccessExpiresAt: "2026-01-01T00:00:00.000Z" });
    const deps = fakeDeps({ isOnlineFresh: async () => false, loadLease: async () => expired });
    const state = await resolveAuthState(result({ kind: "offline-transport" }), deps);
    assert.equal(deps.clearCalls, 0, "expiration is not the same as revocation — the record is left alone");
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "expired");
  });

  it("valid lease that needs its clock-rollback ratchet bumped -> persists via saveLease, not clearLease", async () => {
    const staleObserved = lease({ lastObservedDeviceTime: "2026-01-03T00:00:00.000Z" });
    const deps = fakeDeps({ isOnlineFresh: async () => false, loadLease: async () => staleObserved });
    const state = await resolveAuthState(result({ kind: "offline-transport" }), deps);
    assert.equal(state.mode, "offline-authorized");
    assert.equal(deps.clearCalls, 0);
    assert.equal(deps.saveCalls.length, 1);
    assert.equal(deps.saveCalls[0].lastObservedDeviceTime, "2026-01-06T00:00:00.000Z");
    assert.equal(
      deps.saveCalls[0].offlineAccessExpiresAt,
      staleObserved.offlineAccessExpiresAt,
      "the ratchet write must never itself extend expiresAt",
    );
  });

  it("wrong deviceInstallationId on the stored lease -> offline-locked, reason invalid", async () => {
    const deps = fakeDeps({ isOnlineFresh: async () => false, getDeviceInstallationId: async () => "a-different-device" });
    const state = await resolveAuthState(result({ kind: "offline-transport" }), deps);
    assert.equal(state.mode, "offline-locked");
    assert.equal(state.offlineLockReason, "invalid");
  });
});
