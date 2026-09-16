import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterVisibleActiveProjects, type AccessProjectRow, type VisibilityContext } from "./active-projects-visibility.ts";

function project(id: string, companyId: string, active = true): AccessProjectRow {
  return { id, companyId, active };
}

describe("filterVisibleActiveProjects (Active Projects access matrix)", () => {
  it("global admin sees active projects across every company", () => {
    const projects = [project("p1", "companyA"), project("p2", "companyB"), project("p3", "companyC")];
    const context: VisibilityContext = { isGlobalAdmin: true, companyRolesById: {}, assignedProjectIds: [] };
    const visible = filterVisibleActiveProjects(projects, context);
    assert.deepEqual(
      visible.map((p) => p.id),
      ["p1", "p2", "p3"],
    );
  });

  it("company admin sees all active projects in that company", () => {
    const projects = [project("p1", "companyA"), project("p2", "companyA")];
    const context: VisibilityContext = {
      isGlobalAdmin: false,
      companyRolesById: { companyA: "admin" },
      assignedProjectIds: [],
    };
    const visible = filterVisibleActiveProjects(projects, context);
    assert.deepEqual(
      visible.map((p) => p.id),
      ["p1", "p2"],
    );
  });

  it("technician with active assignments sees only actively assigned projects in that company", () => {
    const projects = [project("p1", "companyA"), project("p2", "companyA"), project("p3", "companyA")];
    const context: VisibilityContext = {
      isGlobalAdmin: false,
      companyRolesById: { companyA: "technician" },
      assignedProjectIds: ["p2"],
    };
    const visible = filterVisibleActiveProjects(projects, context);
    assert.deepEqual(
      visible.map((p) => p.id),
      ["p2"],
    );
  });

  it("technician with zero active assignments temporarily sees all active projects in that accessible company (compatibility fallback pending Service Resource sync)", () => {
    const projects = [project("p1", "companyA"), project("p2", "companyA")];
    const context: VisibilityContext = {
      isGlobalAdmin: false,
      companyRolesById: { companyA: "technician" },
      assignedProjectIds: [],
    };
    const visible = filterVisibleActiveProjects(projects, context);
    assert.deepEqual(
      visible.map((p) => p.id),
      ["p1", "p2"],
    );
  });

  it("technician with assignments in company A but none in company B: fallback is evaluated per company, not globally", () => {
    const projects = [
      project("a1", "companyA"),
      project("a2", "companyA"),
      project("b1", "companyB"),
      project("b2", "companyB"),
    ];
    const context: VisibilityContext = {
      isGlobalAdmin: false,
      companyRolesById: { companyA: "technician", companyB: "technician" },
      // Only assigned in company A.
      assignedProjectIds: ["a1"],
    };
    const visible = filterVisibleActiveProjects(projects, context);
    // Company A: filtered to the one assignment. Company B: zero assignments there -> fallback shows both.
    assert.deepEqual(
      visible.map((p) => p.id).sort(),
      ["a1", "b1", "b2"].sort(),
    );
  });

  it("inactive project never appears, regardless of role", () => {
    const projects = [project("p1", "companyA", true), project("p2", "companyA", false)];
    const globalAdminContext: VisibilityContext = { isGlobalAdmin: true, companyRolesById: {}, assignedProjectIds: [] };
    assert.deepEqual(
      filterVisibleActiveProjects(projects, globalAdminContext).map((p) => p.id),
      ["p1"],
    );

    const companyAdminContext: VisibilityContext = {
      isGlobalAdmin: false,
      companyRolesById: { companyA: "admin" },
      assignedProjectIds: [],
    };
    assert.deepEqual(
      filterVisibleActiveProjects(projects, companyAdminContext).map((p) => p.id),
      ["p1"],
    );

    const technicianContext: VisibilityContext = {
      isGlobalAdmin: false,
      companyRolesById: { companyA: "technician" },
      assignedProjectIds: ["p1", "p2"],
    };
    assert.deepEqual(
      filterVisibleActiveProjects(projects, technicianContext).map((p) => p.id),
      ["p1"],
    );
  });

  it("no recognized company membership (e.g. inactive company_memberships row) does not grant technician/company-admin access", () => {
    const projects = [project("p1", "companyA")];
    const context: VisibilityContext = {
      isGlobalAdmin: false,
      // companyA has no entry at all — simulates a company the user isn't an active member of.
      companyRolesById: {},
      assignedProjectIds: [],
    };
    const visible = filterVisibleActiveProjects(projects, context);
    assert.deepEqual(visible, []);
  });
});
