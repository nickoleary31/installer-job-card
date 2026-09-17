import { getNativeSqliteConnection, runMigrations, type SqlMigration } from "./database.ts";
import type {
  ActiveProjectsFieldPackage,
  ActiveProjectsSnapshot,
  FieldPackageProject,
  SnapshotMetadata,
} from "../active-projects-field-package.ts";

/**
 * Phase 2B native implementation — real business data (the technician's
 * authorized active-project list), NOT the Phase 2A app_settings proof
 * table. Normalized rows (one per project) rather than a single JSON blob,
 * so future incremental sync can update individual rows without rewriting
 * the whole package; see lib/active-projects-field-package.ts for the
 * shared interface, DTOs, and web (IndexedDB) implementation.
 */
const PROJECTS_TABLE = "field_package_projects";
const METADATA_TABLE = "field_package_metadata";
const CURRENT_SCHEMA_VERSION = 1;

const MIGRATIONS: readonly SqlMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS ${METADATA_TABLE} (
        user_id TEXT PRIMARY KEY NOT NULL,
        synced_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        display_customer_name TEXT NOT NULL,
        display_location TEXT NOT NULL,
        completed_submission_count INTEGER NOT NULL,
        active INTEGER NOT NULL,
        PRIMARY KEY (user_id, project_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_field_package_projects_user ON ${PROJECTS_TABLE}(user_id)`,
    ],
  },
];

function buildDeleteUserProjectsSql(): string {
  return `DELETE FROM ${PROJECTS_TABLE} WHERE user_id = ?`;
}

function buildInsertProjectSql(): string {
  return `INSERT INTO ${PROJECTS_TABLE} (user_id, project_id, company_id, company_name, project_name, display_customer_name, display_location, completed_submission_count, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

function buildUpsertMetadataSql(): string {
  return `INSERT INTO ${METADATA_TABLE} (user_id, synced_at, schema_version) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET synced_at = excluded.synced_at, schema_version = excluded.schema_version`;
}

function buildSelectProjectsSql(): string {
  return `SELECT project_id, company_id, company_name, project_name, display_customer_name, display_location, completed_submission_count, active FROM ${PROJECTS_TABLE} WHERE user_id = ?`;
}

function buildSelectMetadataSql(): string {
  return `SELECT synced_at, schema_version FROM ${METADATA_TABLE} WHERE user_id = ?`;
}

function buildDeleteMetadataSql(): string {
  return `DELETE FROM ${METADATA_TABLE} WHERE user_id = ?`;
}

function buildCountProjectsSql(): string {
  return `SELECT COUNT(*) as count FROM ${PROJECTS_TABLE} WHERE user_id = ?`;
}

type ProjectRow = {
  project_id: string;
  company_id: string;
  company_name: string;
  project_name: string;
  display_customer_name: string;
  display_location: string;
  completed_submission_count: number;
  active: number;
};

export type SqlSetStatement = { statement: string; values: unknown[] };

/**
 * Pure — the exact set of statements a save must run atomically: delete this
 * user's previous rows, insert the new ones, upsert the sync timestamp.
 * Split out from saveViaConnection() so the statement order/shape is
 * unit-testable without a database — see active-projects-field-package.test.ts.
 */
export function buildSaveSnapshotStatementSet(
  userId: string,
  projects: readonly FieldPackageProject[],
  syncedAt: string,
): SqlSetStatement[] {
  return [
    { statement: buildDeleteUserProjectsSql(), values: [userId] },
    ...projects.map((p) => ({
      statement: buildInsertProjectSql(),
      values: [
        userId,
        p.projectId,
        p.companyId,
        p.companyName,
        p.projectName,
        p.displayCustomerName,
        p.displayLocation,
        p.completedSubmissionCount,
        p.active ? 1 : 0,
      ],
    })),
    { statement: buildUpsertMetadataSql(), values: [userId, syncedAt, CURRENT_SCHEMA_VERSION] },
  ];
}

/** Minimal shape saveViaConnection() needs — matches SQLiteDBConnection.executeSet(). */
export interface ExecuteSetConnection {
  executeSet(set: SqlSetStatement[], transaction: boolean): Promise<unknown>;
}

/**
 * Connection-agnostic save, injectable for testing the atomic-transaction
 * contract with a fake connection (see active-projects-field-package.test.ts)
 * without touching a real device's SQLite database. executeSet's own
 * transaction=true contract rejects (and rolls back every statement in the
 * set) on any failure, so the previous package's rows and metadata are left
 * exactly as they were — the resolved syncedAt is only ever returned once
 * the whole set has actually committed.
 */
export async function saveViaConnection(
  db: ExecuteSetConnection,
  userId: string,
  projects: readonly FieldPackageProject[],
): Promise<{ syncedAt: string }> {
  const syncedAt = new Date().toISOString();
  await db.executeSet(buildSaveSnapshotStatementSet(userId, projects, syncedAt), true);
  return { syncedAt };
}

async function getSchemaReadyConnection() {
  const db = await getNativeSqliteConnection();
  await runMigrations(db, MIGRATIONS);
  return db;
}

export class NativeActiveProjectsFieldPackage implements ActiveProjectsFieldPackage {
  async saveActiveProjectsSnapshot(userId: string, projects: readonly FieldPackageProject[]): Promise<{ syncedAt: string }> {
    const db = await getSchemaReadyConnection();
    return saveViaConnection(db, userId, projects);
  }

  async loadActiveProjectsSnapshot(userId: string): Promise<ActiveProjectsSnapshot | null> {
    const db = await getSchemaReadyConnection();
    const metaResult = await db.query(buildSelectMetadataSql(), [userId]);
    const meta = metaResult.values?.[0] as { synced_at?: string; schema_version?: number } | undefined;
    if (!meta) return null;

    const projectsResult = await db.query(buildSelectProjectsSql(), [userId]);
    const rows = (projectsResult.values ?? []) as unknown as ProjectRow[];
    const projects: FieldPackageProject[] = rows.map((row) => ({
      projectId: row.project_id,
      companyId: row.company_id,
      companyName: row.company_name,
      projectName: row.project_name,
      displayCustomerName: row.display_customer_name,
      displayLocation: row.display_location,
      completedSubmissionCount: row.completed_submission_count,
      active: row.active === 1,
    }));

    return {
      userId,
      syncedAt: meta.synced_at ?? syncedAtFallback(),
      schemaVersion: meta.schema_version ?? CURRENT_SCHEMA_VERSION,
      projects,
    };
  }

  async getSnapshotMetadata(userId: string): Promise<SnapshotMetadata> {
    const db = await getSchemaReadyConnection();
    const metaResult = await db.query(buildSelectMetadataSql(), [userId]);
    const meta = metaResult.values?.[0] as { synced_at?: string; schema_version?: number } | undefined;
    if (!meta) return null;

    const countResult = await db.query(buildCountProjectsSql(), [userId]);
    const countRow = countResult.values?.[0] as { count?: number } | undefined;

    return {
      userId,
      syncedAt: meta.synced_at ?? syncedAtFallback(),
      schemaVersion: meta.schema_version ?? CURRENT_SCHEMA_VERSION,
      projectCount: countRow?.count ?? 0,
    };
  }

  async clearSnapshotForUser(userId: string): Promise<void> {
    const db = await getSchemaReadyConnection();
    await db.executeSet(
      [
        { statement: buildDeleteUserProjectsSql(), values: [userId] },
        { statement: buildDeleteMetadataSql(), values: [userId] },
      ],
      true,
    );
  }
}

/** Should be unreachable — synced_at is NOT NULL — but keeps the mapper total without a non-null assertion. */
function syncedAtFallback(): string {
  return new Date(0).toISOString();
}

export function getNativeActiveProjectsFieldPackage(): ActiveProjectsFieldPackage {
  return new NativeActiveProjectsFieldPackage();
}
