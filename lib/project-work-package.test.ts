import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProvisionedProjectWorkPackages,
  resolveProjectDetailLoadOutcome,
  type ActiveProjectForProvisioning,
  type ProjectWorkPackage,
  type ProjectWorkPackageInput,
} from "./project-work-package.ts";

function packageInput(overrides: Partial<ProjectWorkPackageInput> = {}): ProjectWorkPackageInput {
  return {
    userId: "user-1",
    projectId: "project-1",
    companyId: "company-1",
    companyName: "Acme Co",
    projectName: "Main St Install",
    customerName: "Jane Doe",
    customerAccountName: null,
    location: "123 Main St",
    zohoLinked: false,
    zohoWorkOrderNumber: null,
    zohoServiceAppointmentNumber: null,
    zohoSummary: null,
    ...overrides,
  };
}

function storedPackage(overrides: Partial<ProjectWorkPackage> = {}): ProjectWorkPackage {
  return {
    ...packageInput(),
    schemaVersion: 1,
    syncedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveProjectDetailLoadOutcome (pure)", () => {
  it("shows the fresh online result and never consults the cache when remote succeeds", () => {
    const fresh = packageInput({ projectName: "Fresh Name" });
    const stale = storedPackage({ projectName: "Stale Name" });
    const outcome = resolveProjectDetailLoadOutcome({ remote: { ok: true, package: fresh }, cachedPackage: stale });
    assert.deepEqual(outcome, { kind: "online", package: fresh });
  });

  it("falls back to the cached package, explicitly tagged offline-cached, when remote fails", () => {
    const cached = storedPackage({ projectName: "Cached Name" });
    const outcome = resolveProjectDetailLoadOutcome({ remote: { ok: false, error: "network error" }, cachedPackage: cached });
    assert.equal(outcome.kind, "offline-cached");
    if (outcome.kind === "offline-cached") {
      assert.equal(outcome.package.projectName, "Cached Name");
      assert.equal(outcome.package.syncedAt, "2026-01-01T00:00:00.000Z");
    }
  });

  it("reports an honest unavailable outcome carrying the original error when remote fails with no cache", () => {
    const outcome = resolveProjectDetailLoadOutcome({ remote: { ok: false, error: "offline" }, cachedPackage: null });
    assert.deepEqual(outcome, { kind: "unavailable", error: "offline" });
  });
});

function activeProject(overrides: Partial<ActiveProjectForProvisioning> = {}): ActiveProjectForProvisioning {
  return {
    projectId: "project-1",
    companyId: "company-1",
    companyName: "Acme Co",
    projectName: "Main St Install",
    customerName: "Jane Doe",
    customerAccountId: null,
    location: "123 Main St",
    ...overrides,
  };
}

describe("buildProvisionedProjectWorkPackages (pure, Phase 2D.1 proactive provisioning)", () => {
  it("maps every authorized project to a work package input with Zoho left unenriched", () => {
    const packages = buildProvisionedProjectWorkPackages("user-1", [activeProject()], {});
    assert.equal(packages.length, 1);
    assert.deepEqual(packages[0], {
      userId: "user-1",
      projectId: "project-1",
      companyId: "company-1",
      companyName: "Acme Co",
      projectName: "Main St Install",
      customerName: "Jane Doe",
      customerAccountName: null,
      location: "123 Main St",
      zohoLinked: false,
      zohoWorkOrderNumber: null,
      zohoServiceAppointmentNumber: null,
      zohoSummary: null,
    });
  });

  it("resolves customerAccountName from the provided map when customerAccountId is set", () => {
    const packages = buildProvisionedProjectWorkPackages(
      "user-1",
      [activeProject({ customerAccountId: "acct-1" })],
      { "acct-1": "Acme Holdings" },
    );
    assert.equal(packages[0].customerAccountName, "Acme Holdings");
  });

  it("leaves customerAccountName null when customerAccountId is set but missing from the map (failed/partial lookup)", () => {
    const packages = buildProvisionedProjectWorkPackages("user-1", [activeProject({ customerAccountId: "acct-missing" })], {});
    assert.equal(packages[0].customerAccountName, null);
  });

  it("produces one entry per project, correctly scoped to the given userId, never per-project I/O", () => {
    const packages = buildProvisionedProjectWorkPackages(
      "user-1",
      [activeProject({ projectId: "p1" }), activeProject({ projectId: "p2", companyName: "Beta Co" })],
      {},
    );
    assert.equal(packages.length, 2);
    assert.ok(packages.every((p) => p.userId === "user-1"));
    assert.deepEqual(packages.map((p) => p.projectId), ["p1", "p2"]);
  });

  it("returns an empty array for a legitimately zero-project authorized set", () => {
    assert.deepEqual(buildProvisionedProjectWorkPackages("user-1", [], {}), []);
  });
});
