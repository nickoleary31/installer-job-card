import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFLINE_ACCESS_LEASE_DURATION_MS,
  checkLeaseValidity,
  describeLeaseExpiry,
  isValidOfflineAccessLease,
  issueOrRefreshLease,
  type IssueLeaseDeps,
  type OfflineAccessLease,
} from "./offline-access-lease.ts";

const DEVICE_A = "device-aaaa-1111";
const DEVICE_B = "device-bbbb-2222";

function validLease(overrides: Partial<OfflineAccessLease> = {}): OfflineAccessLease {
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

describe("isValidOfflineAccessLease (fail-closed structural validation)", () => {
  it("accepts a well-formed record", () => {
    assert.equal(isValidOfflineAccessLease(validLease()), true);
  });

  it("accepts null displayName/email", () => {
    assert.equal(isValidOfflineAccessLease({ ...validLease(), displayName: null, email: null }), true);
  });

  it("rejects a missing deviceInstallationId", () => {
    const { deviceInstallationId: _d, ...rest } = validLease();
    assert.equal(isValidOfflineAccessLease(rest), false);
  });

  it("rejects an empty-string deviceInstallationId", () => {
    assert.equal(isValidOfflineAccessLease({ ...validLease(), deviceInstallationId: "" }), false);
  });

  it("rejects a missing userId", () => {
    const { userId: _u, ...rest } = validLease();
    assert.equal(isValidOfflineAccessLease(rest), false);
  });

  it("rejects a missing offlineAccessExpiresAt/lastObservedDeviceTime", () => {
    const { offlineAccessExpiresAt: _e, ...rest } = validLease();
    assert.equal(isValidOfflineAccessLease(rest), false);
    const { lastObservedDeviceTime: _o, ...rest2 } = validLease();
    assert.equal(isValidOfflineAccessLease(rest2), false);
  });

  it("rejects a non-numeric schemaVersion", () => {
    assert.equal(isValidOfflineAccessLease({ ...validLease(), schemaVersion: "2" }), false);
  });

  it("rejects non-object / primitive / null input — a corrupted record fails closed, never partially trusted", () => {
    assert.equal(isValidOfflineAccessLease(null), false);
    assert.equal(isValidOfflineAccessLease(undefined), false);
    assert.equal(isValidOfflineAccessLease("not an object"), false);
    assert.equal(isValidOfflineAccessLease(42), false);
    assert.equal(isValidOfflineAccessLease([]), false);
    assert.equal(isValidOfflineAccessLease({}), false);
  });
});

describe("checkLeaseValidity (pure temporal + identity gate)", () => {
  it("missing lease -> missing", () => {
    const verdict = checkLeaseValidity(null, "2026-01-06T00:00:00.000Z", DEVICE_A);
    assert.equal(verdict.status, "missing");
  });

  it("well within the 7-day window -> valid, and ratchets lastObservedDeviceTime forward", () => {
    const lease = validLease();
    const verdict = checkLeaseValidity(lease, "2026-01-06T00:00:00.000Z", DEVICE_A);
    assert.equal(verdict.status, "valid");
    if (verdict.status !== "valid") return;
    assert.equal(verdict.nextLease.lastObservedDeviceTime, "2026-01-06T00:00:00.000Z");
    assert.notEqual(verdict.nextLease, verdict.lease);
  });

  it("does not needlessly rewrite the record when nowIso exactly equals lastObservedDeviceTime", () => {
    const lease = validLease({ lastObservedDeviceTime: "2026-01-06T00:00:00.000Z" });
    const verdict = checkLeaseValidity(lease, "2026-01-06T00:00:00.000Z", DEVICE_A);
    assert.equal(verdict.status, "valid");
    if (verdict.status !== "valid") return;
    assert.equal(verdict.nextLease, verdict.lease, "identical reference — no pointless write");
  });

  it("exactly at expiration boundary -> expired (before expiry must be strict)", () => {
    const lease = validLease({ offlineAccessExpiresAt: "2026-01-12T00:00:00.000Z" });
    assert.equal(checkLeaseValidity(lease, "2026-01-12T00:00:00.000Z", DEVICE_A).status, "expired");
    assert.equal(checkLeaseValidity(lease, "2026-01-11T23:59:59.999Z", DEVICE_A).status, "valid");
  });

  it("after expiration -> expired", () => {
    const lease = validLease();
    assert.equal(checkLeaseValidity(lease, "2026-01-13T00:00:00.000Z", DEVICE_A).status, "expired");
  });

  it("wrong deviceInstallationId -> invalid (never trust a lease bound to a different installation)", () => {
    const lease = validLease({ deviceInstallationId: DEVICE_A });
    assert.equal(checkLeaseValidity(lease, "2026-01-06T00:00:00.000Z", DEVICE_B).status, "invalid");
  });

  it("malformed issuedAt timestamp -> invalid, fails closed rather than throwing", () => {
    const lease = validLease({ issuedAt: "not-a-date" });
    assert.equal(checkLeaseValidity(lease, "2026-01-06T00:00:00.000Z", DEVICE_A).status, "invalid");
  });

  it("malformed offlineAccessExpiresAt timestamp -> invalid", () => {
    const lease = validLease({ offlineAccessExpiresAt: "not-a-date" });
    assert.equal(checkLeaseValidity(lease, "2026-01-06T00:00:00.000Z", DEVICE_A).status, "invalid");
  });

  it("device clock before issuedAt -> clock-rollback, treated as suspicious", () => {
    const lease = validLease({ issuedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(checkLeaseValidity(lease, "2025-12-31T00:00:00.000Z", DEVICE_A).status, "clock-rollback");
  });

  it("device clock rolled back past lastObservedDeviceTime (beyond tolerance) -> clock-rollback", () => {
    // Simulates: the lease ran normally for days (ratcheting lastObservedDeviceTime up),
    // then the clock was rolled back afterward to try to regain access.
    const lease = validLease({ lastObservedDeviceTime: "2026-01-10T00:00:00.000Z" });
    assert.equal(checkLeaseValidity(lease, "2026-01-08T00:00:00.000Z", DEVICE_A).status, "clock-rollback");
  });

  it("a small backward jump within tolerance (NTP jitter) is NOT treated as rollback", () => {
    const lease = validLease({ lastObservedDeviceTime: "2026-01-06T00:03:00.000Z" });
    const verdict = checkLeaseValidity(lease, "2026-01-06T00:00:00.000Z", DEVICE_A);
    assert.equal(verdict.status, "valid");
  });
});

describe("issueOrRefreshLease (impure — actual issuance/refresh behavior)", () => {
  function fakeDeps(overrides: Partial<IssueLeaseDeps> = {}): IssueLeaseDeps & { saved: OfflineAccessLease[] } {
    const savedBox: OfflineAccessLease[] = [];
    return {
      now: () => "2026-01-06T00:00:00.000Z",
      getDeviceInstallationId: async () => DEVICE_A,
      loadLease: async () => null,
      saveLease: async (lease) => {
        savedBox.push(lease);
      },
      ...overrides,
      get saved() {
        return savedBox;
      },
    } as IssueLeaseDeps & { saved: OfflineAccessLease[] };
  }

  it("first-ever issuance: issuedAt === now, expiresAt === now + 7 days", async () => {
    const deps = fakeDeps();
    await issueOrRefreshLease({ userId: "user-1", displayName: "Jane", email: "jane@example.com" }, deps);
    assert.equal(deps.saved.length, 1);
    const lease = deps.saved[0];
    assert.equal(lease.issuedAt, "2026-01-06T00:00:00.000Z");
    assert.equal(lease.lastValidatedAt, "2026-01-06T00:00:00.000Z");
    assert.equal(Date.parse(lease.offlineAccessExpiresAt) - Date.parse(lease.issuedAt), OFFLINE_ACCESS_LEASE_DURATION_MS);
    assert.equal(lease.deviceInstallationId, DEVICE_A);
  });

  it("refresh for the SAME user+installation preserves the original issuedAt", async () => {
    const existing = validLease({ userId: "user-1", deviceInstallationId: DEVICE_A, issuedAt: "2026-01-01T00:00:00.000Z" });
    const deps = fakeDeps({ loadLease: async () => existing });
    await issueOrRefreshLease({ userId: "user-1", displayName: "Jane", email: "jane@example.com" }, deps);
    const lease = deps.saved[0];
    assert.equal(lease.issuedAt, "2026-01-01T00:00:00.000Z", "issuedAt preserved, not reset to now");
    assert.equal(lease.lastValidatedAt, "2026-01-06T00:00:00.000Z", "lastValidatedAt always bumped");
  });

  it("a DIFFERENT user on the same installation gets a fresh issuedAt, never inheriting the old one", async () => {
    const existing = validLease({ userId: "previous-user", deviceInstallationId: DEVICE_A, issuedAt: "2026-01-01T00:00:00.000Z" });
    const deps = fakeDeps({ loadLease: async () => existing });
    await issueOrRefreshLease({ userId: "new-user", displayName: "New Tech", email: "new@example.com" }, deps);
    const lease = deps.saved[0];
    assert.equal(lease.userId, "new-user");
    assert.equal(lease.issuedAt, "2026-01-06T00:00:00.000Z");
  });

  it("the same user on a DIFFERENT installation also gets a fresh issuedAt", async () => {
    const existing = validLease({ userId: "user-1", deviceInstallationId: DEVICE_B, issuedAt: "2026-01-01T00:00:00.000Z" });
    const deps = fakeDeps({ loadLease: async () => existing, getDeviceInstallationId: async () => DEVICE_A });
    await issueOrRefreshLease({ userId: "user-1", displayName: "Jane", email: "jane@example.com" }, deps);
    const lease = deps.saved[0];
    assert.equal(lease.issuedAt, "2026-01-06T00:00:00.000Z");
    assert.equal(lease.deviceInstallationId, DEVICE_A);
  });
});

describe("describeLeaseExpiry (pure UI text)", () => {
  it("several days remaining -> plain day-count copy, not urgent", () => {
    const lease = validLease({ offlineAccessExpiresAt: "2026-01-10T00:00:00.000Z" });
    const result = describeLeaseExpiry(lease, "2026-01-06T00:00:00.000Z");
    assert.match(result.text, /day/);
    assert.equal(result.urgent, false);
  });

  it("under 24 hours remaining -> hour-count copy, urgent", () => {
    const lease = validLease({ offlineAccessExpiresAt: "2026-01-06T10:00:00.000Z" });
    const result = describeLeaseExpiry(lease, "2026-01-06T00:00:00.000Z");
    assert.match(result.text, /hour/);
    assert.equal(result.urgent, true);
  });

  it("already expired -> explicit expired copy, urgent", () => {
    const lease = validLease({ offlineAccessExpiresAt: "2026-01-05T00:00:00.000Z" });
    const result = describeLeaseExpiry(lease, "2026-01-06T00:00:00.000Z");
    assert.match(result.text, /expired/i);
    assert.equal(result.urgent, true);
  });
});
