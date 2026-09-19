import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProvisionStatementSet,
  buildUpsertStatement,
  provisionViaConnection,
  saveViaConnection,
  type ExecuteSetConnection,
  type RunQueryConnection,
  type SqlSetStatement,
} from "./project-work-package.ts";
import type { ProjectWorkPackageInput } from "../project-work-package.ts";

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

describe("buildUpsertStatement (pure)", () => {
  it("is a single INSERT ... ON CONFLICT statement carrying every field in column order", () => {
    const { statement, values } = buildUpsertStatement(packageInput(), "2026-01-01T00:00:00.000Z");
    assert.match(statement, /^INSERT INTO project_work_packages/);
    assert.match(statement, /ON CONFLICT\(user_id, project_id\) DO UPDATE SET/);
    assert.deepEqual(values, [
      "user-1",
      "project-1",
      "company-1",
      "Acme Co",
      "Main St Install",
      "Jane Doe",
      null,
      "123 Main St",
      0,
      null,
      null,
      null,
      1,
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("encodes zohoLinked as 1/0 and preserves nullable Zoho fields", () => {
    const { values } = buildUpsertStatement(
      packageInput({ zohoLinked: true, zohoWorkOrderNumber: "WO-1", zohoServiceAppointmentNumber: "SA-1", zohoSummary: "Summary" }),
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(values[8], 1);
    assert.equal(values[9], "WO-1");
    assert.equal(values[10], "SA-1");
    assert.equal(values[11], "Summary");
  });
});

/**
 * In-memory fake standing in for a real SQLiteDBConnection — proves
 * saveViaConnection() correctly upserts by (userId, projectId) and that a
 * rejected run() (simulating a real transaction failure) leaves whatever
 * was previously stored completely untouched. Does not re-prove SQLite's
 * own ON CONFLICT semantics (verified via emulator runtime testing).
 */
const TRIGGER_FAILURE = "TRIGGER_FAILURE";

class FakeSqliteConnection implements RunQueryConnection {
  rows = new Map<string, Record<string, unknown>>();

  async run(statement: string, values: unknown[] = []): Promise<unknown> {
    if (values.includes(TRIGGER_FAILURE)) {
      throw new Error("simulated write failure");
    }
    if (statement.startsWith("INSERT INTO project_work_packages")) {
      const [userId, projectId, companyId, companyName, projectName, customerName, customerAccountName, location, zohoLinked, zohoWO, zohoSA, zohoSummary, schemaVersion, syncedAt] = values;
      const key = `${userId}::${projectId}`;
      this.rows.set(key, {
        companyId,
        companyName,
        projectName,
        customerName,
        customerAccountName,
        location,
        zohoLinked,
        zohoWO,
        zohoSA,
        zohoSummary,
        schemaVersion,
        syncedAt,
      });
    } else if (statement.startsWith("DELETE FROM project_work_packages")) {
      const [userId, projectId] = values;
      this.rows.delete(`${userId}::${projectId}`);
    }
    return undefined;
  }

  async query(): Promise<{ values?: Array<Record<string, unknown>> }> {
    return { values: [] };
  }
}

describe("saveViaConnection (upsert-by-key behavior)", () => {
  it("stores a new package under its (userId, projectId) key", async () => {
    const db = new FakeSqliteConnection();
    const result = await saveViaConnection(db, packageInput());
    assert.equal(db.rows.get("user-1::project-1")?.projectName, "Main St Install");
    assert.equal(db.rows.get("user-1::project-1")?.syncedAt, result.syncedAt);
  });

  it("a second save for the SAME key replaces it, not duplicates it", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, packageInput({ projectName: "First Sync" }));
    await saveViaConnection(db, packageInput({ projectName: "Second Sync" }));
    assert.equal(db.rows.size, 1);
    assert.equal(db.rows.get("user-1::project-1")?.projectName, "Second Sync");
  });

  it("a failed write leaves the previously stored package completely untouched", async () => {
    const db = new FakeSqliteConnection();
    const first = await saveViaConnection(db, packageInput({ projectName: "Good Sync" }));
    const before = structuredClone(db.rows.get("user-1::project-1"));

    await assert.rejects(
      () => saveViaConnection(db, packageInput({ userId: TRIGGER_FAILURE })),
      /simulated write failure/,
    );

    assert.deepEqual(db.rows.get("user-1::project-1"), before, "previous row must survive a failed write untouched");
    assert.equal(before?.syncedAt, first.syncedAt);
  });

  it("different projects for the same user never collide", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, packageInput({ projectId: "project-1", projectName: "Project One" }));
    await saveViaConnection(db, packageInput({ projectId: "project-2", projectName: "Project Two" }));
    assert.equal(db.rows.get("user-1::project-1")?.projectName, "Project One");
    assert.equal(db.rows.get("user-1::project-2")?.projectName, "Project Two");
  });

  it("the same projectId for different users never collides (user isolation)", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, packageInput({ userId: "user-A", projectName: "Belongs to A" }));
    await saveViaConnection(db, packageInput({ userId: "user-B", projectName: "Belongs to B" }));
    assert.equal(db.rows.get("user-A::project-1")?.projectName, "Belongs to A");
    assert.equal(db.rows.get("user-B::project-1")?.projectName, "Belongs to B");
  });
});

describe("buildProvisionStatementSet (pure)", () => {
  it("orders the set as prune-stale, then one provision-upsert per package", () => {
    const set = buildProvisionStatementSet(
      "user-1",
      [packageInput({ projectId: "p1" }), packageInput({ projectId: "p2" })],
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(set.length, 3);
    assert.match(set[0].statement, /^DELETE FROM project_work_packages WHERE user_id = \? AND project_id NOT IN/);
    assert.deepEqual(set[0].values, ["user-1", "p1", "p2"]);
    assert.match(set[1].statement, /^INSERT INTO project_work_packages/);
    assert.match(set[1].statement, /ON CONFLICT\(user_id, project_id\) DO UPDATE SET/);
    assert.ok(!set[1].statement.includes("zoho_linked = excluded"), "provision upsert must never overwrite zoho_* columns on conflict");
    assert.equal(set[1].values[1], "p1");
    assert.equal(set[2].values[1], "p2");
  });

  it("prunes EVERYTHING for the user (no NOT IN) when the authorized set is legitimately empty", () => {
    const set = buildProvisionStatementSet("user-1", [], "2026-01-01T00:00:00.000Z");
    assert.equal(set.length, 1);
    assert.match(set[0].statement, /^DELETE FROM project_work_packages WHERE user_id = \?$/);
    assert.deepEqual(set[0].values, ["user-1"]);
  });
});

/**
 * In-memory fake simulating the two SQL behaviors this atomic path relies
 * on: the prune-stale DELETE, and — critically — the provision upsert's
 * ON CONFLICT DO UPDATE that deliberately omits the zoho_* columns, so an
 * existing row's enrichment survives a re-provision. Also proves the
 * whole batch is all-or-nothing on a simulated failure. Reuses the same
 * TRIGGER_FAILURE sentinel declared above for saveViaConnection's tests.
 */

class FakeExecuteSetConnection implements ExecuteSetConnection, RunQueryConnection {
  rows = new Map<string, Record<string, unknown>>();

  /** Simulates saveViaConnection()'s FULL upsert (including zoho_* columns) — a real SQLiteDBConnection exposes both .run() and .executeSet(), same object. */
  async run(statement: string, values: unknown[] = []): Promise<unknown> {
    if (!statement.startsWith("INSERT INTO project_work_packages")) return undefined;
    const [userId, projectId, companyId, companyName, projectName, customerName, customerAccountName, location, zohoLinked, zohoWO, zohoSA, zohoSummary, schemaVersion, syncedAt] = values;
    this.rows.set(`${userId}::${projectId}`, {
      companyId,
      companyName,
      projectName,
      customerName,
      customerAccountName,
      location,
      zohoLinked,
      zohoWO,
      zohoSA,
      zohoSummary,
      schemaVersion,
      syncedAt,
    });
    return undefined;
  }

  async query(): Promise<{ values?: Array<Record<string, unknown>> }> {
    return { values: [] };
  }

  async executeSet(set: SqlSetStatement[], transaction: boolean): Promise<unknown> {
    assert.equal(transaction, true, "provisionViaConnection must always request a real transaction");
    const shouldFail = set.some((entry) => entry.values.includes(TRIGGER_FAILURE));
    if (shouldFail) {
      throw new Error("simulated transaction failure");
    }
    for (const entry of set) {
      if (entry.statement.includes("NOT IN")) {
        const [userId, ...authorizedIds] = entry.values as string[];
        const authorized = new Set(authorizedIds);
        for (const key of [...this.rows.keys()]) {
          const [rowUserId, rowProjectId] = key.split("::");
          if (rowUserId === userId && !authorized.has(rowProjectId)) this.rows.delete(key);
        }
      } else if (entry.statement.startsWith("DELETE FROM project_work_packages")) {
        const [userId] = entry.values as string[];
        for (const key of [...this.rows.keys()]) {
          if (key.startsWith(`${userId}::`)) this.rows.delete(key);
        }
      } else if (entry.statement.startsWith("INSERT INTO project_work_packages")) {
        const [userId, projectId, companyId, companyName, projectName, customerName, customerAccountName, location, zohoLinked, zohoWO, zohoSA, zohoSummary, schemaVersion, syncedAt] = entry.values;
        const key = `${userId}::${projectId}`;
        const existing = this.rows.get(key);
        this.rows.set(key, {
          companyId,
          companyName,
          projectName,
          customerName,
          customerAccountName,
          location,
          // ON CONFLICT DO UPDATE never touches these — preserve whatever was already there.
          zohoLinked: existing ? existing.zohoLinked : zohoLinked,
          zohoWO: existing ? existing.zohoWO : zohoWO,
          zohoSA: existing ? existing.zohoSA : zohoSA,
          zohoSummary: existing ? existing.zohoSummary : zohoSummary,
          schemaVersion,
          syncedAt,
        });
      }
    }
    return undefined;
  }
}

describe("provisionViaConnection (atomic bulk provisioning)", () => {
  it("inserts every authorized package for a user with zoho unenriched on first sync", async () => {
    const db = new FakeExecuteSetConnection();
    await provisionViaConnection(db, "user-1", [packageInput({ projectId: "p1" }), packageInput({ projectId: "p2" })]);
    assert.equal(db.rows.size, 2);
    assert.equal(db.rows.get("user-1::p1")?.zohoLinked, 0);
  });

  it("prunes a package that is no longer in the authorized set after a successful re-provision", async () => {
    const db = new FakeExecuteSetConnection();
    await provisionViaConnection(db, "user-1", [packageInput({ projectId: "p1" }), packageInput({ projectId: "p2" })]);
    await provisionViaConnection(db, "user-1", [packageInput({ projectId: "p1" })]);
    assert.equal(db.rows.has("user-1::p1"), true);
    assert.equal(db.rows.has("user-1::p2"), false, "p2 dropped from the authorized set must no longer be reachable offline");
  });

  it("preserves an existing package's Zoho enrichment across a re-provision that only knows nulls", async () => {
    const db = new FakeExecuteSetConnection();
    // Simulates an earlier real Project Detail online visit enriching p1 directly (saveViaConnection, full upsert).
    await saveViaConnection(
      db,
      packageInput({
        projectId: "p1",
        zohoLinked: true,
        zohoWorkOrderNumber: "WO-1",
        zohoServiceAppointmentNumber: "SA-1",
        zohoSummary: "Real summary",
      }),
    );
    // A later bulk re-provision only ever knows zohoLinked:false/nulls.
    await provisionViaConnection(db, "user-1", [packageInput({ projectId: "p1", projectName: "Renamed Project" })]);
    const row = db.rows.get("user-1::p1");
    assert.equal(row?.projectName, "Renamed Project", "identity fields still refresh");
    assert.equal(row?.zohoLinked, 1, "real enrichment must survive a bulk re-provision");
    assert.equal(row?.zohoWO, "WO-1");
    assert.equal(row?.zohoSA, "SA-1");
    assert.equal(row?.zohoSummary, "Real summary");
  });

  it("a failed provisioning batch leaves every previous package — stale or not — completely untouched", async () => {
    const db = new FakeExecuteSetConnection();
    await provisionViaConnection(db, "user-1", [packageInput({ projectId: "p1" }), packageInput({ projectId: "p2" })]);
    const before = structuredClone(Object.fromEntries(db.rows));

    await assert.rejects(
      () => provisionViaConnection(db, "user-1", [packageInput({ projectId: TRIGGER_FAILURE })]),
      /simulated transaction failure/,
    );

    assert.deepEqual(Object.fromEntries(db.rows), before, "p1 and p2 (including the one that WOULD have been pruned) must survive a failed batch");
  });

  it("provisioning an empty authorized set prunes every package for that user (a legitimate zero-access result)", async () => {
    const db = new FakeExecuteSetConnection();
    await provisionViaConnection(db, "user-1", [packageInput({ projectId: "p1" })]);
    await provisionViaConnection(db, "user-1", []);
    assert.equal(db.rows.size, 0);
  });

  it("re-provisioning for user-1 never touches user-2's packages", async () => {
    const db = new FakeExecuteSetConnection();
    await provisionViaConnection(db, "user-1", [packageInput({ userId: "user-1", projectId: "p1" })]);
    await provisionViaConnection(db, "user-2", [packageInput({ userId: "user-2", projectId: "p1" })]);
    await provisionViaConnection(db, "user-1", []);
    assert.equal(db.rows.has("user-1::p1"), false);
    assert.equal(db.rows.has("user-2::p1"), true, "user-1's empty re-provision must not prune user-2's package");
  });
});
