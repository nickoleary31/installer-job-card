/**
 * Pure decision logic for which projects appear on the cross-company Active
 * Projects list (components/ActiveProjectsScreen.tsx). Extracted specifically
 * so the access matrix is unit-testable without mocking Supabase/React.
 *
 * Reproduces — does not tighten — the existing company-scoped
 * ProjectsListScreen's access rules (app/companies/[companyId]/projects/page.tsx),
 * generalized across every company the user can reach:
 *
 *   - global admin: every active project in every company.
 *   - company admin (per company_memberships.role): every active project in
 *     that company.
 *   - technician: filtered to project_assignments, UNLESS they have zero
 *     active assignment rows IN THAT SPECIFIC COMPANY, in which case every
 *     active project in that company is shown. Evaluated per company, not
 *     globally — a technician with assignments in Company A and none in
 *     Company B still sees all of Company B's projects, not zero. That
 *     fallback is current COMPATIBILITY behavior, not a design choice made
 *     here: Zoho Service Resource -> project_assignments synchronization
 *     doesn't exist yet, so most technicians currently have no assignment
 *     rows at all. Revisit removing it once that sync is real.
 *   - no recognized company_memberships role at all (company not in
 *     companyRolesById): never visible, even though the original
 *     single-company screen's own undefined-role fallthrough is more
 *     permissive. Safe to differ here without "tightening" that page (which
 *     is untouched) because companyRolesById and the accessible-company set
 *     passed into this function are always built from the same
 *     company_memberships query in lib/auth/userContext.ts, so this branch
 *     is unreachable in real usage — it only exists to keep this function
 *     safe by construction for a screen that aggregates many companies at
 *     once, rather than relying on callers to scope correctly.
 */

export type AccessProjectRow = {
  id: string;
  companyId: string;
  active: boolean;
};

export type CompanyRole = "admin" | "technician" | undefined;

export type VisibilityContext = {
  isGlobalAdmin: boolean;
  companyRolesById: Record<string, CompanyRole>;
  /** Every project id the user has an active project_assignments row for, across ALL companies. */
  assignedProjectIds: readonly string[];
};

export function filterVisibleActiveProjects<T extends AccessProjectRow>(
  projects: readonly T[],
  context: VisibilityContext,
): T[] {
  const activeProjects = projects.filter((p) => p.active);
  if (context.isGlobalAdmin) return activeProjects;

  const assignedSet = new Set(context.assignedProjectIds);
  const companiesWithAssignments = new Set(
    activeProjects.filter((p) => assignedSet.has(p.id)).map((p) => p.companyId),
  );

  return activeProjects.filter((project) => {
    const role = context.companyRolesById[project.companyId];
    if (role === "admin") return true;
    if (role === "technician") {
      if (!companiesWithAssignments.has(project.companyId)) return true; // per-company compatibility fallback
      return assignedSet.has(project.id);
    }
    return false;
  });
}
