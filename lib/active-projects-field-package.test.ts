import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fromFieldPackageProjects,
  resolveActiveProjectsLoadOutcome,
  toFieldPackageProjects,
  type ActiveProjectsSnapshot,
  type CompanyGroup,
  type FieldPackageProject,
} from "./active-projects-field-package.ts";

function project(overrides: Partial<FieldPackageProject> = {}): FieldPackageProject {
  return {
    projectId: "p1",
    companyId: "c1",
    companyName: "Acme Co",
    projectName: "Main St Install",
    displayCustomerName: "Jane Doe",
    displayLocation: "123 Main St",
    completedSubmissionCount: 2,
    active: true,
    ...overrides,
  };
}

describe("toFieldPackageProjects (pure)", () => {
  it("flattens grouped view-model cards into storable rows, tagging every row active", () => {
    const groups: CompanyGroup[] = [
      {
        companyId: "c1",
        companyName: "Acme Co",
        projects: [
          {
            id: "p1",
            companyId: "c1",
            projectName: "Main St Install",
            displayCustomerName: "Jane Doe",
            displayLocation: "123 Main St",
            completedSubmissionCount: 2,
          },
        ],
      },
      {
        companyId: "c2",
        companyName: "Beta Co",
        projects: [
          {
            id: "p2",
            companyId: "c2",
            projectName: "2nd Ave Install",
            displayCustomerName: "John Roe",
            displayLocation: "",
            completedSubmissionCount: 0,
          },
        ],
      },
    ];

    const rows = toFieldPackageProjects(groups);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      projectId: "p1",
      companyId: "c1",
      companyName: "Acme Co",
      projectName: "Main St Install",
      displayCustomerName: "Jane Doe",
      displayLocation: "123 Main St",
      completedSubmissionCount: 2,
      active: true,
    });
    assert.equal(rows[1].companyName, "Beta Co");
    assert.equal(rows[1].active, true);
  });

  it("returns an empty array for an empty package (a legitimate authorized zero-project result)", () => {
    assert.deepEqual(toFieldPackageProjects([]), []);
  });
});

describe("fromFieldPackageProjects (pure)", () => {
  it("groups rows by company and sorts companies and projects by name", () => {
    const rows: FieldPackageProject[] = [
      project({ projectId: "p2", companyId: "c2", companyName: "Zeta Co", projectName: "B Project" }),
      project({ projectId: "p1", companyId: "c1", companyName: "Acme Co", projectName: "B Project" }),
      project({ projectId: "p3", companyId: "c1", companyName: "Acme Co", projectName: "A Project" }),
    ];

    const groups = fromFieldPackageProjects(rows);
    assert.deepEqual(
      groups.map((g) => g.companyName),
      ["Acme Co", "Zeta Co"],
    );
    assert.deepEqual(
      groups[0].projects.map((p) => p.projectName),
      ["A Project", "B Project"],
    );
  });

  it("excludes rows persisted as inactive", () => {
    const rows: FieldPackageProject[] = [project({ active: false })];
    assert.deepEqual(fromFieldPackageProjects(rows), []);
  });

  it("round-trips through toFieldPackageProjects for a single project", () => {
    const groups: CompanyGroup[] = [
      {
        companyId: "c1",
        companyName: "Acme Co",
        projects: [
          {
            id: "p1",
            companyId: "c1",
            projectName: "Main St Install",
            displayCustomerName: "Jane Doe",
            displayLocation: "123 Main St",
            completedSubmissionCount: 2,
          },
        ],
      },
    ];
    const roundTripped = fromFieldPackageProjects(toFieldPackageProjects(groups));
    assert.deepEqual(roundTripped, groups);
  });
});

describe("resolveActiveProjectsLoadOutcome (pure)", () => {
  it("shows the fresh online result and never consults the cache when remote succeeds", () => {
    const groups: CompanyGroup[] = [{ companyId: "c1", companyName: "Acme Co", projects: [] }];
    const staleSnapshot: ActiveProjectsSnapshot = {
      userId: "u1",
      syncedAt: "2020-01-01T00:00:00.000Z",
      schemaVersion: 1,
      projects: [project({ companyName: "Stale Co" })],
    };
    const outcome = resolveActiveProjectsLoadOutcome({ remote: { ok: true, groups }, cachedSnapshot: staleSnapshot });
    assert.deepEqual(outcome, { kind: "online", groups });
  });

  it("falls back to the cached snapshot, explicitly tagged offline-cached, when remote fails", () => {
    const snapshot: ActiveProjectsSnapshot = {
      userId: "u1",
      syncedAt: "2024-06-01T12:00:00.000Z",
      schemaVersion: 1,
      projects: [project()],
    };
    const outcome = resolveActiveProjectsLoadOutcome({ remote: { ok: false, error: "network error" }, cachedSnapshot: snapshot });
    assert.equal(outcome.kind, "offline-cached");
    if (outcome.kind === "offline-cached") {
      assert.equal(outcome.syncedAt, "2024-06-01T12:00:00.000Z");
      assert.equal(outcome.groups.length, 1);
      assert.equal(outcome.groups[0].companyName, "Acme Co");
    }
  });

  it("reports an honest unavailable outcome carrying the original error when remote fails with no cache", () => {
    const outcome = resolveActiveProjectsLoadOutcome({ remote: { ok: false, error: "offline" }, cachedSnapshot: null });
    assert.deepEqual(outcome, { kind: "unavailable", error: "offline" });
  });
});
