import type { User } from "@supabase/supabase-js";

import { isOnboardingComplete } from "@/lib/auth/onboarding";
import { supabase } from "@/lib/supabase/client";
import { getStarterDataSnapshot } from "@/lib/starter-data-cache";

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
    throw withOnboarding.error;
  }

  const legacy = await supabase
    .from("user_profiles")
    .select("global_role, display_name, email, is_active")
    .eq("id", userId)
    .maybeSingle<UserProfileRow>();
  if (legacy.error) throw legacy.error;
  return { profile: legacy.data, onboardingColumnAvailable: false };
}

export async function loadCurrentAuthUserContext(): Promise<AuthUserContext> {
  const user = await resolveAuthUser();
  if (!user) return emptyContext();

  try {
    const [{ profile: profileData, onboardingColumnAvailable }, { data: membershipData, error: membershipError }] =
      await Promise.all([
        loadProfileRow(user.id),
        supabase.from("company_memberships").select("company_id, role").eq("user_id", user.id).eq("is_active", true),
      ]);

    if (membershipError) throw membershipError;

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
      userId: user.id,
      displayName: profileData?.display_name?.trim() || null,
      email: profileData?.email?.trim() || user.email?.trim() || null,
      phone: profileData?.phone?.trim() || null,
      jobTitle: profileData?.job_title?.trim() || null,
      globalRole: profileData?.global_role || null,
      profileIsActive: profileData?.is_active !== false,
      onboardingCompleted,
      companyIds,
      companyRolesById,
    };
  } catch (e) {
    if (isBrowser()) {
      try {
        const snap = await getStarterDataSnapshot(user.id);
        if (snap?.userId === user.id) {
          return {
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
          };
        }
      } catch {
        // ignore IndexedDB errors
      }
    }

    if (appearsOffline()) {
      return {
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
      };
    }

    throw e;
  }
}
