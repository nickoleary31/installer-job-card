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
  {
    // Owner: lib/native/project-work-package.ts (Phase 2E) — adds the three
    // site-contact fields NewSubmissionForm's blank-form prefill genuinely
    // needs (see ProjectWorkPackage's own doc for the explicit, narrow
    // scoping rationale — deliberately NOT the rest of Site Info).
    version: 3,
    statements: [
      `ALTER TABLE project_work_packages ADD COLUMN primary_contact TEXT`,
      `ALTER TABLE project_work_packages ADD COLUMN contact_number TEXT`,
      `ALTER TABLE project_work_packages ADD COLUMN contact_email TEXT`,
    ],
  },
  {
    // Owner: lib/native/company-product-definitions.ts (Phase 2E). One row
    // per company_id — deliberately NOT user-scoped (see that file's own
    // doc): shared, reusable across every project/technician under the
    // same company, gated for actual USE by the existing lease +
    // ProjectWorkPackage checks rather than by a per-row ACL here.
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS company_product_definitions (
        company_id TEXT PRIMARY KEY NOT NULL,
        rows TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        synced_at TEXT NOT NULL
      )`,
    ],
  },
  {
    // Owner: lib/native/local-submission.ts (Phase 2F). One row per
    // localSubmissionId — a technician's own durable structured working
    // submission. See that file's own doc for why the bulk of the
    // structured work is one JSON payload column while identity/status are
    // normalized for the (user_id, project_id) resume query.
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS local_submissions (
        local_submission_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        status TEXT NOT NULL,
        form_id TEXT,
        submission_type TEXT,
        definition_schema_version INTEGER,
        selected_sections TEXT NOT NULL,
        payload TEXT NOT NULL,
        server_submission_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_local_submissions_user_project ON local_submissions(user_id, project_id)`,
    ],
  },
  {
    // Owner: lib/native/local-photo.ts (Phase 2G). One row per
    // localPhotoId — metadata/association ONLY, never image bytes (those
    // live in the app-private filesystem via lib/native/filesystem.ts,
    // addressed by filesystem_path). See that file's own doc for why file
    // I/O and metadata are deliberately split.
    version: 6,
    statements: [
      `CREATE TABLE IF NOT EXISTS local_photos (
        local_photo_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        local_submission_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        filesystem_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_local_photos_submission_field ON local_photos(local_submission_id, field_name)`,
    ],
  },
  {
    // Owner: lib/native/local-submission.ts, lib/native/local-photo.ts,
    // lib/native/local-submission-outbox.ts (Phase 2H). Three additive
    // changes shipped together as one version since they're all part of
    // the same technician-submit/outbox feature and none is independently
    // useful without the others:
    //  - local_submissions.technician_submitted_at: the explicit technician-
    //    submit transition, deliberately separate from `status`
    //    (working/locally-complete stays a pure editing-progress concept —
    //    see that column's own established doc).
    //  - local_photos.remote_storage_path/remote_uploaded_at: set once a
    //    LocalPhoto's bytes have actually been uploaded via the deterministic
    //    signed-upload path — see lib/local-photo.ts's own doc.
    //  - local_submission_outbox: one row per technician-submitted
    //    LocalSubmission, created ATOMICALLY with technician_submitted_at
    //    (same executeSet() transaction — see lib/native/local-submission.ts).
    //    Carries a FROZEN snapshot (payload/photos/hash) that sync/retry logic
    //    reads exclusively — never the live, possibly-since-changed
    //    local_submissions/local_photos rows. user_id/company_id/project_id
    //    are frozen here too rather than joined from the live row, for the
    //    same reason. claim_token/claimed_at implement a real compare-and-set
    //    single-worker claim (foreground-only — see that file's own doc).
    version: 7,
    statements: [
      `ALTER TABLE local_submissions ADD COLUMN technician_submitted_at TEXT`,
      `ALTER TABLE local_photos ADD COLUMN remote_storage_path TEXT`,
      `ALTER TABLE local_photos ADD COLUMN remote_uploaded_at TEXT`,
      `CREATE TABLE IF NOT EXISTS local_submission_outbox (
        local_submission_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        sync_state TEXT NOT NULL,
        claim_token TEXT,
        claimed_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        server_submission_id TEXT,
        snapshot_payload TEXT NOT NULL,
        snapshot_photos TEXT NOT NULL,
        snapshot_definition_schema_version INTEGER,
        snapshot_technician_submitted_at TEXT NOT NULL,
        submission_snapshot_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_local_submission_outbox_user_project ON local_submission_outbox(user_id, project_id)`,
    ],
  },
  {
    // Owner: lib/native/local-submission-outbox.ts (Phase 2H security
    // reconciliation). NULL for every pre-existing row and for any row
    // never yet failed (pending/syncing/server-confirmed) — only ever set
    // by recordOutboxSyncFailureViaConnection, distinguishing a failure
    // this device should keep retrying automatically (network/timeout/5xx —
    // 'retryable') from one it must not (project/company mismatch, 409
    // snapshot-hash conflict, 4xx validation — 'terminal'). See
    // lib/submission-sync.ts's classifySyncResponseStatus for the exact
    // status-code mapping, and buildSelectClaimableForUserSql's own doc for
    // why a terminal-classified 'failed' row is excluded from automatic
    // (and manual, via the same claim mechanism) retry.
    version: 8,
    statements: [`ALTER TABLE local_submission_outbox ADD COLUMN error_kind TEXT`],
  },
];
