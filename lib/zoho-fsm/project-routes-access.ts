import type { ProjectAccessRole } from "../project-access.ts";
import { UNLINKED_PROJECT_INFO, type ZohoProjectInfoViewModel } from "./project-info.ts";
import type { ZohoProjectProgress } from "./project-progress.ts";

/**
 * Checkpoint 2 — authorization for the two client-facing Zoho read routes,
 * as injectable-dependency handlers (same shape as
 * lib/job-card-submissions/finalize.ts) so the gate is unit-testable
 * adversarially — see project-routes-access.test.ts.
 *
 * Before this, both routes only verified that the caller had SOME signed-in
 * session: any authenticated user could read any project's Zoho WO#/SA#/
 * summary, and any company's per-project asset counts, by supplying an id.
 * Both now go through the shared Installer Sheetz access model
 * (lib/project-access.ts): the same global-admin / active-company-admin /
 * assigned-technician rules every other project-scoped route uses.
 *
 * project-info takes only a projectId, so the company is derived
 * SERVER-SIDE from the project row and then authorized — the client never
 * gets to name the company. project-progress is company-scoped; a
 * technician gets only the projects they are actively assigned to.
 */

export type ProjectAuthResult =
  | { ok: true; requesterUserId: string; role: ProjectAccessRole }
  | { ok: false; status: number; error: string };

export type ProjectInfoDeps = {
  /** The project's own company, from the projects table — never from the request. */
  loadProjectCompany(projectId: string): Promise<{ companyId: string | null; error?: boolean }>;
  authorizeProject(args: { accessToken: string; companyId: string; projectId: string }): Promise<ProjectAuthResult>;
  fetchInfo(projectId: string): Promise<ZohoProjectInfoViewModel>;
};

export type RouteResult = { status: number; body: unknown };

export async function handleProjectInfoRequest(
  input: { accessToken: string; projectId: string },
  deps: ProjectInfoDeps,
): Promise<RouteResult> {
  if (!input.accessToken) {
    return { status: 401, body: { error: "Missing authorization token." } };
  }
  const projectId = input.projectId.trim();
  if (!projectId) {
    return { status: 400, body: { error: "projectId is required." } };
  }

  const { companyId, error } = await deps.loadProjectCompany(projectId);
  if (error) {
    return { status: 403, body: { error: "Failed to validate the requested project." } };
  }
  if (!companyId) {
    return { status: 404, body: { error: "Project not found." } };
  }

  const auth = await deps.authorizeProject({ accessToken: input.accessToken, companyId, projectId });
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  try {
    return { status: 200, body: await deps.fetchInfo(projectId) };
  } catch (fetchError) {
    console.error("[zoho-fsm] project-info lookup failed", fetchError instanceof Error ? fetchError.message : fetchError);
    return { status: 200, body: UNLINKED_PROJECT_INFO };
  }
}

export type ProjectProgressDeps = {
  authorizeCompany(args: { accessToken: string; companyId: string }): Promise<ProjectAuthResult>;
  fetchProgress(companyId: string): Promise<Record<string, ZohoProjectProgress>>;
  /** Every project id this user has an ACTIVE project_assignments row for. */
  listActiveAssignedProjectIds(userId: string): Promise<string[]>;
};

/** Pure — a technician only ever sees the projects they are actively assigned to; admins see the company. */
export function scopeProgressToRole(
  byProjectId: Record<string, ZohoProjectProgress>,
  role: ProjectAccessRole,
  assignedProjectIds: readonly string[],
): Record<string, ZohoProjectProgress> {
  if (role !== "technician") return byProjectId;
  const allowed = new Set(assignedProjectIds);
  const scoped: Record<string, ZohoProjectProgress> = {};
  for (const [projectId, progress] of Object.entries(byProjectId)) {
    if (allowed.has(projectId)) scoped[projectId] = progress;
  }
  return scoped;
}

export async function handleProjectProgressRequest(
  input: { accessToken: string; companyId: string },
  deps: ProjectProgressDeps,
): Promise<RouteResult> {
  if (!input.accessToken) {
    return { status: 401, body: { error: "Missing authorization token." } };
  }
  const companyId = input.companyId.trim();
  if (!companyId) {
    return { status: 400, body: { error: "companyId is required." } };
  }

  const auth = await deps.authorizeCompany({ accessToken: input.accessToken, companyId });
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  try {
    const byProjectId = await deps.fetchProgress(companyId);
    const assigned = auth.role === "technician" ? await deps.listActiveAssignedProjectIds(auth.requesterUserId) : [];
    return { status: 200, body: scopeProgressToRole(byProjectId, auth.role, assigned) };
  } catch (fetchError) {
    console.error("[zoho-fsm] project-progress lookup failed", fetchError instanceof Error ? fetchError.message : fetchError);
    return { status: 200, body: {} };
  }
}
