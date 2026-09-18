import type { User } from "@supabase/supabase-js";

import { classifySupabaseFailure } from "@/lib/auth/classify-supabase-error";
import { isOnboardingComplete } from "@/lib/auth/onboarding";
import { supabase } from "@/lib/supabase/client";
import { getStarterDataSnapshot } from "@/lib/starter-data-cache";

/**
 * @supabase/postgrest-js's PostgrestError carries no HTTP status of its own
 * (confirmed by reading node_modules/@supabase/postgrest-js/src/PostgrestError.ts
 * — it's just {message, details, hint, code}, where `code` is a
 * PostgREST/PostgreSQL error code, not an HTTP status). The real status
 * (including 0 for a fetch that never got a response — postgrest-js's own
 * convention, matching @supabase/auth-js's AuthRetryableFetchError) is a
 * SIBLING of `error` on the query result, not nested inside it. This
 * wrapper carries that status alongside the original error so
 * classifySupabaseFailure() can classify PostgREST failures the same way
 * it classifies Auth-JS ones.
 */
class PostgrestStatusError extends Error {
  status: number;
  constructor(status: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PostgrestStatusError";
    this.status = status;
  }
}

type UserProfileRow = {
  global_role: "admin" | "technician" | null;
  display_name: string | null;
  email: string | null;
  is_active: boolean | null;
  phone?: string | null;
  job_title?: string | null;
  onboarding_completed_at?: string | null;
};

type CompanyMembershipRow = {
  company_id: string;
  role: "admin" | "technician";
};

export type AuthUserContext = {
  userId: string | null;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  globalRole: "admin" | "technician" | null;
  /** Profile active flag; false means the account is deactivated. */
  profileIsActive: boolean;
  /**
   * True when invite/password onboarding finished.
   * When the onboarding column is missing (migration not applied), treated as true so existing installs keep working.
   */
  onboardingCompleted: boolean;
  companyIds: string[];
  companyRolesById: Record<string, "admin" | "technician">;
};

const emptyContext = (): AuthUserContext => ({
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
});

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function appearsOffline(): boolean {
  return isBrowser() && !navigator.onLine;
}

function isMissingOnboardingColumnError(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message || "").toLowerCase();
  return (
    message.includes("onboarding_completed_at") ||
    message.includes("job_title") ||
    message.includes("phone")
  );
}

/**
 * Prefer server-validated user when online; use persisted session locally when offline so guards can still match IndexedDB starter snapshots.
 * Uses Supabase's built-in session storage only — no extra token caching.
 */
async function resolveAuthUser(): Promise<User | null> {
  if (appearsOffline()) {
    const { data: sessionData } = await supabase.auth.getSession();
    const fromSession = sessionData.session?.user ?? null;
    if (fromSession) return fromSession;
    const { data: getUserData } = await supabase.auth.getUser();
    return getUserData.user ?? null;
  }

  const { data: getUserData, error: getUserError } = await supabase.auth.getUser();
  if (!getUserError && getUserData.user) return getUserData.user;

  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.user ?? null;
}

async function loadProfileRow(userId: string): Promise<{
  profile: UserProfileRow | null;
  onboardingColumnAvailable: boolean;
}> {
  const withOnboarding = await supabase
    .from("user_profiles")
    .select("global_role, display_name, email, is_active, phone, job_title, onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle<UserProfileRow>();

  if (!withOnboarding.error) {
    return { profile: withOnboarding.data, onboardingColumnAvailable: true };
  }

  if (!isMissingOnboardingColumnError(withOnboarding.error)) {
    throw new PostgrestStatusError(withOnboarding.status, withOnboarding.error);
  }

  const legacy = await supabase
    .from("user_profiles")
    .select("global_role, display_name, email, is_active")
    .eq("id", userId)
    .maybeSingle<UserProfileRow>();
  if (legacy.error) throw new PostgrestStatusError(legacy.status, legacy.error);
  return { profile: legacy.data, onboardingColumnAvailable: false };
}

/**
 * Phase 2C — why a context was returned, not just what it contains. Layered
 * on top of the existing logic below without changing any of its actual
 * context-computation behavior, so every existing caller of
 * loadCurrentAuthUserContext() (LoginScreen, accept-invite) keeps seeing the
 * exact same context shape/values as before. lib/auth/auth-state.ts is the
 * one caller that acts on `source` — deciding whether to issue/refresh or
 * invalidate the Phase 2C offline access lease.
 *
 * Five explicit categories rather than one online/offline boolean, matching
 * classify-supabase-error.ts's SupabaseFailureCategory:
 *  - "online": confirmed, successful, active-user authorization.
 *  - "denied": explicit revocation/denial evidence — safe to clear
 *    provisioning over.
 *  - "unavailable": the server responded but reported its OWN temporary
 *    trouble (5xx/429/infra codes) — never a denial.
 *  - "offline-transport": no response came back at all — a genuine
 *    connectivity failure, also never a denial.
 *  - "unknown": no positive evidence either way — must fail closed
 *    (lib/auth/auth-state.ts never clears provisioning for this, and only
 *    uses it to grant offline access when independently confirmed offline).
 *  - "signed-out": no local session was even found to check.
 */
export type AuthUserContextSource =
  | { kind: "online" }
  | { kind: "unavailable" }
  | { kind: "offline-transport" }
  | { kind: "unknown" }
  | { kind: "denied"; reason: "invalid-session" | "inactive-user" }
  | { kind: "signed-out" };

export type AuthUserContextResult = {
  source: AuthUserContextSource;
  context: AuthUserContext;
};

export async function resolveAuthUserContext(): Promise<AuthUserContextResult> {
  const user = await resolveAuthUser();
  if (!user) return { source: { kind: "signed-out" }, context: emptyContext() };

  try {
    const [
      { profile: profileData, onboardingColumnAvailable },
      { data: membershipData, error: membershipError, status: membershipStatus },
    ] = await Promise.all([
      loadProfileRow(user.id),
      supabase.from("company_memberships").select("company_id, role").eq("user_id", user.id).eq("is_active", true),
    ]);

    if (membershipError) throw new PostgrestStatusError(membershipStatus, membershipError);

    // A successful, confirmed-online profile fetch that explicitly says
    // inactive is a real, confirmed denial — never "just offline" — even
    // though the request itself succeeded.
    if (profileData?.is_active === false) {
      return { source: { kind: "denied", reason: "inactive-user" }, context: emptyContext() };
    }

    const memberships = (membershipData as CompanyMembershipRow[] | null) || [];
    const companyIds = memberships.map((row) => row.company_id);
    const companyRolesById = memberships.reduce<Record<string, "admin" | "technician">>((acc, row) => {
      acc[row.company_id] = row.role;
      return acc;
    }, {});

    const onboardingCompleted = onboardingColumnAvailable
      ? isOnboardingComplete(profileData?.onboarding_completed_at)
      : true;

    return {
      source: { kind: "online" },
      context: {
        userId: user.id,
        displayName: profileData?.display_name?.trim() || null,
        email: profileData?.email?.trim() || user.email?.trim() || null,
        phone: profileData?.phone?.trim() || null,
        jobTitle: profileData?.job_title?.trim() || null,
        globalRole: profileData?.global_role || null,
        // The is_active === false case already returned above as an explicit denial.
        profileIsActive: true,
        onboardingCompleted,
        companyIds,
        companyRolesById,
      },
    };
  } catch (e) {
    // Classify BEFORE ever considering a cached fallback: an explicit
    // denial must win outright, never softened by falling back to stale
    // starter-data-cache content just because some was available.
    const category = classifySupabaseFailure(e);

    if (category === "denied") {
      return { source: { kind: "denied", reason: "invalid-session" }, context: emptyContext() };
    }

    // category is "unavailable" | "offline-transport" | "unknown" here —
    // never a confirmed denial, so a cached fallback is safe to consider
    // for all three. lib/auth/auth-state.ts is what decides whether
    // "unknown" is actually ALLOWED to unlock offline access (only when
    // independently confirmed offline) — this function's job is only to
    // report what happened and surface whatever data is available.
    if (isBrowser()) {
      try {
        const snap = await getStarterDataSnapshot(user.id);
        if (snap?.userId === user.id) {
          return {
            source: { kind: category },
            context: {
              userId: user.id,
              displayName: snap.profile.displayName?.trim() || null,
              email: snap.profile.email?.trim() || user.email?.trim() || null,
              phone: snap.profile.phone?.trim() || null,
              jobTitle: snap.profile.jobTitle?.trim() || null,
              globalRole: snap.profile.globalRole,
              profileIsActive: snap.profile.profileIsActive !== false,
              onboardingCompleted: snap.profile.onboardingCompleted !== false,
              companyIds: [...snap.profile.companyIds],
              companyRolesById: { ...snap.profile.companyRolesById },
            },
          };
        }
      } catch {
        // ignore IndexedDB errors
      }
    }

    if (category === "unavailable" || category === "offline-transport") {
      return {
        source: { kind: category },
        context: {
          userId: user.id,
          displayName: null,
          email: user.email?.trim() || null,
          phone: null,
          jobTitle: null,
          globalRole: null,
          profileIsActive: false,
          onboardingCompleted: true,
          companyIds: [],
          companyRolesById: {},
        },
      };
    }

    // "unknown" with no cached data to fall back on — fail closed with an
    // empty context rather than synthesizing a partial one.
    return { source: { kind: "unknown" }, context: emptyContext() };
  }
}

/** Thin, behavior-preserving wrapper — unchanged external contract for existing callers. */
export async function loadCurrentAuthUserContext(): Promise<AuthUserContext> {
  const result = await resolveAuthUserContext();
  return result.context;
}
