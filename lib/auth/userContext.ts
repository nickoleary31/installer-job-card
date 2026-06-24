import type { User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";
import { getStarterDataSnapshot } from "@/lib/starter-data-cache";

type UserProfileRow = {
  global_role: "admin" | "technician" | null;
  display_name: string | null;
  email: string | null;
};

type CompanyMembershipRow = {
  company_id: string;
  role: "admin" | "technician";
};

export type AuthUserContext = {
  userId: string | null;
  displayName: string | null;
  email: string | null;
  globalRole: "admin" | "technician" | null;
  companyIds: string[];
  companyRolesById: Record<string, "admin" | "technician">;
};

const emptyContext = (): AuthUserContext => ({
  userId: null,
  displayName: null,
  email: null,
  globalRole: null,
  companyIds: [],
  companyRolesById: {},
});

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function appearsOffline(): boolean {
  return isBrowser() && !navigator.onLine;
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

export async function loadCurrentAuthUserContext(): Promise<AuthUserContext> {
  const user = await resolveAuthUser();
  if (!user) return emptyContext();

  try {
    const [{ data: profileData, error: profileError }, { data: membershipData, error: membershipError }] = await Promise.all([
      supabase.from("user_profiles").select("global_role, display_name, email").eq("id", user.id).maybeSingle<UserProfileRow>(),
      supabase.from("company_memberships").select("company_id, role").eq("user_id", user.id).eq("is_active", true),
    ]);

    if (profileError) throw profileError;
    if (membershipError) throw membershipError;

    const memberships = (membershipData as CompanyMembershipRow[] | null) || [];
    const companyIds = memberships.map((row) => row.company_id);
    const companyRolesById = memberships.reduce<Record<string, "admin" | "technician">>((acc, row) => {
      acc[row.company_id] = row.role;
      return acc;
    }, {});
    return {
      userId: user.id,
      displayName: profileData?.display_name?.trim() || null,
      email: profileData?.email?.trim() || user.email?.trim() || null,
      globalRole: profileData?.global_role || null,
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
            globalRole: snap.profile.globalRole,
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
        globalRole: null,
        companyIds: [],
        companyRolesById: {},
      };
    }

    throw e;
  }
}

