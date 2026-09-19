import { getNativeSqliteConnection, runMigrations } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";
import type {
  CompanyProductDefinitionsPackage,
  CompanyProductDefinitionsRepository,
} from "../product-config/company-product-definitions.ts";
import type { CompanyFormProductRow } from "../product-config/types.ts";

/**
 * Phase 2E native implementation. One row per company_id — `rows` (the raw
 * company_form_products rows, exactly as the online API would return them)
 * is stored as a single JSON TEXT column rather than normalized into a
 * child table: this is a small, inherently list-shaped, company-scoped
 * blob, and resolveCompanyProducts()/normalizeDatabaseProductRow() (both
 * pure) already do the real normalization work identically whether the
 * rows came from a live fetch or this cache — see
 * lib/product-config/company-product-definitions.ts's own doc.
 *
 * Schema (version 4) lives in mobile-migrations.ts's single canonical
 * catalog, not here — see that file's doc comment for why.
 */
const TABLE = "company_product_definitions";
const CURRENT_SCHEMA_VERSION = 1;

function buildUpsertSql(): string {
  return `INSERT INTO ${TABLE} (company_id, rows, schema_version, synced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      rows = excluded.rows,
      schema_version = excluded.schema_version,
      synced_at = excluded.synced_at`;
}

function buildSelectSql(): string {
  return `SELECT rows, schema_version, synced_at FROM ${TABLE} WHERE company_id = ?`;
}

function buildDeleteSql(): string {
  return `DELETE FROM ${TABLE} WHERE company_id = ?`;
}

type PackageRow = {
  rows: string;
  schema_version: number;
  synced_at: string;
};

/** Minimal shape this file needs from a SQLiteDBConnection-like object. */
export interface RunQueryConnection {
  run(statement: string, values?: unknown[]): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
}

/**
 * Pure — the exact upsert statement/values, split out so it's
 * unit-testable without a database — see company-product-definitions.test.ts.
 * A single INSERT ... ON CONFLICT DO UPDATE is atomic by SQLite's own
 * single-statement guarantee: it either fully applies or fully rejects,
 * leaving any previous row for this companyId untouched on failure.
 */
export function buildUpsertStatement(
  companyId: string,
  rows: readonly CompanyFormProductRow[],
  syncedAt: string,
): { statement: string; values: unknown[] } {
  return {
    statement: buildUpsertSql(),
    values: [companyId, JSON.stringify(rows), CURRENT_SCHEMA_VERSION, syncedAt],
  };
}

/** Connection-agnostic save, injectable for testing without a real device — see company-product-definitions.test.ts. */
export async function saveViaConnection(
  db: RunQueryConnection,
  companyId: string,
  rows: readonly CompanyFormProductRow[],
): Promise<{ syncedAt: string }> {
  const syncedAt = new Date().toISOString();
  const { statement, values } = buildUpsertStatement(companyId, rows, syncedAt);
  await db.run(statement, values);
  return { syncedAt };
}

/**
 * Pure — decodes the stored `rows` JSON TEXT column. Split out so the
 * fail-closed behavior on malformed JSON is unit-testable without a
 * database — see company-product-definitions.test.ts. Malformed JSON (or
 * valid JSON that isn't an array) fails closed to an empty product list
 * rather than throwing — the registry fallback inside
 * resolveCompanyProducts() takes over from there.
 */
export function parseStoredRows(raw: string): CompanyFormProductRow[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CompanyFormProductRow[]) : [];
  } catch {
    return [];
  }
}

async function getSchemaReadyConnection() {
  const db = await getNativeSqliteConnection();
  await runMigrations(db, MOBILE_MIGRATIONS);
  return db;
}

export class NativeCompanyProductDefinitions implements CompanyProductDefinitionsRepository {
  async saveCompanyProductDefinitions(
    companyId: string,
    rows: readonly CompanyFormProductRow[],
  ): Promise<{ syncedAt: string }> {
    const db = await getSchemaReadyConnection();
    return saveViaConnection(db, companyId, rows);
  }

  async loadCompanyProductDefinitions(companyId: string): Promise<CompanyProductDefinitionsPackage | null> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectSql(), [companyId]);
    const row = result.values?.[0] as unknown as PackageRow | undefined;
    if (!row) return null;
    return {
      companyId,
      rows: parseStoredRows(row.rows),
      schemaVersion: row.schema_version,
      syncedAt: row.synced_at,
    };
  }

  async clearCompanyProductDefinitions(companyId: string): Promise<void> {
    const db = await getSchemaReadyConnection();
    await db.run(buildDeleteSql(), [companyId]);
  }
}

export function getNativeCompanyProductDefinitions(): CompanyProductDefinitionsRepository {
  return new NativeCompanyProductDefinitions();
}
