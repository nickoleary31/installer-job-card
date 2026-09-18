import { getSecureStorage } from "../native/secure-storage.ts";
import { getDeviceInstallationId } from "../native/device-installation.ts";

/**
 * ============================================================
 * PHASE 2C — 7-DAY OFFLINE ACCESS LEASE (native-only)
 * ============================================================
 *
 * PRODUCT RULE: a technician who has successfully authenticated AND been
 * confirmed authorized/active by Installer Sheetz while online may keep
 * using the installed native app without server connectivity for up to 7
 * days from the most recent successful server authorization. Every fresh
 * successful authorization refreshes the lease for another 7 days; nothing
 * else does (not opening the app, not reading local data, not a request
 * merely starting — see issueOrRefreshLease()'s one call site in
 * lib/auth/auth-state.ts).
 *
 * This is NOT a server-issued credential. It is a device-local record,
 * created only after a confirmed-successful online authorization, stored
 * in OS-backed secure storage (Android Keystore / iOS Keychain via
 * secure-storage.ts). It grants no new server-side authority — it only
 * gates local access to data ALREADY downloaded for that exact user (see
 * lib/active-projects-field-package.ts, which remains independently
 * userId-scoped and lease-unaware; the lease is only the GATE, never the
 * data source).
 *
 * TRUST LIMITATION (explicit, not hidden): because this record is created
 * locally rather than cryptographically signed by the server, a device
 * whose secure storage has itself been compromised (root/jailbreak-level
 * access) could in principle forge one. The blast radius is bounded — it
 * unlocks only that specific user's already-cached, already-authorized
 * data on that one device, self-expires in 7 days, and confers no ability
 * to fabricate new server-side records or reach other users' data. A
 * server-signed lease (asymmetric signing: server holds the private key,
 * the app embeds only a public verification key) is the correct long-term
 * hardening step before broad deployment, but building that now would mean
 * inventing new server-side key-management/signing infrastructure this
 * codebase does not currently have (no signing library, no "issue a
 * claim"-style API route exists today) — deliberately deferred rather than
 * built blindly. Revisit before broad deployment.
 *
 * CLOCK SAFETY: `lastValidatedAt`/`offlineAccessExpiresAt` are still client
 * clock readings (no server-time endpoint exists to source them from) —
 * see checkLeaseValidity()'s doc below for exactly what protection this
 * file does and does not provide against a rolled-back device clock.
 *
 * FUTURE QUARANTINE CONTRACT (design-only, not implemented in Phase 2C —
 * do not build any of the following yet): once offline submissions/photos/
 * an outbox exist, a device that reconnects and is found no-longer-
 * authorized must (1) invalidate this lease immediately, (2) lock access
 * to cached SERVER-DERIVED data (e.g. the Phase 2B field package), but
 * (3) never discard or silently auto-merge locally-created UNSYNCED
 * technician work (drafts/photos/submissions) into canonical records —
 * that work must instead become eligible for upload to a future
 * server-side INSPECTION/QUARANTINE QUEUE for an authorized reviewer to
 * accept/reject/reassign. Quarantined records should retain provenance:
 * original userId, deviceInstallationId, projectId, local submissionId,
 * createdAtLocal, lastModifiedAtLocal, leaseIssuedAt, leaseLastValidatedAt,
 * leaseExpiresAt, revocationDetectedAt, payload hashes, and sync history,
 * alongside the actual form/device/photo payload once those systems exist.
 * See docs/Mobile_Development.md for the same contract in prose form.
 */
export type OfflineAccessLease = {
  schemaVersion: number;
  userId: string;
  /** Binds this lease to one specific app installation — see device-installation.ts. */
  deviceInstallationId: string;
  /** First time THIS device/user pair ever received a lease. */
  issuedAt: string;
  /** Most recent time the server confirmed this user was still valid/active. */
  lastValidatedAt: string;
  /** lastValidatedAt + 7 days, recomputed only alongside lastValidatedAt. */
  offlineAccessExpiresAt: string;
  /**
   * The latest device-clock reading this lease has ever been checked
   * against, advanced only forward — see checkLeaseValidity()'s clock-
   * rollback discussion.
   */
  lastObservedDeviceTime: string;
  /** Display-only — never used for authorization decisions. */
  displayName: string | null;
  email: string | null;
};

const STORAGE_KEY = "installer-sheetz-offline-access-lease";
const CURRENT_SCHEMA_VERSION = 2;
export const OFFLINE_ACCESS_LEASE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure — structural validation so a corrupted/tampered record fails closed rather than granting access. */
export function isValidOfflineAccessLease(value: unknown): value is OfflineAccessLease {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === "number" &&
    typeof v.userId === "string" &&
    v.userId.length > 0 &&
    typeof v.deviceInstallationId === "string" &&
    v.deviceInstallationId.length > 0 &&
    typeof v.issuedAt === "string" &&
    typeof v.lastValidatedAt === "string" &&
    typeof v.offlineAccessExpiresAt === "string" &&
    typeof v.lastObservedDeviceTime === "string" &&
    (v.displayName === null || typeof v.displayName === "string") &&
    (v.email === null || typeof v.email === "string")
  );
}

export async function saveLease(lease: OfflineAccessLease): Promise<void> {
  await getSecureStorage().set(STORAGE_KEY, JSON.stringify(lease));
}

/** Fails closed: any missing/corrupted/unparsable record is treated as "no lease," never a partial one. */
export async function loadLease(): Promise<OfflineAccessLease | null> {
  const raw = await getSecureStorage().get(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidOfflineAccessLease(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearLease(): Promise<void> {
  await getSecureStorage().remove(STORAGE_KEY);
}

export type LeaseValidityVerdict =
  | { status: "missing" }
  | { status: "invalid"; lease: OfflineAccessLease }
  | { status: "clock-rollback"; lease: OfflineAccessLease }
  | { status: "expired"; lease: OfflineAccessLease }
  | { status: "valid"; lease: OfflineAccessLease; nextLease: OfflineAccessLease };

function parseIsoMs(value: string): number | null {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Absorbs legitimate small clock corrections (NTP sync jitter) without flagging them as rollback. */
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Pure — the temporal/identity gate a lease must pass to actually be used,
 * separate from isValidOfflineAccessLease()'s structural check (a
 * structurally valid record can still be expired, device-mismatched, or
 * clock-suspicious).
 *
 * CLOCK SAFETY, explicitly: there is no server-time source in this app, so
 * `now` is still the device's own clock. Two cheap checks are applied, not
 * a general anti-tamper system:
 *  1. `now < issuedAt` — the device clock is somehow before the moment
 *     THIS record itself was written from that same clock. Flags as
 *     "clock-rollback" (locks offline access) WITHOUT deleting the lease,
 *     so a transient bad reading self-heals once the clock corrects.
 *  2. `now < lastObservedDeviceTime - tolerance` — a ratchet: every prior
 *     valid check has advanced `lastObservedDeviceTime` forward (see the
 *     "valid" branch below), so this catches the realistic attack of
 *     letting a lease run normally for days (ratcheting the observed time
 *     up near the 7-day mark) and then rolling the clock back afterward to
 *     regain access, even without needing to reason about the exact
 *     `issuedAt` value.
 * RESIDUAL, DOCUMENTED GAP: an attacker who freezes the clock immediately
 * after issuance — before this function is ever called again while the
 * clock is allowed to advance — defeats both checks, since neither
 * `issuedAt` nor `lastObservedDeviceTime` would ever be exceeded. Closing
 * this fully requires a server-issued time source (see the server-signed
 * lease discussion above); not attempted here.
 */
export function checkLeaseValidity(
  lease: OfflineAccessLease | null,
  nowIso: string,
  currentDeviceInstallationId: string,
): LeaseValidityVerdict {
  if (!lease) return { status: "missing" };
  if (lease.deviceInstallationId !== currentDeviceInstallationId) return { status: "invalid", lease };

  const now = parseIsoMs(nowIso);
  const issuedAt = parseIsoMs(lease.issuedAt);
  const expiresAt = parseIsoMs(lease.offlineAccessExpiresAt);
  const lastObserved = parseIsoMs(lease.lastObservedDeviceTime);
  if (now === null || issuedAt === null || expiresAt === null || lastObserved === null) {
    return { status: "invalid", lease };
  }

  if (now < issuedAt) return { status: "clock-rollback", lease };
  if (now < lastObserved - CLOCK_ROLLBACK_TOLERANCE_MS) return { status: "clock-rollback", lease };
  // Exactly-at-expiry counts as expired — "before expiry" must be strict.
  if (now >= expiresAt) return { status: "expired", lease };

  const nextLease = now > lastObserved ? { ...lease, lastObservedDeviceTime: nowIso } : lease;
  return { status: "valid", lease, nextLease };
}

export type IssueLeaseDeps = {
  now: () => string;
  getDeviceInstallationId: () => Promise<string>;
  loadLease: () => Promise<OfflineAccessLease | null>;
  saveLease: (lease: OfflineAccessLease) => Promise<void>;
};

const defaultIssueLeaseDeps: IssueLeaseDeps = {
  now: () => new Date().toISOString(),
  getDeviceInstallationId,
  loadLease,
  saveLease,
};

/**
 * Called on every confirmed-successful, confirmed-active online
 * authorization (see lib/auth/auth-state.ts's "online" branch, its only
 * call site) — preserves the original `issuedAt` if this exact device was
 * already leased for the SAME user, so re-validating doesn't make a
 * long-standing lease look newly issued; always bumps `lastValidatedAt` to
 * now and recomputes `offlineAccessExpiresAt` as now + 7 days. Nothing
 * else may extend the lease — see the module doc comment.
 */
export async function issueOrRefreshLease(
  params: { userId: string; displayName: string | null; email: string | null },
  deps: IssueLeaseDeps = defaultIssueLeaseDeps,
): Promise<void> {
  const nowIso = deps.now();
  const deviceInstallationId = await deps.getDeviceInstallationId();
  const existing = await deps.loadLease();
  const issuedAt =
    existing?.userId === params.userId && existing.deviceInstallationId === deviceInstallationId
      ? existing.issuedAt
      : nowIso;
  const offlineAccessExpiresAt = new Date(Date.parse(nowIso) + OFFLINE_ACCESS_LEASE_DURATION_MS).toISOString();
  await deps.saveLease({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    userId: params.userId,
    deviceInstallationId,
    issuedAt,
    lastValidatedAt: nowIso,
    offlineAccessExpiresAt,
    lastObservedDeviceTime: nowIso,
    displayName: params.displayName,
    email: params.email,
  });
}

/**
 * Pure — small, UI-facing summary of how much offline access time remains.
 * Deliberately not part of the auth decision itself (decideAuthMode()
 * already ran by the time anything renders this) — purely descriptive text
 * for the "offline-authorized" banner. `urgent` is true once under ~24
 * hours remain, per the product spec's "a slightly stronger warning is
 * reasonable" guidance — no notifications/alarms, just different copy.
 */
export function describeLeaseExpiry(lease: OfflineAccessLease, nowIso: string): { text: string; urgent: boolean } {
  const now = parseIsoMs(nowIso);
  const expiresAt = parseIsoMs(lease.offlineAccessExpiresAt);
  if (now === null || expiresAt === null) return { text: "", urgent: false };

  const remainingMs = expiresAt - now;
  const oneHourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * oneHourMs;

  if (remainingMs <= 0) return { text: "Offline access has expired.", urgent: true };
  if (remainingMs <= oneDayMs) {
    const hours = Math.max(1, Math.round(remainingMs / oneHourMs));
    return { text: `Offline access expires in about ${hours} hour${hours === 1 ? "" : "s"}.`, urgent: true };
  }
  const days = Math.round(remainingMs / oneDayMs);
  return { text: `Offline access valid for about ${days} more day${days === 1 ? "" : "s"}.`, urgent: false };
}
