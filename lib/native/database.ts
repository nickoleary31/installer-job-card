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
 * @capacitor-community/sqlite is dynamically imported, only ever inside a
 * native runtime — never at module-load time, so it can never affect the
 * root Next build, SSR, or the plain-browser web app, even though this file
 * itself is safe to import anywhere (see lib/native/runtime.ts's own
 * comment on the same pattern).
 */
class NativeSqliteDatabase implements AppDatabase {
  private connection: Promise<import("@capacitor-community/sqlite").SQLiteDBConnection> | null = null;

  private getConnection() {
    if (!this.connection) {
      this.connection = (async () => {
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
    return this.connection;
  }

  async getSetting(key: string): Promise<string | null> {
    const db = await this.getConnection();
    const result = await db.query(buildSelectSettingSql(), [key]);
    const row = result.values?.[0] as { value?: string } | undefined;
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = await this.getConnection();
    await db.run(buildUpsertSettingSql(), [key, value]);
  }
}

/**
 * @capacitor-community/sqlite's `SQLiteConnection.isConnection()` tracks
 * open connections in that JS wrapper instance's own dictionary, not in the
 * native layer — a second wrapper instance has no way to see a connection
 * the first one opened, so it re-attempts `createConnection()` and the
 * native side (which does know) rejects it as a duplicate. One shared
 * instance for the app's lifetime avoids that, matching how the plugin is
 * meant to be used. Confirmed via runtime testing: getSetting() failed with
 * "CreateConnection: Connection installer_sheetz_native already exists"
 * when getAppDatabase() returned a fresh instance per call.
 */
let nativeDatabaseSingleton: NativeSqliteDatabase | null = null;

export function getAppDatabase(): AppDatabase {
  if (!isNativeRuntime()) return new WebDatabaseNotImplemented();
  if (!nativeDatabaseSingleton) nativeDatabaseSingleton = new NativeSqliteDatabase();
  return nativeDatabaseSingleton;
}
