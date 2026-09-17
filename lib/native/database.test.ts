import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEnsureSettingsTableSql,
  buildSelectSettingSql,
  buildUpsertSettingSql,
  pendingMigrations,
  runMigrations,
  type MigratableConnection,
  type SqlMigration,
} from "./database.ts";

describe("lib/native/database.ts SQL builders", () => {
  it("buildEnsureSettingsTableSql creates the app_settings table if missing", () => {
    const sql = buildEnsureSettingsTableSql();
    assert.match(sql, /CREATE TABLE IF NOT EXISTS app_settings/);
    assert.match(sql, /key TEXT PRIMARY KEY NOT NULL/);
    assert.match(sql, /value TEXT NOT NULL/);
  });

  it("buildUpsertSettingSql upserts by key", () => {
    const sql = buildUpsertSettingSql();
    assert.match(sql, /INSERT INTO app_settings \(key, value\) VALUES \(\?, \?\)/);
    assert.match(sql, /ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value/);
  });

  it("buildSelectSettingSql selects a single row by key", () => {
    const sql = buildSelectSettingSql();
    assert.match(sql, /SELECT value FROM app_settings WHERE key = \? LIMIT 1/);
  });
});

describe("lib/native/database.ts pendingMigrations (pure)", () => {
  const migrations: SqlMigration[] = [
    { version: 1, statements: ["CREATE TABLE a (id TEXT)"] },
    { version: 2, statements: ["CREATE TABLE b (id TEXT)"] },
    { version: 3, statements: ["CREATE TABLE c (id TEXT)"] },
  ];

  it("returns every migration when none are applied", () => {
    const result = pendingMigrations([], migrations);
    assert.deepEqual(
      result.map((m) => m.version),
      [1, 2, 3],
    );
  });

  it("excludes already-applied versions", () => {
    const result = pendingMigrations([1, 3], migrations);
    assert.deepEqual(
      result.map((m) => m.version),
      [2],
    );
  });

  it("returns nothing when every version is applied", () => {
    assert.deepEqual(pendingMigrations([1, 2, 3], migrations), []);
  });

  it("sorts pending migrations in ascending version order regardless of input order", () => {
    const shuffled = [migrations[2], migrations[0], migrations[1]];
    const result = pendingMigrations([], shuffled);
    assert.deepEqual(
      result.map((m) => m.version),
      [1, 2, 3],
    );
  });
});

/** Minimal in-memory fake standing in for a real SQLiteDBConnection, for runMigrations() behavior tests. */
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

describe("lib/native/database.ts runMigrations", () => {
  it("applies every migration in order and records each version", async () => {
    const db = createFakeConnection();
    const migrations: SqlMigration[] = [
      { version: 1, statements: ["CREATE TABLE a (id TEXT)"] },
      { version: 2, statements: ["CREATE TABLE b (id TEXT)"] },
    ];
    await runMigrations(db, migrations);
    assert.deepEqual(db.appliedVersions, [1, 2]);
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE a")));
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE b")));
  });

  it("does not re-apply a migration whose version is already recorded", async () => {
    const db = createFakeConnection();
    db.appliedVersions.push(1);
    const migrations: SqlMigration[] = [
      { version: 1, statements: ["CREATE TABLE a (id TEXT)"] },
      { version: 2, statements: ["CREATE TABLE b (id TEXT)"] },
    ];
    await runMigrations(db, migrations);
    assert.deepEqual(db.appliedVersions, [1, 2]);
    assert.ok(!db.executedSql.some((sql) => sql.includes("CREATE TABLE a")));
    assert.ok(db.executedSql.some((sql) => sql.includes("CREATE TABLE b")));
  });

  it("is a no-op when every migration is already applied", async () => {
    const db = createFakeConnection();
    db.appliedVersions.push(1, 2);
    const migrations: SqlMigration[] = [
      { version: 1, statements: ["CREATE TABLE a (id TEXT)"] },
      { version: 2, statements: ["CREATE TABLE b (id TEXT)"] },
    ];
    await runMigrations(db, migrations);
    assert.deepEqual(db.appliedVersions, [1, 2]);
    // The migrations-tracking table itself is always (idempotently) ensured;
    // only the two feature migrations' own statements must not re-run.
    assert.ok(!db.executedSql.some((sql) => sql.includes("CREATE TABLE a") || sql.includes("CREATE TABLE b")));
  });
});
