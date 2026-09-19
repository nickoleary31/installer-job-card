import { getNativeSqliteConnection, runMigrations } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";
import type { LocalPhoto, LocalPhotoMetadataInput, LocalPhotoMetadataRepository } from "../local-photo.ts";

/**
 * Phase 2G native implementation — metadata/association ONLY. Actual image
 * bytes never pass through this file; they live in the app-private
 * filesystem via lib/native/filesystem.ts, addressed by the filesystem_path
 * column. Deliberately no image bytes/base64 column here at all — see
 * lib/local-photo.ts's own doc on why file I/O and metadata are split.
 *
 * Schema (version 6) lives in mobile-migrations.ts's single canonical
 * catalog, not here — see that file's doc comment for why.
 */
const TABLE = "local_photos";

function buildUpsertSql(): string {
  return `INSERT INTO ${TABLE} (
      local_photo_id, user_id, project_id, local_submission_id,
      field_name, group_name, original_filename, mime_type, size_bytes,
      filesystem_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_photo_id) DO UPDATE SET
      user_id = excluded.user_id,
      project_id = excluded.project_id,
      local_submission_id = excluded.local_submission_id,
      field_name = excluded.field_name,
      group_name = excluded.group_name,
      original_filename = excluded.original_filename,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      filesystem_path = excluded.filesystem_path,
      updated_at = excluded.updated_at`;
  // created_at deliberately omitted from the UPDATE SET — same
  // preserve-on-conflict trick already proven by local_submissions.
}

function buildSelectByIdSql(): string {
  return `SELECT local_photo_id, user_id, project_id, local_submission_id,
      field_name, group_name, original_filename, mime_type, size_bytes,
      filesystem_path, created_at, updated_at
    FROM ${TABLE} WHERE local_photo_id = ?`;
}

function buildSelectBySubmissionSql(): string {
  return `SELECT local_photo_id, user_id, project_id, local_submission_id,
      field_name, group_name, original_filename, mime_type, size_bytes,
      filesystem_path, created_at, updated_at
    FROM ${TABLE} WHERE local_submission_id = ? ORDER BY created_at ASC`;
}

function buildSelectBySubmissionAndFieldSql(): string {
  return `SELECT local_photo_id, user_id, project_id, local_submission_id,
      field_name, group_name, original_filename, mime_type, size_bytes,
      filesystem_path, created_at, updated_at
    FROM ${TABLE} WHERE local_submission_id = ? AND field_name = ? ORDER BY created_at ASC`;
}

function buildDeleteByIdSql(): string {
  return `DELETE FROM ${TABLE} WHERE local_photo_id = ?`;
}

function buildDeleteBySubmissionSql(): string {
  return `DELETE FROM ${TABLE} WHERE local_submission_id = ?`;
}

type PhotoRow = {
  local_photo_id: string;
  user_id: string;
  project_id: string;
  local_submission_id: string;
  field_name: string;
  group_name: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  filesystem_path: string;
  created_at: string;
  updated_at: string;
};

/** Minimal shape this file needs from a SQLiteDBConnection-like object. */
export interface RunQueryConnection {
  run(statement: string, values?: unknown[]): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
}

/** Pure — split out so it's unit-testable without a database — see local-photo.test.ts. */
export function buildUpsertStatement(
  input: LocalPhotoMetadataInput,
  createdAtCandidate: string,
  updatedAt: string,
): { statement: string; values: unknown[] } {
  return {
    statement: buildUpsertSql(),
    values: [
      input.localPhotoId,
      input.userId,
      input.projectId,
      input.localSubmissionId,
      input.fieldName,
      input.group,
      input.originalFilename,
      input.mimeType,
      input.sizeBytes,
      input.filesystemPath,
      createdAtCandidate,
      updatedAt,
    ],
  };
}

/** Connection-agnostic save, injectable for testing without a real device — see local-photo.test.ts. */
export async function saveViaConnection(db: RunQueryConnection, input: LocalPhotoMetadataInput): Promise<LocalPhoto> {
  const now = new Date().toISOString();
  const { statement, values } = buildUpsertStatement(input, now, now);
  await db.run(statement, values);
  return { ...input, createdAt: now, updatedAt: now };
}

/** Pure — no image bytes/base64 column exists to decode; this just maps SQL row -> LocalPhoto. */
export function parseStoredRow(row: PhotoRow): LocalPhoto {
  return {
    localPhotoId: row.local_photo_id,
    userId: row.user_id,
    projectId: row.project_id,
    localSubmissionId: row.local_submission_id,
    fieldName: row.field_name,
    group: row.group_name,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    filesystemPath: row.filesystem_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSchemaReadyConnection() {
  const db = await getNativeSqliteConnection();
  await runMigrations(db, MOBILE_MIGRATIONS);
  return db;
}

export class NativeLocalPhotoMetadata implements LocalPhotoMetadataRepository {
  async saveLocalPhotoMetadata(input: LocalPhotoMetadataInput): Promise<LocalPhoto> {
    const db = await getSchemaReadyConnection();
    return saveViaConnection(db, input);
  }

  async loadLocalPhotoMetadata(localPhotoId: string): Promise<LocalPhoto | null> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectByIdSql(), [localPhotoId]);
    const row = result.values?.[0] as unknown as PhotoRow | undefined;
    return row ? parseStoredRow(row) : null;
  }

  async listLocalPhotosForSubmission(localSubmissionId: string): Promise<LocalPhoto[]> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectBySubmissionSql(), [localSubmissionId]);
    return ((result.values ?? []) as unknown as PhotoRow[]).map(parseStoredRow);
  }

  async listLocalPhotosForField(localSubmissionId: string, fieldName: string): Promise<LocalPhoto[]> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectBySubmissionAndFieldSql(), [localSubmissionId, fieldName]);
    return ((result.values ?? []) as unknown as PhotoRow[]).map(parseStoredRow);
  }

  async deleteLocalPhotoMetadata(localPhotoId: string): Promise<void> {
    const db = await getSchemaReadyConnection();
    await db.run(buildDeleteByIdSql(), [localPhotoId]);
  }

  async clearLocalPhotosForSubmission(localSubmissionId: string): Promise<void> {
    const db = await getSchemaReadyConnection();
    await db.run(buildDeleteBySubmissionSql(), [localSubmissionId]);
  }
}

export function getNativeLocalPhotoMetadata(): LocalPhotoMetadataRepository {
  return new NativeLocalPhotoMetadata();
}
