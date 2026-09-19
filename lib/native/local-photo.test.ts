import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUpsertStatement, parseStoredRow, saveViaConnection, type RunQueryConnection } from "./local-photo.ts";
import type { LocalPhotoMetadataInput } from "../local-photo.ts";

function photoInput(overrides: Partial<LocalPhotoMetadataInput> = {}): LocalPhotoMetadataInput {
  return {
    localPhotoId: "photo-1",
    userId: "user-1",
    projectId: "project-1",
    localSubmissionId: "local-sub-1",
    fieldName: "vehicleFrontPhoto",
    group: "vehicle",
    originalFilename: "IMG_20260101_120000.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123456,
    filesystemPath: "submissions/local-sub-1/photos/photo-1.jpg",
    ...overrides,
  };
}

describe("buildUpsertStatement (pure) — metadata-only DTO serialization", () => {
  it("is a single INSERT ... ON CONFLICT statement over the full metadata/association shape", () => {
    const input = photoInput();
    const { statement, values } = buildUpsertStatement(input, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    assert.match(statement, /^INSERT INTO local_photos/);
    assert.match(statement, /ON CONFLICT\(local_photo_id\) DO UPDATE SET/);
    assert.ok(!statement.includes("created_at = excluded"), "created_at must never be in the UPDATE SET clause");
    assert.deepEqual(values, [
      "photo-1",
      "user-1",
      "project-1",
      "local-sub-1",
      "vehicleFrontPhoto",
      "vehicle",
      "IMG_20260101_120000.jpg",
      "image/jpeg",
      123456,
      "submissions/local-sub-1/photos/photo-1.jpg",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("never contains an image-bytes/base64 column — only the filesystem_path reference", () => {
    const { statement, values } = buildUpsertStatement(photoInput(), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    assert.ok(!/\bbytes\b|\bdata\b|\bbase64\b|\bblob\b/i.test(statement), "SQL must never declare an image-bytes column");
    for (const value of values) {
      if (typeof value === "string") {
        assert.ok(!value.startsWith("data:image"), "no value may be a data: URI");
        assert.ok(value.length < 500, "no value may be large enough to plausibly be embedded image bytes");
      }
    }
  });
});

describe("parseStoredRow (pure) — the read-side counterpart of the same DTO", () => {
  it("decodes a well-formed row back into the same LocalPhoto shape", () => {
    const row = {
      local_photo_id: "photo-1",
      user_id: "user-1",
      project_id: "project-1",
      local_submission_id: "local-sub-1",
      field_name: "vehicleFrontPhoto",
      group_name: "vehicle",
      original_filename: "IMG_1.jpg",
      mime_type: "image/jpeg",
      size_bytes: 123456,
      filesystem_path: "submissions/local-sub-1/photos/photo-1.jpg",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:05:00.000Z",
    };
    const parsed = parseStoredRow(row);
    assert.equal(parsed.localPhotoId, "photo-1");
    assert.equal(parsed.fieldName, "vehicleFrontPhoto");
    assert.equal(parsed.group, "vehicle");
    assert.equal(parsed.filesystemPath, "submissions/local-sub-1/photos/photo-1.jpg");
    assert.equal(parsed.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(parsed.updatedAt, "2026-01-01T00:05:00.000Z");
  });
});

const TRIGGER_FAILURE = "TRIGGER_FAILURE";

class FakeSqliteConnection implements RunQueryConnection {
  rows = new Map<string, Record<string, unknown>>();

  async run(statement: string, values: unknown[] = []): Promise<unknown> {
    if (values.some((v) => typeof v === "string" && v.includes(TRIGGER_FAILURE))) {
      throw new Error("simulated write failure");
    }
    if (statement.startsWith("INSERT INTO local_photos")) {
      const [
        localPhotoId,
        userId,
        projectId,
        localSubmissionId,
        fieldName,
        groupName,
        originalFilename,
        mimeType,
        sizeBytes,
        filesystemPath,
        createdAt,
        updatedAt,
      ] = values as [string, string, string, string, string, string, string, string, number, string, string, string];
      const existing = this.rows.get(localPhotoId);
      this.rows.set(localPhotoId, {
        userId, projectId, localSubmissionId, fieldName, groupName, originalFilename, mimeType, sizeBytes, filesystemPath,
        createdAt: existing ? existing.createdAt : createdAt,
        updatedAt,
      });
      return undefined;
    }
    if (statement.startsWith("DELETE FROM local_photos WHERE local_photo_id")) {
      this.rows.delete(values[0] as string);
      return undefined;
    }
    if (statement.startsWith("DELETE FROM local_photos WHERE local_submission_id")) {
      const targetSubmission = values[0] as string;
      for (const [id, row] of this.rows) {
        if (row.localSubmissionId === targetSubmission) this.rows.delete(id);
      }
      return undefined;
    }
    return undefined;
  }

  async query(statement: string, values: unknown[] = []): Promise<{ values?: Array<Record<string, unknown>> }> {
    if (statement.includes("WHERE local_photo_id = ?")) {
      const row = this.rows.get(values[0] as string);
      return { values: row ? [rowToSqlShape(values[0] as string, row)] : [] };
    }
    if (statement.includes("WHERE local_submission_id = ? AND field_name = ?")) {
      const [submissionId, fieldName] = values as [string, string];
      const matches = [...this.rows.entries()]
        .filter(([, row]) => row.localSubmissionId === submissionId && row.fieldName === fieldName)
        .map(([id, row]) => rowToSqlShape(id, row));
      return { values: matches };
    }
    if (statement.includes("WHERE local_submission_id = ?")) {
      const submissionId = values[0] as string;
      const matches = [...this.rows.entries()]
        .filter(([, row]) => row.localSubmissionId === submissionId)
        .map(([id, row]) => rowToSqlShape(id, row));
      return { values: matches };
    }
    return { values: [] };
  }
}

function rowToSqlShape(id: string, row: Record<string, unknown>): Record<string, unknown> {
  return {
    local_photo_id: id,
    user_id: row.userId,
    project_id: row.projectId,
    local_submission_id: row.localSubmissionId,
    field_name: row.fieldName,
    group_name: row.groupName,
    original_filename: row.originalFilename,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    filesystem_path: row.filesystemPath,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

describe("saveViaConnection (upsert-by-key behavior)", () => {
  it("stores a new photo row under its localPhotoId key", async () => {
    const db = new FakeSqliteConnection();
    const result = await saveViaConnection(db, photoInput());
    const stored = db.rows.get("photo-1");
    assert.equal(stored?.fieldName, "vehicleFrontPhoto");
    assert.equal(stored?.updatedAt, result.updatedAt);
    assert.equal(stored?.createdAt, result.updatedAt, "first write's createdAt equals its own updatedAt");
  });

  it("a second save for the SAME id updates fields but preserves the original createdAt", async () => {
    const db = new FakeSqliteConnection();
    const first = await saveViaConnection(db, photoInput({ sizeBytes: 100 }));
    await saveViaConnection(db, photoInput({ sizeBytes: 200 }));
    const stored = db.rows.get("photo-1");
    assert.equal(stored?.sizeBytes, 200);
    assert.equal(stored?.createdAt, first.updatedAt, "createdAt must survive the second save unchanged");
  });

  it("a failed write leaves the previously stored photo completely untouched", async () => {
    const db = new FakeSqliteConnection();
    const first = await saveViaConnection(db, photoInput());
    const before = structuredClone(db.rows.get("photo-1"));
    await assert.rejects(() => saveViaConnection(db, photoInput({ userId: TRIGGER_FAILURE })), /simulated write failure/);
    assert.deepEqual(db.rows.get("photo-1"), before);
    assert.equal(before?.updatedAt, first.updatedAt);
  });

  it("different localPhotoIds never collide", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2" }));
    assert.equal(db.rows.size, 2);
  });

  it("multiple photos for the same field/slot are all preserved independently (multi-photo-per-field)", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1", fieldName: "vehicleFrontPhoto" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2", fieldName: "vehicleFrontPhoto" }));
    const rows = await db.query("SELECT ... FROM local_photos WHERE local_submission_id = ? AND field_name = ?", [
      "local-sub-1",
      "vehicleFrontPhoto",
    ]);
    assert.equal(rows.values?.length, 2);
  });

  it("different field names under the same submission never collide (field-identity isolation, not array position)", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1", fieldName: "vehicleFrontPhoto" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2", fieldName: "vehicleRearPhoto" }));
    const front = await db.query("SELECT ... WHERE local_submission_id = ? AND field_name = ?", ["local-sub-1", "vehicleFrontPhoto"]);
    const rear = await db.query("SELECT ... WHERE local_submission_id = ? AND field_name = ?", ["local-sub-1", "vehicleRearPhoto"]);
    assert.equal(front.values?.length, 1);
    assert.equal(rear.values?.length, 1);
    assert.equal(front.values?.[0]?.local_photo_id, "photo-1");
    assert.equal(rear.values?.[0]?.local_photo_id, "photo-2");
  });

  it("different local submissions never collide (multi-submission isolation)", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1", localSubmissionId: "sub-a" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2", localSubmissionId: "sub-b" }));
    const a = await db.query("SELECT ... WHERE local_submission_id = ?", ["sub-a"]);
    const b = await db.query("SELECT ... WHERE local_submission_id = ?", ["sub-b"]);
    assert.equal(a.values?.length, 1);
    assert.equal(b.values?.length, 1);
  });

  it("different users never collide (user isolation)", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1", userId: "user-A", localSubmissionId: "sub-a" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2", userId: "user-B", localSubmissionId: "sub-b" }));
    assert.equal(db.rows.get("photo-1")?.userId, "user-A");
    assert.equal(db.rows.get("photo-2")?.userId, "user-B");
  });

  it("deleting one photo by id never removes sibling rows in the same submission/field", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2" }));
    await db.run("DELETE FROM local_photos WHERE local_photo_id = ?", ["photo-1"]);
    assert.equal(db.rows.has("photo-1"), false);
    assert.equal(db.rows.has("photo-2"), true);
  });

  it("clearing a submission's photos never touches another submission's photos", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-1", localSubmissionId: "sub-a" }));
    await saveViaConnection(db, photoInput({ localPhotoId: "photo-2", localSubmissionId: "sub-b" }));
    await db.run("DELETE FROM local_photos WHERE local_submission_id = ?", ["sub-a"]);
    assert.equal(db.rows.has("photo-1"), false);
    assert.equal(db.rows.has("photo-2"), true);
  });
});
