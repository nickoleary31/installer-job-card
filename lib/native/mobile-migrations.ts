import type { SqlMigration } from "./database.ts";

/**
 * The single canonical, ordered catalog of every native SQLite migration
 * across every lib/native/*-package.ts repository.
 *
 * WHY THIS EXISTS: mobile_schema_migrations is one shared table on the one
 * shared native connection (see database.ts) — version numbers are GLOBAL
 * across every repository, not scoped per file. Before this file existed,
 * each repository declared its own small MIGRATIONS array with its own
 * hand-picked version number (Phase 2B's field-package claimed 1, Phase
 * 2D's project-work-package claimed 2). That was proven order-safe
 * regardless of which repository's getSchemaReadyConnection() ran first —
 * pendingMigrations() (see database.ts) checks Set membership per version
 * number, not a "highest applied so far" watermark, so a later call
 * requesting an earlier-numbered migration is never wrongly treated as
 * already covered by a higher number seen first (see
 * mobile-migrations.test.ts's order-independence proof of the underlying
 * mechanism). But that distributed layout had a real, separate hazard: two
 * files could accidentally claim the SAME version number with no way to
 * notice at edit time, silently skipping one file's CREATE TABLE forever
 * (a "version already applied" false positive) — exactly what "Do NOT
 * keep globally numbered migrations distributed across unrelated modules"
 * warns about. Consolidating every migration into one file, in one array,
 * makes a duplicate version number an immediately visible mistake (and one
 * mobile-migrations.test.ts asserts against), and makes "what's version N"
 * answerable by reading one file instead of grepping the whole tree.
 *
 * Every native repository's getSchemaReadyConnection() calls
 * runMigrations(db, MOBILE_MIGRATIONS) with this FULL catalog, never a
 * narrowed slice — so which repository happens to be touched first no
 * longer matters at all: whichever runs first simply applies everything
 * currently pending.
 *
 * Append new versions here — never edit a version already shipped, and
 * never reuse a number.
 */
export const MOBILE_MIGRATIONS: readonly SqlMigration[] = [
  {
    // Owner: lib/native/active-projects-field-package.ts (Phase 2B).
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS field_package_metadata (
        user_id TEXT PRIMARY KEY NOT NULL,
        synced_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS field_package_projects (
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
      `CREATE INDEX IF NOT EXISTS idx_field_package_projects_user ON field_package_projects(user_id)`,
    ],
  },
  {
    // Owner: lib/native/project-work-package.ts (Phase 2D).
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS project_work_packages (
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_account_name TEXT,
        location TEXT NOT NULL,
        zoho_linked INTEGER NOT NULL,
        zoho_work_order_number TEXT,
        zoho_service_appointment_number TEXT,
        zoho_summary TEXT,
        schema_version INTEGER NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, project_id)
      )`,
    ],
  },
];
