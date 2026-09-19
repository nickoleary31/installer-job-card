import { getNativeSqliteConnection, runMigrations } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";
import type { LocalSubmission, LocalSubmissionInput, LocalSubmissionRepository } from "../local-submission.ts";

/**
 * Phase 2F native implementation. One row per localSubmissionId. The
 * structured technician work (per-product field bags — coreJob, vac4, ppd,
 * cp4, linxup, sscSpeed, installedProductSystems, etc.) is stored as a
 * single JSON TEXT `payload` column rather than normalized into child
 * tables — deliberately: nothing in that shape needs independent SQL
 * querying (no cross-submission photo/device queries exist), and the exact
 * same shape is already produced by NewSubmissionForm.tsx's existing
 * buildCurrentDraftData(). Identity/status/resume-query columns ARE
 * normalized because (userId, projectId, status) genuinely needs to be
 * queried — see buildSelectWorkingByUserProjectSql().
 *
 * Schema (version 5) lives in mobile-migrations.ts's single canonical
 * catalog, not here — see that file's doc comment for why.
 */
const TABLE = "local_submissions";

function buildUpsertSql(): string {
  return `INSERT INTO ${TABLE} (
      local_submission_id, user_id, project_id, company_id, status,
      form_id, submission_type, definition_schema_version,
      selected_sections, payload, server_submission_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_submission_id) DO UPDATE SET
      user_id = excluded.user_id,
      project_id = excluded.project_id,
      company_id = excluded.company_id,
      status = excluded.status,
      form_id = excluded.form_id,
      submission_type = excluded.submission_type,
      definition_schema_version = excluded.definition_schema_version,
      selected_sections = excluded.selected_sections,
      payload = excluded.payload,
      server_submission_id = excluded.server_submission_id,
      updated_at = excluded.updated_at`;
  // created_at deliberately omitted from the UPDATE SET — an existing row
  // keeps the created_at value from its original INSERT; only a genuinely
  // new row gets the caller's candidate value. Same trick already proven
  // by lib/native/project-work-package.ts's zoho_* preserve-on-conflict.
}

function buildSelectByIdSql(): string {
  return `SELECT local_submission_id, user_id, project_id, company_id, status,
      form_id, submission_type, definition_schema_version,
      selected_sections, payload, server_submission_id, created_at, updated_at
    FROM ${TABLE} WHERE local_submission_id = ?`;
}

function buildSelectWorkingByUserProjectSql(): string {
  return `SELECT local_submission_id, user_id, project_id, company_id, status,
      form_id, submission_type, definition_schema_version,
      selected_sections, payload, server_submission_id, created_at, updated_at
    FROM ${TABLE} WHERE user_id = ? AND project_id = ? AND status = 'working'
    ORDER BY updated_at DESC`;
}

function buildDeleteSql(): string {
  return `DELETE FROM ${TABLE} WHERE local_submission_id = ?`;
}

type PackageRow = {
  local_submission_id: string;
  user_id: string;
  project_id: string;
  company_id: string;
  status: string;
  form_id: string | null;
  submission_type: string | null;
  definition_schema_version: number | null;
  selected_sections: string;
  payload: string;
  server_submission_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Minimal shape this file needs from a SQLiteDBConnection-like object. */
export interface RunQueryConnection {
  run(statement: string, values?: unknown[]): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
}

/**
 * Pure — the exact upsert statement/values, split out so it's
 * unit-testable without a database — see local-submission.test.ts.
 */
export function buildUpsertStatement<TPayload>(
  input: LocalSubmissionInput<TPayload>,
  createdAtCandidate: string,
  updatedAt: string,
): { statement: string; values: unknown[] } {
  return {
    statement: buildUpsertSql(),
    values: [
      input.localSubmissionId,
      input.userId,
      input.projectId,
      input.companyId,
      input.status,
      input.formId,
      input.submissionType,
      input.definitionSchemaVersion,
      JSON.stringify(input.selectedSections),
      JSON.stringify(input.payload),
      input.serverSubmissionId,
      createdAtCandidate,
      updatedAt,
    ],
  };
}

/** Connection-agnostic save, injectable for testing without a real device — see local-submission.test.ts. */
export async function saveViaConnection<TPayload>(
  db: RunQueryConnection,
  input: LocalSubmissionInput<TPayload>,
): Promise<{ updatedAt: string }> {
  const now = new Date().toISOString();
  const { statement, values } = buildUpsertStatement(input, now, now);
  await db.run(statement, values);
  return { updatedAt: now };
}

/**
 * Pure — decodes a stored row's JSON columns. Throws on malformed JSON
 * (never silently returns a garbage payload) — a technician's own
 * structured work has no safe empty fallback the way a definitions cache
 * does. See local-submission.test.ts.
 */
export function parseStoredRow<TPayload>(row: PackageRow): LocalSubmission<TPayload> {
  const status = row.status === "locally-complete" ? "locally-complete" : "working";
  return {
    localSubmissionId: row.local_submission_id,
    userId: row.user_id,
    projectId: row.project_id,
    companyId: row.company_id,
    status,
    formId: row.form_id,
    submissionType: row.submission_type,
    definitionSchemaVersion: row.definition_schema_version,
    selectedSections: JSON.parse(row.selected_sections) as string[],
    payload: JSON.parse(row.payload) as TPayload,
    serverSubmissionId: row.server_submission_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSchemaReadyConnection() {
  const db = await getNativeSqliteConnection();
  await runMigrations(db, MOBILE_MIGRATIONS);
  return db;
}

export class NativeLocalSubmission implements LocalSubmissionRepository {
  async saveLocalSubmission<TPayload>(input: LocalSubmissionInput<TPayload>): Promise<{ updatedAt: string }> {
    const db = await getSchemaReadyConnection();
    return saveViaConnection(db, input);
  }

  async loadLocalSubmission<TPayload>(localSubmissionId: string): Promise<LocalSubmission<TPayload> | null> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectByIdSql(), [localSubmissionId]);
    const row = result.values?.[0] as unknown as PackageRow | undefined;
    if (!row) return null;
    return parseStoredRow<TPayload>(row);
  }

  async findWorkingLocalSubmissions<TPayload>(userId: string, projectId: string): Promise<LocalSubmission<TPayload>[]> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectWorkingByUserProjectSql(), [userId, projectId]);
    const rows = (result.values ?? []) as unknown as PackageRow[];
    const out: LocalSubmission<TPayload>[] = [];
    for (const row of rows) {
      try {
        out.push(parseStoredRow<TPayload>(row));
      } catch {
        // One corrupted row must never hide every other resumable submission from the picker.
      }
    }
    return out;
  }

  async deleteLocalSubmission(localSubmissionId: string): Promise<void> {
    const db = await getSchemaReadyConnection();
    await db.run(buildDeleteSql(), [localSubmissionId]);
  }
}

export function getNativeLocalSubmission(): LocalSubmissionRepository {
  return new NativeLocalSubmission();
}
