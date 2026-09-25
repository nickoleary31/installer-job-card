import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCompanyAccess, decideProjectAccess, verifyProjectBelongsToCompany, type ProjectAccessReads, type ProjectRecord } from "./project-access.ts";

/**
 * Phase 2H security reconciliation — verifyProjectBelongsToCompany is the
 * pure core of the project/company binding fix: authorizeProjectAccess
 * (lib/project-access.ts) previously proved company_memberships for the
 * client-supplied companyId, and project_assignments for the client-supplied
 * projectId, INDEPENDENTLY — never that the two ids actually describe the
 * SAME project. These tests exercise the decision in isolation, without a
 * live Supabase project.
 */
describe("verifyProjectBelongsToCompany (pure)", () => {
  it("allows when the loaded project's company_id matches the requested companyId", () => {
    const result = verifyProjectBelongsToCompany({ id: "project-1", companyId: "company-1" }, "project-1", "company-1");
    assert.deepEqual(result, { ok: true });
  });

  it("denies with 409 (terminal identity conflict, never a retryable/auth status) when the project belongs to a DIFFERENT company than requested", () => {
    const result = verifyProjectBelongsToCompany({ id: "project-1", companyId: "company-B" }, "project-1", "company-A");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.match(result.error, /does not belong/i);
    }
  });

  it("denies with 404 when no project with that id exists at all", () => {
    const result = verifyProjectBelongsToCompany(null, "project-does-not-exist", "company-1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("denies (defensively) when the loaded project's own id doesn't match the requested projectId — a caller bug, never trusted blindly", () => {
    const result = verifyProjectBelongsToCompany({ id: "some-other-project", companyId: "company-1" }, "project-1", "company-1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("models: user legitimately in company A, but the requested project actually belongs to company B — denied even though the caller CAN prove company-A membership elsewhere", () => {
    // This is the exact scenario the RLS/adversarial review flagged: a company-A admin (or a
    // technician with a real assignment row) supplying companyId=A alongside a projectId that
    // actually belongs to company B. This check runs BEFORE any membership/assignment lookup,
    // so it denies regardless of what those checks would separately conclude.
    const result = verifyProjectBelongsToCompany({ id: "project-in-B", companyId: "company-B" }, "project-in-B", "company-A");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });
});

/**
 * Checkpoint 2 — the full decision, against an in-memory world. Every
 * route that scopes work to a project (finalize, photo-upload-url, history,
 * Zoho project-info, send-email, expense-report, auto-publish) goes through
 * decideProjectAccess, so these are the tenant-boundary tests for all of
 * them (N/O/P in the checkpoint's own numbering).
 */
type World = {
  tokens: Record<string, string>; // accessToken -> userId
  projects: Record<string, ProjectRecord>;
  profiles: Record<string, { global_role: "admin" | "technician" | null; is_active?: boolean | null }>;
  memberships: Record<string, { role: "admin" | "technician"; is_active: boolean }>; // `${companyId}:${userId}`
  assignments: Set<string>; // `${userId}:${projectId}` (active only)
  failing?: Partial<Record<"project" | "profile" | "membership" | "assignment", boolean>>;
};

function world(overrides: Partial<World> = {}): World {
  return {
    tokens: { "tok-tech": "user-tech", "tok-admin-A": "user-admin-A", "tok-global": "user-global", "tok-inactive": "user-inactive", "tok-outsider": "user-outsider" },
    projects: {
      "project-A1": { id: "project-A1", companyId: "company-A", active: true },
      "project-A2": { id: "project-A2", companyId: "company-A", active: true },
      "project-A-closed": { id: "project-A-closed", companyId: "company-A", active: false },
      "project-B1": { id: "project-B1", companyId: "company-B", active: true },
    },
    profiles: {
      "user-tech": { global_role: "technician", is_active: true },
      "user-admin-A": { global_role: "technician", is_active: true },
      "user-global": { global_role: "admin", is_active: true },
      "user-inactive": { global_role: "technician", is_active: false },
      "user-outsider": { global_role: "technician", is_active: true },
    },
    memberships: {
      "company-A:user-tech": { role: "technician", is_active: true },
      "company-A:user-admin-A": { role: "admin", is_active: true },
      "company-A:user-inactive": { role: "technician", is_active: true },
      "company-B:user-outsider": { role: "technician", is_active: true },
    },
    assignments: new Set(["user-tech:project-A1", "user-inactive:project-A1", "user-tech:project-A-closed"]),
    ...overrides,
  };
}

function reads(w: World): ProjectAccessReads & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async verifyAccessToken(token) {
      calls.push("verifyAccessToken");
      const userId = w.tokens[token];
      return userId ? { userId } : null;
    },
    async loadProject(projectId) {
      calls.push("loadProject");
      if (w.failing?.project) return { project: null, error: true };
      return { project: w.projects[projectId] ?? null };
    },
    async loadProfile(userId) {
      calls.push("loadProfile");
      if (w.failing?.profile) return { profile: null, error: true };
      const p = w.profiles[userId];
      return { profile: p ? { id: userId, ...p } : null };
    },
    async loadMembership(companyId, userId) {
      calls.push("loadMembership");
      if (w.failing?.membership) return { membership: null, error: true };
      return { membership: w.memberships[`${companyId}:${userId}`] ?? null };
    },
    async hasActiveAssignment(userId, projectId) {
      calls.push("hasActiveAssignment");
      if (w.failing?.assignment) return { assigned: false, error: true };
      return { assigned: w.assignments.has(`${userId}:${projectId}`) };
    },
  };
}

const decide = (token: string, companyId: string, projectId: string, w = world(), options: { requireActiveProject?: boolean } = {}) =>
  decideProjectAccess({ accessToken: token, companyId, projectId }, reads(w), options);

describe("decideProjectAccess — identity", () => {
  it("A: no token -> 401, before any read", async () => {
    const r = reads(world());
    const result = await decideProjectAccess({ accessToken: "", companyId: "company-A", projectId: "project-A1" }, r);
    assert.deepEqual(result, { ok: false, status: 401, error: "Missing authorization token." });
    assert.deepEqual(r.calls, []);
  });

  it("an unverifiable token -> 401; identity only ever comes from token verification", async () => {
    const result = await decide("tok-forged", "company-A", "project-A1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });
});

describe("decideProjectAccess — G/H: legitimate access", () => {
  it("G: an active technician with an active assignment on the project is allowed, as a technician", async () => {
    const result = await decide("tok-tech", "company-A", "project-A1");
    assert.deepEqual(result, { ok: true, requesterUserId: "user-tech", role: "technician", project: world().projects["project-A1"] });
  });

  it("H: an active company admin is allowed on any active project of their company, without an assignment", async () => {
    const result = await decide("tok-admin-A", "company-A", "project-A2");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.role, "company-admin");
  });

  it("H: an active global admin is allowed on any company's active project", async () => {
    const result = await decide("tok-global", "company-B", "project-B1");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.role, "global-admin");
  });
});

describe("decideProjectAccess — B/C/N/O: tenant and assignment boundaries", () => {
  it("B: a company-A member naming company A but a project that belongs to company B -> 409, before any role check", async () => {
    const r = reads(world());
    const result = await decideProjectAccess({ accessToken: "tok-admin-A", companyId: "company-A", projectId: "project-B1" }, r);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
    assert.ok(!r.calls.includes("loadMembership"), "the mismatch is decided before membership is even read");
  });

  it("B: a member of company B cannot reach company A's project even by naming company A correctly", async () => {
    const result = await decide("tok-outsider", "company-A", "project-A1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("C: an active technician of the company with NO active assignment on this project -> 403", async () => {
    const result = await decide("tok-tech", "company-A", "project-A2");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("a project that does not exist -> 404", async () => {
    const result = await decide("tok-global", "company-A", "project-nope");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });
});

describe("decideProjectAccess — D/E: inactive profile / inactive project", () => {
  it("D: a deactivated user profile is refused even with an active membership AND an active assignment", async () => {
    const result = await decide("tok-inactive", "company-A", "project-A1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.match(result.error, /not active/);
    }
  });

  it("D: a deactivated GLOBAL admin is refused too", async () => {
    const w = world();
    w.profiles["user-global"] = { global_role: "admin", is_active: false };
    const result = await decide("tok-global", "company-A", "project-A1", w);
    assert.equal(result.ok, false);
  });

  it("E: with requireActiveProject (the write routes: finalize, photo-upload-url) an inactive project is refused for everyone — an assigned technician, a company admin, and a global admin (403, so a reactivation can restore access)", async () => {
    for (const token of ["tok-tech", "tok-admin-A", "tok-global"]) {
      const result = await decide(token, "company-A", "project-A-closed", world(), { requireActiveProject: true });
      assert.equal(result.ok, false, token);
      if (!result.ok) {
        assert.equal(result.status, 403);
        assert.match(result.error, /not active/);
      }
    }
  });

  it("E: without requireActiveProject (read routes: history, Zoho info, expense export, email resend) an inactive project is still readable by those who have access, and the decision reports it as inactive", async () => {
    const result = await decide("tok-admin-A", "company-A", "project-A-closed");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.project.active, false);
    assert.equal((await decide("tok-outsider", "company-A", "project-A-closed")).ok, false, "access rules still apply to inactive projects");
  });

  it("an inactive membership is refused even when a profile is active", async () => {
    const w = world();
    w.memberships["company-A:user-tech"] = { role: "technician", is_active: false };
    const result = await decide("tok-tech", "company-A", "project-A1", w);
    assert.equal(result.ok, false);
  });
});

describe("decideProjectAccess — fails closed on any read failure", () => {
  for (const failing of ["project", "profile", "membership", "assignment"] as const) {
    it(`a failed ${failing} read is a denial, never treated as "no row" or as access`, async () => {
      const w = world({ failing: { [failing]: true } });
      const result = await decide("tok-tech", "company-A", "project-A1", w);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 403);
    });
  }

  it("a missing profile row is a denial", async () => {
    const w = world();
    delete w.profiles["user-tech"];
    const result = await decide("tok-tech", "company-A", "project-A1", w);
    assert.equal(result.ok, false);
  });
});

describe("decideCompanyAccess — P: the company-scoped counterpart", () => {
  const decideCompany = (token: string, companyId: string, w = world()) => decideCompanyAccess({ accessToken: token, companyId }, reads(w));

  it("an active member (any role) or a global admin is allowed, with their role reported", async () => {
    assert.deepEqual(await decideCompany("tok-tech", "company-A"), { ok: true, requesterUserId: "user-tech", role: "technician" });
    assert.deepEqual(await decideCompany("tok-admin-A", "company-A"), { ok: true, requesterUserId: "user-admin-A", role: "company-admin" });
    assert.deepEqual(await decideCompany("tok-global", "company-B"), { ok: true, requesterUserId: "user-global", role: "global-admin" });
  });

  it("P: a member of company B is refused for company A", async () => {
    const result = await decideCompany("tok-outsider", "company-A");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("no token -> 401; an inactive profile -> 403; an inactive membership -> 403", async () => {
    assert.equal((await decideCompany("", "company-A")).ok, false);
    assert.equal((await decideCompany("tok-inactive", "company-A")).ok, false);
    const w = world();
    w.memberships["company-A:user-tech"] = { role: "technician", is_active: false };
    assert.equal((await decideCompany("tok-tech", "company-A", w)).ok, false);
  });
});
