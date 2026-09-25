import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleProjectInfoRequest,
  handleProjectProgressRequest,
  scopeProgressToRole,
  type ProjectAuthResult,
  type ProjectInfoDeps,
  type ProjectProgressDeps,
} from "./project-routes-access.ts";
import { UNLINKED_PROJECT_INFO } from "./project-info.ts";

const INFO = { linked: true, workOrderNumber: "WO-1", serviceAppointmentNumber: "SA-1", summary: "Install 6 units" };

/** An in-memory world: who may access which project/company, mirroring decideProjectAccess's outcomes. */
function infoDeps(overrides: Partial<ProjectInfoDeps> = {}) {
  const calls: string[] = [];
  const deps: ProjectInfoDeps & { calls: string[] } = {
    calls,
    async loadProjectCompany(projectId) {
      calls.push(`loadProjectCompany:${projectId}`);
      const companies: Record<string, string> = { "project-A1": "company-A", "project-B1": "company-B" };
      return { companyId: companies[projectId] ?? null };
    },
    async authorizeProject({ accessToken, companyId, projectId }): Promise<ProjectAuthResult> {
      calls.push(`authorize:${accessToken}:${companyId}:${projectId}`);
      if (accessToken === "tok-tech-A" && companyId === "company-A" && projectId === "project-A1") return { ok: true, requesterUserId: "user-tech-A", role: "technician" };
      if (accessToken === "tok-global") return { ok: true, requesterUserId: "user-global", role: "global-admin" };
      return { ok: false, status: 403, error: "Only global admins, active company admins, or technicians assigned to this project can access it." };
    },
    async fetchInfo(projectId) {
      calls.push(`fetchInfo:${projectId}`);
      return INFO;
    },
    ...overrides,
  };
  return deps;
}

describe("handleProjectInfoRequest — O/Q: per-project Zoho info", () => {
  it("Q: an assigned technician gets their project's info", async () => {
    const deps = infoDeps();
    const result = await handleProjectInfoRequest({ accessToken: "tok-tech-A", projectId: "project-A1" }, deps);
    assert.deepEqual(result, { status: 200, body: INFO });
  });

  it("Q: a global admin gets any project's info", async () => {
    const result = await handleProjectInfoRequest({ accessToken: "tok-global", projectId: "project-B1" }, infoDeps());
    assert.equal(result.status, 200);
  });

  it("O: a technician from company A cannot read company B's project — the company is derived from the project row, then authorization denies, and Zoho data is never fetched", async () => {
    const deps = infoDeps();
    const result = await handleProjectInfoRequest({ accessToken: "tok-tech-A", projectId: "project-B1" }, deps);
    assert.equal(result.status, 403);
    assert.ok(deps.calls.includes("authorize:tok-tech-A:company-B:project-B1"), "authorized against the project's OWN company");
    assert.ok(!deps.calls.some((c) => c.startsWith("fetchInfo")), "no Zoho data is read on denial");
  });

  it("O: a technician cannot read another project in their own company they are not assigned to", async () => {
    const deps = infoDeps({
      async loadProjectCompany() {
        return { companyId: "company-A" };
      },
    });
    const result = await handleProjectInfoRequest({ accessToken: "tok-tech-A", projectId: "project-A2" }, deps);
    assert.equal(result.status, 403);
  });

  it("no token -> 401 before any read; missing projectId -> 400; unknown project -> 404; a failed project read -> 403 (fail closed)", async () => {
    const deps = infoDeps();
    assert.equal((await handleProjectInfoRequest({ accessToken: "", projectId: "project-A1" }, deps)).status, 401);
    assert.deepEqual(deps.calls, []);
    assert.equal((await handleProjectInfoRequest({ accessToken: "tok-tech-A", projectId: "  " }, deps)).status, 400);
    assert.equal((await handleProjectInfoRequest({ accessToken: "tok-global", projectId: "project-nope" }, deps)).status, 404);
    const failing = infoDeps({ async loadProjectCompany() { return { companyId: null, error: true }; } });
    assert.equal((await handleProjectInfoRequest({ accessToken: "tok-global", projectId: "project-A1" }, failing)).status, 403);
  });

  it("a Zoho lookup failure AFTER authorization degrades to 'unlinked' (200), exactly as before", async () => {
    const deps = infoDeps({ async fetchInfo() { throw new Error("db down"); } });
    const result = await handleProjectInfoRequest({ accessToken: "tok-tech-A", projectId: "project-A1" }, deps);
    assert.deepEqual(result, { status: 200, body: UNLINKED_PROJECT_INFO });
  });
});

const PROGRESS = {
  "project-A1": { saTargetAssetCount: 6, saFinalizedAssetCount: 2 },
  "project-A2": { saTargetAssetCount: 3, saFinalizedAssetCount: 3 },
};

function progressDeps(overrides: Partial<ProjectProgressDeps> = {}) {
  const calls: string[] = [];
  const deps: ProjectProgressDeps & { calls: string[] } = {
    calls,
    async authorizeCompany({ accessToken, companyId }): Promise<ProjectAuthResult> {
      calls.push(`authorizeCompany:${accessToken}:${companyId}`);
      if (accessToken === "tok-tech-A" && companyId === "company-A") return { ok: true, requesterUserId: "user-tech-A", role: "technician" };
      if (accessToken === "tok-admin-A" && companyId === "company-A") return { ok: true, requesterUserId: "user-admin-A", role: "company-admin" };
      if (accessToken === "tok-global") return { ok: true, requesterUserId: "user-global", role: "global-admin" };
      return { ok: false, status: 403, error: "Only global admins or active members of this company can access it." };
    },
    async fetchProgress(companyId) {
      calls.push(`fetchProgress:${companyId}`);
      return companyId === "company-A" ? PROGRESS : {};
    },
    async listActiveAssignedProjectIds(userId) {
      calls.push(`assignments:${userId}`);
      return userId === "user-tech-A" ? ["project-A1"] : [];
    },
    ...overrides,
  };
  return deps;
}

describe("handleProjectProgressRequest — P/Q: company-wide Zoho progress", () => {
  it("Q: a company admin gets every project's progress for their company", async () => {
    const result = await handleProjectProgressRequest({ accessToken: "tok-admin-A", companyId: "company-A" }, progressDeps());
    assert.deepEqual(result, { status: 200, body: PROGRESS });
  });

  it("Q: an assigned technician gets only the projects they are actively assigned to", async () => {
    const result = await handleProjectProgressRequest({ accessToken: "tok-tech-A", companyId: "company-A" }, progressDeps());
    assert.deepEqual(result, { status: 200, body: { "project-A1": PROGRESS["project-A1"] } });
  });

  it("P: a member of company A cannot read company B's progress — denied before any Zoho data is read", async () => {
    const deps = progressDeps();
    const result = await handleProjectProgressRequest({ accessToken: "tok-tech-A", companyId: "company-B" }, deps);
    assert.equal(result.status, 403);
    assert.ok(!deps.calls.some((c) => c.startsWith("fetchProgress")));
  });

  it("no token -> 401 before any read; missing companyId -> 400", async () => {
    const deps = progressDeps();
    assert.equal((await handleProjectProgressRequest({ accessToken: "", companyId: "company-A" }, deps)).status, 401);
    assert.deepEqual(deps.calls, []);
    assert.equal((await handleProjectProgressRequest({ accessToken: "tok-admin-A", companyId: "" }, deps)).status, 400);
  });

  it("a lookup failure AFTER authorization degrades to an empty map (200), exactly as before", async () => {
    const deps = progressDeps({ async fetchProgress() { throw new Error("db down"); } });
    const result = await handleProjectProgressRequest({ accessToken: "tok-admin-A", companyId: "company-A" }, deps);
    assert.deepEqual(result, { status: 200, body: {} });
  });
});

describe("scopeProgressToRole (pure)", () => {
  it("admins see everything; a technician sees only assigned projects; no assignments means nothing", () => {
    assert.deepEqual(scopeProgressToRole(PROGRESS, "global-admin", []), PROGRESS);
    assert.deepEqual(scopeProgressToRole(PROGRESS, "company-admin", []), PROGRESS);
    assert.deepEqual(scopeProgressToRole(PROGRESS, "technician", ["project-A2", "project-Z"]), { "project-A2": PROGRESS["project-A2"] });
    assert.deepEqual(scopeProgressToRole(PROGRESS, "technician", []), {});
  });
});
