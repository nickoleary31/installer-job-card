import { supabase } from "@/lib/supabase/client";

type UserProfileRow = {
  global_role: "admin" | "technician" | null;
};

type CompanyMembershipRow = {
  company_id: string;
  role: "admin" | "technician";
};

export type AuthUserContext = {
  userId: string | null;
  globalRole: "admin" | "technician" | null;
  companyIds: string[];
  companyRolesById: Record<string, "admin" | "technician">;
};

export async function loadCurrentAuthUserContext(): Promise<AuthUserContext> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      userId: null,
      globalRole: null,
      companyIds: [],
      companyRolesById: {},
    };
  }

  const [{ data: profileData, error: profileError }, { data: membershipData, error: membershipError }] = await Promise.all([
    supabase.from("user_profiles").select("global_role").eq("id", user.id).maybeSingle<UserProfileRow>(),
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
    globalRole: profileData?.global_role || null,
    companyIds,
    companyRolesById,
  };
}

