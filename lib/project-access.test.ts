import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyProjectBelongsToCompany } from "./project-access.ts";

/**
 * Phase 2H security reconciliation — verifyProjectBelongsToCompany is the
 * pure core of the project/company binding fix: authorizeProjectAccess
 * (lib/project-access.ts) previously proved company_memberships for the
 * client-supplied companyId and project_assignments for the client-supplied
 * projectId independently, never that the two ids actually describe the
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
