import { getNativeSqliteConnection, runMigrations } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";
import type { ProjectWorkPackage, ProjectWorkPackageInput, ProjectWorkPackageRepository } from "../project-work-package.ts";

/**
 * Phase 2D native implementation. One row per (user_id, project_id) — unlike
 * Phase 2B's field-package (one user, many project rows, plus a separate
 * metadata row), a project work package is already a single self-contained
 * snapshot, so synced_at/schema_version live directly on its own row rather
 * than a second table.
 *
 * Schema (version 2) lives in mobile-migrations.ts's single canonical
 * catalog, not here — see that file's doc comment for why (version numbers
 * in mobile_schema_migrations are GLOBAL across every native repository).
 */
const TABLE = "project_work_packages";
const CURRENT_SCHEMA_VERSION = 1;

function buildUpsertSql(): string {
  return `INSERT INTO ${TABLE} (
      user_id, project_id, company_id, company_name, project_name,
      customer_name, customer_account_name, location,
      zoho_linked, zoho_work_order_number, zoho_service_appointment_number, zoho_summary,
      schema_version, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET
      company_id = excluded.company_id,
      company_name = excluded.company_name,
      project_name = excluded.project_name,
      customer_name = excluded.customer_name,
      customer_account_name = excluded.customer_account_name,
      location = excluded.location,
      zoho_linked = excluded.zoho_linked,
      zoho_work_order_number = excluded.zoho_work_order_number,
      zoho_service_appointment_number = excluded.zoho_service_appointment_number,
      zoho_summary = excluded.zoho_summary,
      schema_version = excluded.schema_version,
      synced_at = excluded.synced_at`;
}

/**
 * Phase 2D.1 — the provisioning-time upsert: same shape as buildUpsertSql(),
 * but its ON CONFLICT clause deliberately OMITS the zoho_* columns. This is
 * called in bulk right after an Active Projects sync, which only ever
 * knows zohoLinked:false/nulls (see lib/project-work-package.ts's
 * buildProvisionedProjectWorkPackages()) — overwriting real enrichment a
 * prior Project Detail online visit already wrote would silently regress
 * the offline copy. A first-time INSERT for a never-before-seen project
 * still gets the caller's zoho_* values (i.e. the nulls), since there is
 * no existing row to preserve.
 */
function buildProvisionUpsertSql(): string {
  return `INSERT INTO ${TABLE} (
      user_id, project_id, company_id, company_name, project_name,
      customer_name, customer_account_name, location,
      zoho_linked, zoho_work_order_number, zoho_service_appointment_number, zoho_summary,
      schema_version, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET
      company_id = excluded.company_id,
      company_name = excluded.company_name,
      project_name = excluded.project_name,
      customer_name = excluded.customer_name,
      customer_account_name = excluded.customer_account_name,
      location = excluded.location,
      schema_version = excluded.schema_version,
      synced_at = excluded.synced_at`;
}

/** Deletes every package for this user NOT in the given authorized projectId set — the stale-package prune step. Must be paired with at least one authorized id (see buildProvisionStatementSet for the zero-projects case). */
function buildPruneStaleSql(projectIds: readonly string[]): string {
  const placeholders = projectIds.map(() => "?").join(", ");
  return `DELETE FROM ${TABLE} WHERE user_id = ? AND project_id NOT IN (${placeholders})`;
}

function buildDeleteAllForUserSql(): string {
  return `DELETE FROM ${TABLE} WHERE user_id = ?`;
}

function buildSelectSql(): string {
  return `SELECT company_id, company_name, project_name, customer_name, customer_account_name, location,
      zoho_linked, zoho_work_order_number, zoho_service_appointment_number, zoho_summary,
      schema_version, synced_at
    FROM ${TABLE} WHERE user_id = ? AND project_id = ?`;
}

function buildDeleteSql(): string {
  return `DELETE FROM ${TABLE} WHERE user_id = ? AND project_id = ?`;
}

type PackageRow = {
  company_id: string;
  company_name: string;
  project_name: string;
  customer_name: string;
  customer_account_name: string | null;
  location: string;
  zoho_linked: number;
  zoho_work_order_number: string | null;
  zoho_service_appointment_number: string | null;
  zoho_summary: string | null;
  schema_version: number;
  synced_at: string;
};

/** Minimal shape this file needs from a SQLiteDBConnection-like object. */
export interface RunQueryConnection {
  run(statement: string, values?: unknown[]): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
}

export type SqlSetStatement = { statement: string; values: unknown[] };

/** Minimal shape provisionViaConnection() needs — matches SQLiteDBConnection.executeSet(). */
export interface ExecuteSetConnection {
  executeSet(set: SqlSetStatement[], transaction: boolean): Promise<unknown>;
}

/**
 * Pure — the exact upsert statement/values, split out so it's
 * unit-testable without a database — see project-work-package.test.ts. A
 * single INSERT ... ON CONFLICT DO UPDATE is atomic by SQLite's own
 * single-statement guarantee: it either fully applies or fully rejects,
 * leaving any previous row for this (userId, projectId) untouched on
 * failure — no explicit transaction wrapper needed.
 */
export function buildUpsertStatement(pkg: ProjectWorkPackageInput, syncedAt: string): { statement: string; values: unknown[] } {
  return {
    statement: buildUpsertSql(),
    values: [
      pkg.userId,
      pkg.projectId,
      pkg.companyId,
      pkg.companyName,
      pkg.projectName,
      pkg.customerName,
      pkg.customerAccountName,
      pkg.location,
      pkg.zohoLinked ? 1 : 0,
      pkg.zohoWorkOrderNumber,
      pkg.zohoServiceAppointmentNumber,
      pkg.zohoSummary,
      CURRENT_SCHEMA_VERSION,
      syncedAt,
    ],
  };
}

/** Connection-agnostic save, injectable for testing without a real device — see project-work-package.test.ts. */
export async function saveViaConnection(db: RunQueryConnection, pkg: ProjectWorkPackageInput): Promise<{ syncedAt: string }> {
  const syncedAt = new Date().toISOString();
  const { statement, values } = buildUpsertStatement(pkg, syncedAt);
  await db.run(statement, values);
  return { syncedAt };
}

/**
 * Phase 2D.1 — pure — the exact statement set a bulk provisioning pass must
 * run atomically: prune this user's packages that are no longer in the
 * authorized set, then upsert (zoho-preserving) each authorized package.
 * Split out so the statement order/shape is unit-testable without a
 * database — see project-work-package.test.ts. An empty authorized set is
 * a legitimate "this user can currently see zero projects" result, not an
 * error — it prunes everything for that user via buildDeleteAllForUserSql()
 * rather than a malformed empty `NOT IN ()`.
 */
export function buildProvisionStatementSet(
  userId: string,
  packages: readonly ProjectWorkPackageInput[],
  syncedAt: string,
): SqlSetStatement[] {
  const projectIds = packages.map((p) => p.projectId);
  const pruneStatement: SqlSetStatement =
    projectIds.length > 0
      ? { statement: buildPruneStaleSql(projectIds), values: [userId, ...projectIds] }
      : { statement: buildDeleteAllForUserSql(), values: [userId] };
  return [
    pruneStatement,
    ...packages.map((pkg) => ({
      statement: buildProvisionUpsertSql(),
      values: [
        pkg.userId,
        pkg.projectId,
        pkg.companyId,
        pkg.companyName,
        pkg.projectName,
        pkg.customerName,
        pkg.customerAccountName,
        pkg.location,
        pkg.zohoLinked ? 1 : 0,
        pkg.zohoWorkOrderNumber,
        pkg.zohoServiceAppointmentNumber,
        pkg.zohoSummary,
        CURRENT_SCHEMA_VERSION,
        syncedAt,
      ],
    })),
  ];
}

/**
 * Connection-agnostic bulk provisioning, injectable for testing the atomic-
 * transaction contract with a fake connection (see
 * project-work-package.test.ts) without a real device. executeSet's own
 * transaction=true contract rejects (and rolls back every statement in the
 * set) on any failure, so a partial network/write failure during
 * provisioning leaves every previously valid package — stale or not —
 * exactly as it was; nothing is pruned or overwritten unless the WHOLE
 * batch commits.
 */
export async function provisionViaConnection(
  db: ExecuteSetConnection,
  userId: string,
  packages: readonly ProjectWorkPackageInput[],
): Promise<{ syncedAt: string }> {
  const syncedAt = new Date().toISOString();
  await db.executeSet(buildProvisionStatementSet(userId, packages, syncedAt), true);
  return { syncedAt };
}

async function getSchemaReadyConnection() {
  const db = await getNativeSqliteConnection();
  await runMigrations(db, MOBILE_MIGRATIONS);
  return db;
}

export class NativeProjectWorkPackage implements ProjectWorkPackageRepository {
  async saveProjectWorkPackage(pkg: ProjectWorkPackageInput): Promise<{ syncedAt: string }> {
    const db = await getSchemaReadyConnection();
    return saveViaConnection(db, pkg);
  }

  async loadProjectWorkPackage(userId: string, projectId: string): Promise<ProjectWorkPackage | null> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectSql(), [userId, projectId]);
    const row = result.values?.[0] as unknown as PackageRow | undefined;
    if (!row) return null;
    return {
      userId,
      projectId,
      companyId: row.company_id,
      companyName: row.company_name,
      projectName: row.project_name,
      customerName: row.customer_name,
      customerAccountName: row.customer_account_name,
      location: row.location,
      zohoLinked: row.zoho_linked === 1,
      zohoWorkOrderNumber: row.zoho_work_order_number,
      zohoServiceAppointmentNumber: row.zoho_service_appointment_number,
      zohoSummary: row.zoho_summary,
      schemaVersion: row.schema_version,
      syncedAt: row.synced_at,
    };
  }

  async clearProjectWorkPackage(userId: string, projectId: string): Promise<void> {
    const db = await getSchemaReadyConnection();
    await db.run(buildDeleteSql(), [userId, projectId]);
  }

  async provisionProjectWorkPackages(userId: string, packages: readonly ProjectWorkPackageInput[]): Promise<{ syncedAt: string }> {
    const db = await getSchemaReadyConnection();
    return provisionViaConnection(db, userId, packages);
  }
}

export function getNativeProjectWorkPackage(): ProjectWorkPackageRepository {
  return new NativeProjectWorkPackage();
}
