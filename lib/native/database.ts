import { isNativeRuntime } from "./runtime.ts";

/**
 * Boundary interface only (Phase 2A) — a generic key/value settings surface,
 * NOT the final operational schema (companies/projects/drafts/photos/outbox
 * all still live where they already do: Supabase, or lib/installer-offline-db.ts's
 * IndexedDB on web). This exists purely to prove the native SQLite plumbing
 * (connect, create table, write, read back after reconnecting) works, before
 * any real schema is designed. Nothing in the app calls this yet.
 */
export interface AppDatabase {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

const SETTINGS_TABLE = "app_settings";

/**
 * Pure SQL-string builders, split out from the native connection logic
 * specifically so they're unit-testable without a device or a real SQLite
 * engine — see lib/native/database.test.ts.
 */
export function buildEnsureSettingsTableSql(): string {
  return `CREATE TABLE IF NOT EXISTS ${SETTINGS_TABLE} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`;
}

export function buildUpsertSettingSql(): string {
  return `INSERT INTO ${SETTINGS_TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

export function buildSelectSettingSql(): string {
  return `SELECT value FROM ${SETTINGS_TABLE} WHERE key = ? LIMIT 1`;
}

/**
 * The web app has its own working local-first store already
 * (lib/installer-offline-db.ts, IndexedDB) and doesn't need this interface —
 * this stub exists only so getAppDatabase() has a defined return for every
 * platform, matching the other lib/native/* boundaries' shape.
 */
class WebDatabaseNotImplemented implements AppDatabase {
  getSetting(): Promise<string | null> {
    throw new Error(
      "Native database is not implemented for the web runtime. The web app continues to use lib/installer-offline-db.ts (IndexedDB) directly.",
    );
  }
  setSetting(): Promise<void> {
    throw new Error(
      "Native database is not implemented for the web runtime. The web app continues to use lib/installer-offline-db.ts (IndexedDB) directly.",
    );
  }
}

const DB_NAME = "installer_sheetz_native";

/**
 * One shared native SQLite connection for the app's entire lifetime.
 * @capacitor-community/sqlite's `SQLiteConnection.isConnection()` tracks
 * open connections in that JS wrapper instance's own dictionary, not in the
 * native layer — a second wrapper instance has no way to see a connection
 * the first one opened, so it re-attempts `createConnection()` and the
 * native side (which does know) rejects it as a duplicate. Confirmed via
 * Phase 2A runtime testing: a query failed with "CreateConnection:
 * Connection installer_sheetz_native already exists" when a fresh wrapper
 * instance was created per call. Every native SQLite consumer in this app —
 * this file's own settings proof AND feature repositories like
 * lib/native/active-projects-field-package.ts — must go through
 * getNativeSqliteConnection() below, never construct their own
 * SQLiteConnection/createConnection call.
 *
 * Dynamically imported inside the async body, never at module load, so this
 * file stays safe to import from the root Next build, SSR, or plain-browser
 * web app (see lib/native/runtime.ts's own comment on the same pattern).
 */
let nativeConnectionPromise: Promise<import("@capacitor-community/sqlite").SQLiteDBConnection> | null = null;

function getNativeConnection() {
  if (!nativeConnectionPromise) {
    nativeConnectionPromise = (async () => {
      const { CapacitorSQLite, SQLiteConnection } = await import("@capacitor-community/sqlite");
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      const alreadyOpen = (await sqlite.isConnection(DB_NAME, false)).result;
      const db = alreadyOpen
        ? await sqlite.retrieveConnection(DB_NAME, false)
        : await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
      await db.open();
      await db.execute(buildEnsureSettingsTableSql());
      return db;
    })();
  }
  return nativeConnectionPromise;
}

/**
 * Native-only escape hatch for feature repositories that need their own
 * schema (e.g. Phase 2B's active-projects field package) — returns the same
 * shared connection this file's own settings proof uses, never a second
 * one. Throws on web; the web app never needs this, it uses
 * lib/installer-offline-db.ts (IndexedDB) directly.
 */
export async function getNativeSqliteConnection(): Promise<import("@capacitor-community/sqlite").SQLiteDBConnection> {
  if (!isNativeRuntime()) {
    throw new Error("Native SQLite is not available outside the native runtime.");
  }
  return getNativeConnection();
}

class NativeSqliteDatabase implements AppDatabase {
  async getSetting(key: string): Promise<string | null> {
    const db = await getNativeConnection();
    const result = await db.query(buildSelectSettingSql(), [key]);
    const row = result.values?.[0] as { value?: string } | undefined;
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = await getNativeConnection();
    await db.run(buildUpsertSettingSql(), [key, value]);
  }
}

const nativeDatabaseSingleton = new NativeSqliteDatabase();
const webDatabaseSingleton = new WebDatabaseNotImplemented();

export function getAppDatabase(): AppDatabase {
  return isNativeRuntime() ? nativeDatabaseSingleton : webDatabaseSingleton;
}

/**
 * A single SQL migration: an ordered set of statements applied together and
 * recorded as one version in `mobile_schema_migrations`. Add new versions by
 * appending — never edit a version already shipped.
 */
export type SqlMigration = {
  version: number;
  statements: readonly string[];
};

/** Minimal shape any SQLiteDBConnection-like object needs for runMigrations(). */
export interface MigratableConnection {
  execute(statements: string): Promise<unknown>;
  run(statement: string, values?: unknown[]): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
}

const MIGRATIONS_TABLE = "mobile_schema_migrations";

export function buildEnsureMigrationsTableSql(): string {
  return `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`;
}

export function buildSelectAppliedMigrationVersionsSql(): string {
  return `SELECT version FROM ${MIGRATIONS_TABLE}`;
}

export function buildInsertMigrationVersionSql(): string {
  return `INSERT INTO ${MIGRATIONS_TABLE} (version, applied_at) VALUES (?, ?)`;
}

/**
 * Pure — given the versions already recorded as applied and the full
 * migration list, returns the ones still needed, in ascending version
 * order. Unit-testable without any database — see database.test.ts.
 */
export function pendingMigrations(
  appliedVersions: readonly number[],
  migrations: readonly SqlMigration[],
): SqlMigration[] {
  const applied = new Set(appliedVersions);
  return migrations.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
}

/**
 * Applies every not-yet-applied migration, in order, each as its own
 * `db.execute()` call (multiple `;`-separated statements run as one
 * transaction per the plugin's own `execute()` contract) followed by a
 * recorded version row. Safe to call every time a connection is acquired —
 * idempotent given migrations already applied.
 */
export async function runMigrations(db: MigratableConnection, migrations: readonly SqlMigration[]): Promise<void> {
  await db.execute(buildEnsureMigrationsTableSql());
  const result = await db.query(buildSelectAppliedMigrationVersionsSql());
  const appliedVersions = (result.values ?? []).map((row) => Number(row.version));
  for (const migration of pendingMigrations(appliedVersions, migrations)) {
    await db.execute(migration.statements.join(";\n"));
    await db.run(buildInsertMigrationVersionSql(), [migration.version, new Date().toISOString()]);
  }
}
