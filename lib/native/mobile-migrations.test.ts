import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pendingMigrations, runMigrations, type MigratableConnection, type SqlMigration } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";

/** Minimal in-memory fake standing in for a real SQLiteDBConnection — mirrors database.test.ts's own helper. */
function createFakeConnection(): MigratableConnection & { appliedVersions: number[]; executedSql: string[] } {
  const appliedVersions: number[] = [];
  const executedSql: string[] = [];
  return {
    appliedVersions,
    executedSql,
    async execute(statements: string) {
      executedSql.push(statements);
      return undefined;
    },
    async run(statement: string, values?: unknown[]) {
      if (statement.startsWith("INSERT INTO mobile_schema_migrations")) {
        appliedVersions.push(Number(values?.[0]));
      }
      return undefined;
    },
    async query() {
      return { values: appliedVersions.map((version) => ({ version })) };
    },
  };
}

describe("MOBILE_MIGRATIONS catalog integrity", () => {
  it("every migration version number is unique — the exact hazard a distributed per-file design could not catch at edit time", () => {
    const versions = MOBILE_MIGRATIONS.map((m) => m.version);
    assert.equal(new Set(versions).size, versions.length, "duplicate migration version numbers found in MOBILE_MIGRATIONS");
  });

  it("both Phase 2B's field_package_projects and Phase 2D's project_work_packages tables are present in the one catalog", () => {
    const allStatements = MOBILE_MIGRATIONS.flatMap((m) => m.statements).join("\n");
    assert.match(allStatements, /CREATE TABLE IF NOT EXISTS field_package_projects/);
    assert.match(allStatements, /CREATE TABLE IF NOT EXISTS project_work_packages/);
  });

  it("Phase 2E's contact columns (version 3) and company_product_definitions table (version 4) are present", () => {
    const allStatements = MOBILE_MIGRATIONS.flatMap((m) => m.statements).join("\n");
    assert.match(allStatements, /ALTER TABLE project_work_packages ADD COLUMN primary_contact TEXT/);
    assert.match(allStatements, /ALTER TABLE project_work_packages ADD COLUMN contact_number TEXT/);
    assert.match(allStatements, /ALTER TABLE project_work_packages ADD COLUMN contact_email TEXT/);
    assert.match(allStatements, /CREATE TABLE IF NOT EXISTS company_product_definitions/);
  });

  it("Phase 2F's local_submissions table (version 5) is present", () => {
    const allStatements = MOBILE_MIGRATIONS.flatMap((m) => m.statements).join("\n");
    assert.match(allStatements, /CREATE TABLE IF NOT EXISTS local_submissions/);
    assert.match(allStatements, /CREATE INDEX IF NOT EXISTS idx_local_submissions_user_project/);
  });
});

describe("Phase 2E migrations (version 3: contact columns, version 4: company_product_definitions)", () => {
  it("applied on top of a pre-Phase-2E install (versions 1 and 2 already recorded) runs every later version once each, in order", async () => {
    const db = createFakeConnection();
    db.appliedVersions.push(1, 2);
    await runMigrations(db, MOBILE_MIGRATIONS);
    assert.deepEqual(db.appliedVersions.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    assert.ok(db.executedSql.some((sql) => sql.includes("ADD COLUMN primary_contact")));
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS company_product_definitions")));
    // Versions 1 and 2's statements must not be re-executed just because
    // they were already recorded as applied.
    assert.equal(db.executedSql.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS field_package_projects")).length, 0);
  });

  it("is idempotent — three initializations on a fresh install record each version exactly once and never re-run 3/4's statements", async () => {
    const db = createFakeConnection();
    await runMigrations(db, MOBILE_MIGRATIONS);
    await runMigrations(db, MOBILE_MIGRATIONS);
    await runMigrations(db, MOBILE_MIGRATIONS);
    assert.equal(db.appliedVersions.filter((v) => v === 3).length, 1);
    assert.equal(db.appliedVersions.filter((v) => v === 4).length, 1);
    assert.equal(db.executedSql.filter((sql) => sql.includes("ADD COLUMN primary_contact")).length, 1);
    assert.equal(
      db.executedSql.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS company_product_definitions")).length,
      1,
    );
  });
});

describe("Phase 2F migration (version 5: local_submissions)", () => {
  it("applied on top of a pre-Phase-2F install (versions 1-4 already recorded) runs only 5", async () => {
    const db = createFakeConnection();
    db.appliedVersions.push(1, 2, 3, 4);
    await runMigrations(db, MOBILE_MIGRATIONS);
    assert.deepEqual(db.appliedVersions.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS local_submissions")));
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE INDEX IF NOT EXISTS idx_local_submissions_user_project")));
    assert.equal(db.executedSql.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS company_product_definitions")).length, 0);
  });

  it("is idempotent — three initializations on a fresh install record version 5 exactly once and never re-run its statements", async () => {
    const db = createFakeConnection();
    await runMigrations(db, MOBILE_MIGRATIONS);
    await runMigrations(db, MOBILE_MIGRATIONS);
    await runMigrations(db, MOBILE_MIGRATIONS);
    assert.equal(db.appliedVersions.filter((v) => v === 5).length, 1);
    assert.equal(db.executedSql.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS local_submissions")).length, 1);
  });
});

describe("native repository initialization order cannot corrupt/skip migrations", () => {
  // Every real repository's getSchemaReadyConnection() now calls
  // runMigrations(db, MOBILE_MIGRATIONS) with the FULL catalog — see
  // active-projects-field-package.ts and project-work-package.ts — so
  // "which repository initializes first" no longer changes WHAT gets
  // requested, only WHEN. These tests call runMigrations() twice with
  // that same full catalog, simulating exactly that real call sequence.

  it("A: Active-Projects field-package repository initializes first, ProjectWorkPackage repository initializes second — both tables exist", async () => {
    const db = createFakeConnection();
    await runMigrations(db, MOBILE_MIGRATIONS); // simulates field-package's getSchemaReadyConnection()
    await runMigrations(db, MOBILE_MIGRATIONS); // simulates project-work-package's getSchemaReadyConnection(), later
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS field_package_projects")));
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS project_work_packages")));
    assert.deepEqual(db.appliedVersions.sort(), [1, 2, 3, 4, 5]);
    // The second call must not re-run already-applied migrations.
    assert.equal(db.executedSql.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS field_package_projects")).length, 1);
  });

  it("B: ProjectWorkPackage repository initializes FIRST on a fresh install, Active-Projects repository initializes second — neither schema is skipped merely because migration 2 was observed first", async () => {
    const db = createFakeConnection();
    await runMigrations(db, MOBILE_MIGRATIONS); // simulates project-work-package's getSchemaReadyConnection(), first
    await runMigrations(db, MOBILE_MIGRATIONS); // simulates field-package's getSchemaReadyConnection(), later
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS project_work_packages")));
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS field_package_projects")));
    assert.deepEqual(db.appliedVersions.sort(), [1, 2, 3, 4, 5]);
  });

  it("repeated initialization (e.g. every screen mount re-calling getSchemaReadyConnection()) is idempotent — no duplicate CREATE TABLE, no re-recorded version", async () => {
    const db = createFakeConnection();
    await runMigrations(db, MOBILE_MIGRATIONS);
    await runMigrations(db, MOBILE_MIGRATIONS);
    await runMigrations(db, MOBILE_MIGRATIONS);
    assert.equal(db.appliedVersions.length, 5, "each version recorded exactly once despite three initialization calls");
    assert.equal(
      db.executedSql.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS project_work_packages")).length,
      1,
    );
    assert.equal(db.executedSql.filter((sql) => sql.includes("ADD COLUMN primary_contact")).length, 1);
  });
});

describe("underlying pendingMigrations() mechanism — why order never actually corrupted even a distributed-slice design", () => {
  /**
   * Documents WHY the pre-consolidation layout (each file requesting only
   * its own narrow migration slice, e.g. field-package requesting just
   * [{version:1}] and project-work-package requesting just [{version:2}])
   * never actually risked skipping a migration due to call order:
   * pendingMigrations() (see database.ts) checks Set membership per exact
   * version number, never a "highest version applied so far" watermark —
   * so a later call requesting an EARLIER-numbered migration is never
   * wrongly treated as already covered by a HIGHER number observed first.
   * Consolidating into MOBILE_MIGRATIONS was still the right move for the
   * separate, real hazard proven by the "unique version numbers" test
   * above (two files silently claiming the same number) — not because
   * this order-independence property was ever actually broken.
   */
  it("observing a HIGHER version number first does not cause a LOWER version number requested later to be skipped", async () => {
    const db = createFakeConnection();
    const v2Only: SqlMigration[] = [MOBILE_MIGRATIONS[1]];
    const v1Only: SqlMigration[] = [MOBILE_MIGRATIONS[0]];
    await runMigrations(db, v2Only);
    await runMigrations(db, v1Only);
    assert.deepEqual(db.appliedVersions.sort(), [1, 2]);
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS field_package_projects")));
  });

  it("pendingMigrations itself: a migration already recorded as applied is never re-selected regardless of array order", () => {
    const result = pendingMigrations([2], [MOBILE_MIGRATIONS[1], MOBILE_MIGRATIONS[0]]);
    assert.deepEqual(
      result.map((m) => m.version),
      [1],
    );
  });
});
