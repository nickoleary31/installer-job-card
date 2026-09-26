/**
 * POST /api/company-users/search. Lets a company's user managers find
 * existing Installer Sheetz users, to add them to THAT company.
 *
 * Contract (product decision Q7): a global admin or an active company admin
 * may search the whole internal user directory by name, email or exact user
 * id. Each result carries minimal identity (id, email, display name, whether
 * the profile is active) plus membership state IN THE SEARCHING COMPANY ONLY.
 * Memberships in any other company are never read, let alone returned.
 * Previously the route joined every membership of every matched user,
 * including other companies' names and roles.
 *
 * The response shape is unchanged for existing clients:
 * `companyMemberships` is kept, but now holds at most the one
 * searching-company entry; `targetCompanyMembership` is as before.
 * Inactive profiles are returned and flagged profileIsActive: false (the
 * add-user UI shows "profile inactive"). Such a user can't use any access
 * until reactivated, because every access check refuses inactive profiles.
 *
 * Pure given `deps` (unit-tested in company-user-routes.test.ts). The route
 * wires the real deps with the service-role client, and only after
 * authorizeCompanyUserManager has succeeded (fail closed without the key).
 */

export type CompanyUserSearchProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean | null;
};

export type CompanyUserSearchMembership = {
  user_id: string;
  company_id: string;
  role: "admin" | "technician";
  is_active: boolean;
};

export type CompanyUserSearchAuth = { ok: true; requesterUserId: string } | { ok: false; status: number; error: string };

export interface CompanyUserSearchDeps {
  authorize(args: { accessToken: string; companyId: string }): Promise<CompanyUserSearchAuth>;
  searchProfiles(args: { pattern: string; exactUserId: string | null; limit: number }): Promise<{ profiles: CompanyUserSearchProfile[]; error: string | null }>;
  /** Must return ONLY rows of `companyId` for the given users. */
  loadCompanyMemberships(companyId: string, userIds: string[]): Promise<{ memberships: CompanyUserSearchMembership[]; error: string | null }>;
  loadCompanyName(companyId: string): Promise<{ name: string | null; error: string | null }>;
}

export type CompanyUserSearchResult = { status: number; body: Record<string, unknown> };

export const SEARCH_RESULT_LIMIT = 25;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleCompanyUserSearch(
  input: { accessToken: string; companyId: string; query: string },
  deps: CompanyUserSearchDeps,
): Promise<CompanyUserSearchResult> {
  const companyId = input.companyId.trim();
  const query = input.query.trim();
  if (query.length < 2) {
    return { status: 400, body: { error: "Enter at least 2 characters to search." } };
  }

  const auth = await deps.authorize({ accessToken: input.accessToken, companyId });
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  const { profiles, error: searchError } = await deps.searchProfiles({
    pattern: `%${query}%`,
    exactUserId: UUID_RE.test(query) ? query : null,
    limit: SEARCH_RESULT_LIMIT,
  });
  if (searchError) {
    return { status: 500, body: { error: searchError } };
  }

  const sorted = [...new Map(profiles.map((p) => [p.id, p])).values()]
    .sort((a, b) => {
      const an = (a.display_name || a.email || a.id).toLowerCase();
      const bn = (b.display_name || b.email || b.id).toLowerCase();
      return an.localeCompare(bn);
    })
    .slice(0, SEARCH_RESULT_LIMIT);
  if (sorted.length === 0) {
    return { status: 200, body: { results: [] } };
  }

  const { memberships, error: membershipError } = await deps.loadCompanyMemberships(
    companyId,
    sorted.map((p) => p.id),
  );
  if (membershipError) {
    return { status: 500, body: { error: membershipError } };
  }
  const { name: companyNameRaw } = await deps.loadCompanyName(companyId);
  const companyName = companyNameRaw?.trim() || companyId.slice(0, 8);

  // Defense in depth: even if a dependency returned extra rows, only the
  // searching company's membership can ever reach the response.
  const membershipByUser = new Map<string, CompanyUserSearchMembership>();
  for (const row of memberships) {
    if (row.company_id === companyId) membershipByUser.set(row.user_id, row);
  }

  const results = sorted.map((profile) => {
    const membership = membershipByUser.get(profile.id) || null;
    return {
      userId: profile.id,
      email: profile.email?.trim() || "",
      displayName: profile.display_name?.trim() || profile.email?.trim() || `User ${profile.id.slice(0, 8)}`,
      profileIsActive: profile.is_active !== false,
      companyMemberships: membership
        ? [{ companyId, companyName, role: membership.role, isActive: membership.is_active }]
        : [],
      targetCompanyMembership: membership ? { role: membership.role, isActive: membership.is_active } : null,
    };
  });

  return { status: 200, body: { results } };
}
