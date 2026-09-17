import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSaveSnapshotStatementSet,
  saveViaConnection,
  type ExecuteSetConnection,
  type SqlSetStatement,
} from "./active-projects-field-package.ts";
import type { FieldPackageProject } from "../active-projects-field-package.ts";

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

describe("buildSaveSnapshotStatementSet (pure)", () => {
  it("orders the set as delete, one insert per project, then upsert metadata", () => {
    const set = buildSaveSnapshotStatementSet("u1", [project({ projectId: "p1" }), project({ projectId: "p2" })], "2026-01-01T00:00:00.000Z");
    assert.equal(set.length, 4);
    assert.match(set[0].statement, /^DELETE FROM field_package_projects/);
    assert.deepEqual(set[0].values, ["u1"]);
    assert.match(set[1].statement, /^INSERT INTO field_package_projects/);
    assert.equal(set[1].values[1], "p1");
    assert.match(set[2].statement, /^INSERT INTO field_package_projects/);
    assert.equal(set[2].values[1], "p2");
    assert.match(set[3].statement, /^INSERT INTO field_package_metadata/);
    assert.deepEqual(set[3].values, ["u1", "2026-01-01T00:00:00.000Z", 1]);
  });

  it("still deletes and writes metadata for an empty (legitimately zero-project) package", () => {
    const set = buildSaveSnapshotStatementSet("u1", [], "2026-01-01T00:00:00.000Z");
    assert.equal(set.length, 2);
    assert.match(set[0].statement, /^DELETE FROM field_package_projects/);
    assert.match(set[1].statement, /^INSERT INTO field_package_metadata/);
  });
});

/**
 * In-memory fake standing in for a real SQLiteDBConnection, specifically to
 * test the atomic-transaction CONTRACT this code relies on: a set containing
 * a sentinel value throws before anything is applied, and a set with no
 * sentinel applies every statement. This does not re-prove real SQLite's own
 * transaction engine (already verified via emulator runtime testing) — it
 * proves saveViaConnection() has no JS-side logic that could partially apply
 * a failed set or fabricate a syncedAt the connection never actually
 * committed.
 */
const TRIGGER_FAILURE = "TRIGGER_FAILURE";

class FakeSqliteConnection implements ExecuteSetConnection {
  rows = new Map<string, unknown[][]>();
  metadata = new Map<string, unknown[]>();

  async executeSet(set: SqlSetStatement[], transaction: boolean): Promise<unknown> {
    assert.equal(transaction, true, "saveViaConnection must always request a real transaction");
    const shouldFail = set.some((entry) => entry.values.includes(TRIGGER_FAILURE));
    if (shouldFail) {
      throw new Error("simulated transaction failure");
    }
    for (const entry of set) {
      const userId = entry.values[0] as string;
      if (entry.statement.startsWith("DELETE FROM field_package_projects")) {
        this.rows.set(userId, []);
      } else if (entry.statement.startsWith("INSERT INTO field_package_projects")) {
        const list = this.rows.get(userId) ?? [];
        list.push(entry.values);
        this.rows.set(userId, list);
      } else if (entry.statement.startsWith("INSERT INTO field_package_metadata")) {
        this.metadata.set(userId, entry.values);
      }
    }
    return undefined;
  }
}

describe("saveViaConnection transaction-failure preservation", () => {
  it("commits rows and metadata on a normal successful save", async () => {
    const db = new FakeSqliteConnection();
    const result = await saveViaConnection(db, "u1", [project({ projectId: "p1" })]);
    assert.equal(db.rows.get("u1")?.length, 1);
    assert.equal(db.metadata.get("u1")?.[1], result.syncedAt);
  });

  it("a failed transaction leaves the previous rows and metadata completely untouched", async () => {
    const db = new FakeSqliteConnection();
    const first = await saveViaConnection(db, "u1", [project({ projectId: "p1" }), project({ projectId: "p2" })]);
    const rowsBefore = structuredClone(db.rows.get("u1"));
    const metadataBefore = structuredClone(db.metadata.get("u1"));

    await assert.rejects(
      () => saveViaConnection(db, "u1", [project({ projectId: TRIGGER_FAILURE }), project({ projectId: "p3" })]),
      /simulated transaction failure/,
    );

    assert.deepEqual(db.rows.get("u1"), rowsBefore, "rows must be exactly the pre-failure rows, not partially replaced");
    assert.deepEqual(db.metadata.get("u1"), metadataBefore, "metadata (including syncedAt) must still be the previous, successful save's");
    assert.equal(metadataBefore?.[1], first.syncedAt);
  });

  it("a failed save for one user never touches a different user's package", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, "userA", [project({ projectId: "a1" })]);
    const userBRowsBefore = db.rows.get("userB");

    await assert.rejects(() => saveViaConnection(db, "userB", [project({ projectId: TRIGGER_FAILURE })]));

    assert.equal(db.rows.get("userB"), userBRowsBefore);
    assert.equal(db.rows.get("userA")?.length, 1);
  });
});
