import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildObservedResourceCatalog,
  companyIdsForResource,
  deriveUnmappedResources,
  extractServiceResourcesFromRawSnapshot,
  type SaCatalogRow,
} from "./resource-map.ts";

function row(overrides: Partial<SaCatalogRow>): SaCatalogRow {
  return {
    zoho_service_appointment_id: "sa-1",
    zoho_service_appointment_number: "AP-1",
    project_id: "project-1",
    company_id: "company-1",
    raw_snapshot: {},
    projects: { project_name: "Some Project", customer_name: "Some Customer" },
    companies: { name: "Some Company" },
    ...overrides,
  };
}

describe("extractServiceResourcesFromRawSnapshot", () => {
  it("reads $Service_Resources off raw_snapshot.serviceAppointment, ignoring the separate empty plain field", () => {
    const refs = extractServiceResourcesFromRawSnapshot({
      workOrder: {},
      serviceAppointment: {
        id: "sa-1",
        Service_Resources: [],
        "$Service_Resources": [{ id: "res-1", name: "Nick O'Leary", Type: "Agent", parent_id: "user-1" }],
      },
    });
    assert.deepEqual(refs, [
      { zohoResourceId: "res-1", name: "Nick O'Leary", type: "Agent", zohoUserId: "user-1" },
    ]);
  });

  it("returns [] for null/undefined/non-object raw_snapshot", () => {
    assert.deepEqual(extractServiceResourcesFromRawSnapshot(null), []);
    assert.deepEqual(extractServiceResourcesFromRawSnapshot(undefined), []);
    assert.deepEqual(extractServiceResourcesFromRawSnapshot("not an object"), []);
  });

  it("returns [] when serviceAppointment or $Service_Resources is missing/malformed", () => {
    assert.deepEqual(extractServiceResourcesFromRawSnapshot({}), []);
    assert.deepEqual(extractServiceResourcesFromRawSnapshot({ serviceAppointment: {} }), []);
    assert.deepEqual(
      extractServiceResourcesFromRawSnapshot({ serviceAppointment: { "$Service_Resources": "not an array" } }),
      [],
    );
  });

  it("skips an entry with no id — it cannot be mapped to anything", () => {
    const refs = extractServiceResourcesFromRawSnapshot({
      serviceAppointment: { "$Service_Resources": [{ name: "No Id Here" }] },
    });
    assert.deepEqual(refs, []);
  });
});

describe("buildObservedResourceCatalog", () => {
  it("aggregates one resource seen on multiple SAs into a single catalog entry with every seenOn", () => {
    const catalog = buildObservedResourceCatalog([
      row({
        zoho_service_appointment_id: "sa-1",
        zoho_service_appointment_number: "AP-1",
        raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1", name: "Nick", Type: "Agent" }] } },
      }),
      row({
        zoho_service_appointment_id: "sa-2",
        zoho_service_appointment_number: "AP-2",
        project_id: "project-2",
        company_id: "company-2",
        projects: { project_name: "Other Project", customer_name: "" },
        companies: { name: "Other Company" },
        raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1", name: "Nick", Type: "Agent" }] } },
      }),
    ]);
    assert.equal(catalog.size, 1);
    const entry = catalog.get("res-1");
    assert.ok(entry);
    assert.equal(entry?.seenOn.length, 2);
    assert.deepEqual(
      entry?.seenOn.map((s) => s.zohoServiceAppointmentNumber),
      ["AP-1", "AP-2"],
    );
  });

  it("keeps two different resources as two catalog entries", () => {
    const catalog = buildObservedResourceCatalog([
      row({
        raw_snapshot: {
          serviceAppointment: {
            "$Service_Resources": [
              { id: "res-1", name: "Nick", Type: "Agent" },
              { id: "res-2", name: "Someone Else", Type: "Agent" },
            ],
          },
        },
      }),
    ]);
    assert.equal(catalog.size, 2);
    assert.ok(catalog.has("res-1"));
    assert.ok(catalog.has("res-2"));
  });

  it("falls back to customer_name for projectName when project_name is blank, and skips rows with no resources", () => {
    const catalog = buildObservedResourceCatalog([
      row({ raw_snapshot: {} }),
      row({
        projects: { project_name: "", customer_name: "Fallback Customer" },
        raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1", name: "Nick" }] } },
      }),
    ]);
    assert.equal(catalog.size, 1);
    assert.equal(catalog.get("res-1")?.seenOn[0]?.projectName, "Fallback Customer");
  });
});

describe("companyIdsForResource", () => {
  it("returns the distinct set of company ids a resource was observed on", () => {
    const catalog = buildObservedResourceCatalog([
      row({ company_id: "company-1", raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1" }] } } }),
      row({ company_id: "company-2", raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1" }] } } }),
      row({ company_id: "company-1", raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1" }] } } }),
    ]);
    const ids = companyIdsForResource(catalog.get("res-1")!);
    assert.deepEqual(ids, new Set(["company-1", "company-2"]));
  });
});

describe("deriveUnmappedResources", () => {
  it("excludes resources already present in the mapped id set", () => {
    const catalog = buildObservedResourceCatalog([
      row({
        raw_snapshot: {
          serviceAppointment: {
            "$Service_Resources": [
              { id: "res-1", name: "Zed" },
              { id: "res-2", name: "Ann" },
            ],
          },
        },
      }),
    ]);
    const unmapped = deriveUnmappedResources(catalog, new Set(["res-1"]));
    assert.equal(unmapped.length, 1);
    assert.equal(unmapped[0]?.zohoResourceId, "res-2");
  });

  it("sorts by display name", () => {
    const catalog = buildObservedResourceCatalog([
      row({
        raw_snapshot: {
          serviceAppointment: {
            "$Service_Resources": [
              { id: "res-1", name: "Zed" },
              { id: "res-2", name: "Ann" },
            ],
          },
        },
      }),
    ]);
    const unmapped = deriveUnmappedResources(catalog, new Set());
    assert.deepEqual(
      unmapped.map((r) => r.name),
      ["Ann", "Zed"],
    );
  });

  it("returns [] when every observed resource is already mapped", () => {
    const catalog = buildObservedResourceCatalog([
      row({ raw_snapshot: { serviceAppointment: { "$Service_Resources": [{ id: "res-1" }] } } }),
    ]);
    assert.deepEqual(deriveUnmappedResources(catalog, new Set(["res-1"])), []);
  });
});
