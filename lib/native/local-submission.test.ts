import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTechnicianSubmitUpsertStatement,
  buildUpsertStatement,
  parseStoredRow,
  saveViaConnection,
  type RunQueryConnection,
} from "./local-submission.ts";
import type { LocalSubmissionInput } from "../local-submission.ts";

type SamplePayload = { coreJob: { customer: string; unitNumber: string }; notes?: string };

function submissionInput(overrides: Partial<LocalSubmissionInput<SamplePayload>> = {}): LocalSubmissionInput<SamplePayload> {
  return {
    localSubmissionId: "local-sub-1",
    userId: "user-1",
    projectId: "project-1",
    companyId: "company-1",
    status: "working",
    formId: "vac4",
    submissionType: "VAC4",
    definitionSchemaVersion: 2,
    selectedSections: ["VAC4"],
    payload: { coreJob: { customer: "Jane Doe", unitNumber: "UNIT-1" } },
    serverSubmissionId: null,
    ...overrides,
  };
}

describe("buildUpsertStatement (pure) — definition DTO serialization", () => {
  it("Checkpoint 1 — never rewrites a stored row's user/company/project, and only updates a row with the same binding", () => {
    const { statement } = buildUpsertStatement(submissionInput(), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    for (const column of ["user_id", "company_id", "project_id"]) {
      assert.ok(!new RegExp(`\\b${column} = excluded\\.${column}\\s*,`).test(statement), `${column} must never be in the UPDATE SET clause`);
    }
    assert.match(statement, /WHERE local_submissions\.user_id = excluded\.user_id/);
    assert.match(statement, /local_submissions\.company_id = excluded\.company_id/);
    assert.match(statement, /local_submissions\.project_id = excluded\.project_id/);
  });

  it("is a single INSERT ... ON CONFLICT statement JSON-serializing selectedSections/payload", () => {
    const input = submissionInput();
    const { statement, values } = buildUpsertStatement(input, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    assert.match(statement, /^INSERT INTO local_submissions/);
    assert.match(statement, /ON CONFLICT\(local_submission_id\) DO UPDATE SET/);
    assert.ok(!statement.includes("created_at = excluded"), "created_at must never be in the UPDATE SET clause");
    assert.deepEqual(values, [
      "local-sub-1",
      "user-1",
      "project-1",
      "company-1",
      "working",
      "vac4",
      "VAC4",
      2,
      JSON.stringify(["VAC4"]),
      JSON.stringify({ coreJob: { customer: "Jane Doe", unitNumber: "UNIT-1" } }),
      null,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("round-trips a nested structured payload through JSON with no field loss", () => {
    const input = submissionInput({
      payload: { coreJob: { customer: "Jane Doe", unitNumber: "UNIT-1" }, notes: "Installed sensor hub near cab." },
    });
    const { values } = buildUpsertStatement(input, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    assert.deepEqual(JSON.parse(values[9] as string), input.payload);
  });
});

describe("buildTechnicianSubmitUpsertStatement (pure) — the Phase 2H fix: an upsert, not a blind UPDATE", () => {
  it("is a single INSERT ... ON CONFLICT statement, not a plain UPDATE", () => {
    const input = submissionInput();
    const { statement } = buildTechnicianSubmitUpsertStatement(input, "2026-01-01T00:00:00.000Z");
    assert.match(statement, /^INSERT INTO local_submissions/);
    assert.match(statement, /ON CONFLICT\(local_submission_id\) DO UPDATE SET/);
  });

  it("never omits created_at from the UPDATE SET clause — an existing draft's identity/created_at must survive a technician-submit", () => {
    const { statement } = buildTechnicianSubmitUpsertStatement(submissionInput(), "2026-01-01T00:00:00.000Z");
    assert.ok(!statement.includes("created_at = excluded"), "created_at must never be in the UPDATE SET clause");
  });

  it("sets technician_submitted_at unconditionally, both in the fresh-insert column list and the ON CONFLICT UPDATE SET", () => {
    const { statement } = buildTechnicianSubmitUpsertStatement(submissionInput(), "2026-01-01T00:00:00.000Z");
    assert.match(statement, /technician_submitted_at/);
    assert.match(statement, /technician_submitted_at = excluded\.technician_submitted_at/);
  });

  it("always writes status = 'locally-complete' — the technician can only reach Submit after passing full review validation", () => {
    const { statement, values } = buildTechnicianSubmitUpsertStatement(submissionInput({ status: "working" }), "2026-01-01T00:00:00.000Z");
    assert.match(statement, /'locally-complete'/);
    assert.ok(!values.includes("working"), "the caller's own (now-stale) status value must never leak into the statement's values");
  });

  it("uses technicianSubmittedAt for technician_submitted_at, created_at (fresh-insert candidate), and updated_at alike", () => {
    const { values } = buildTechnicianSubmitUpsertStatement(submissionInput(), "2026-03-05T12:00:00.000Z");
    // values: [id, userId, projectId, companyId, formId, submissionType, defSchemaVersion,
    //          selectedSections, payload, serverSubmissionId, technicianSubmittedAt, createdAt, updatedAt]
    assert.equal(values[10], "2026-03-05T12:00:00.000Z");
    assert.equal(values[11], "2026-03-05T12:00:00.000Z");
    assert.equal(values[12], "2026-03-05T12:00:00.000Z");
  });

  it("JSON-serializes selectedSections/payload exactly like the ordinary autosave upsert does", () => {
    const input = submissionInput({ payload: { coreJob: { customer: "Jane Doe", unitNumber: "UNIT-1" }, notes: "final" } });
    const { values } = buildTechnicianSubmitUpsertStatement(input, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(JSON.parse(values[7] as string), ["VAC4"]);
    assert.deepEqual(JSON.parse(values[8] as string), input.payload);
  });
});

describe("parseStoredRow (pure) — the read-side counterpart of the same DTO", () => {
  it("decodes a well-formed row back into the same LocalSubmission shape", () => {
    const row = {
      local_submission_id: "local-sub-1",
      user_id: "user-1",
      project_id: "project-1",
      company_id: "company-1",
      status: "working",
      form_id: "vac4",
      submission_type: "VAC4",
      definition_schema_version: 2,
      selected_sections: JSON.stringify(["VAC4"]),
      payload: JSON.stringify({ coreJob: { customer: "Jane Doe", unitNumber: "UNIT-1" } }),
      server_submission_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:05:00.000Z",
    };
    const parsed = parseStoredRow<SamplePayload>(row);
    assert.equal(parsed.localSubmissionId, "local-sub-1");
    assert.equal(parsed.status, "working");
    assert.deepEqual(parsed.selectedSections, ["VAC4"]);
    assert.deepEqual(parsed.payload, { coreJob: { customer: "Jane Doe", unitNumber: "UNIT-1" } });
    assert.equal(parsed.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(parsed.updatedAt, "2026-01-01T00:05:00.000Z");
  });

  it("normalizes an unrecognized status value to 'working' rather than throwing", () => {
    const row = {
      local_submission_id: "local-sub-1",
      user_id: "user-1",
      project_id: "project-1",
      company_id: "company-1",
      status: "some-future-status",
      form_id: null,
      submission_type: null,
      definition_schema_version: null,
      selected_sections: "[]",
      payload: "{}",
      server_submission_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(parseStoredRow(row).status, "working");
  });

  it("throws on malformed payload JSON rather than silently returning a garbage payload", () => {
    const row = {
      local_submission_id: "local-sub-1",
      user_id: "user-1",
      project_id: "project-1",
      company_id: "company-1",
      status: "working",
      form_id: null,
      submission_type: null,
      definition_schema_version: null,
      selected_sections: "[]",
      payload: "{not valid json",
      server_submission_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    assert.throws(() => parseStoredRow(row));
  });
});

const TRIGGER_FAILURE = "TRIGGER_FAILURE";

class FakeSqliteConnection implements RunQueryConnection {
  rows = new Map<string, Record<string, unknown>>();

  async run(statement: string, values: unknown[] = []): Promise<unknown> {
    if (values.some((v) => typeof v === "string" && v.includes(TRIGGER_FAILURE))) {
      throw new Error("simulated write failure");
    }
    if (statement.startsWith("INSERT INTO local_submissions")) {
      const [
        localSubmissionId,
        userId,
        projectId,
        companyId,
        status,
        formId,
        submissionType,
        definitionSchemaVersion,
        selectedSections,
        payload,
        serverSubmissionId,
        createdAt,
        updatedAt,
      ] = values as [string, string, string, string, string, string | null, string | null, number | null, string, string, string | null, string, string];
      const existing = this.rows.get(localSubmissionId);
      this.rows.set(localSubmissionId, {
        userId,
        projectId,
        companyId,
        status,
        formId,
        submissionType,
        definitionSchemaVersion,
        selectedSections,
        payload,
        serverSubmissionId,
        // ON CONFLICT DO UPDATE never touches created_at — preserve whatever was already there.
        createdAt: existing ? existing.createdAt : createdAt,
        updatedAt,
      });
    }
    return undefined;
  }

  async query(): Promise<{ values?: Array<Record<string, unknown>> }> {
    return { values: [] };
  }
}

describe("saveViaConnection (upsert-by-key behavior — successful replacement / failed refresh preserves old)", () => {
  it("stores a new submission under its localSubmissionId key", async () => {
    const db = new FakeSqliteConnection();
    const input = submissionInput();
    const result = await saveViaConnection(db, input);
    const stored = db.rows.get("local-sub-1");
    assert.equal(stored?.status, "working");
    assert.equal(stored?.updatedAt, result.updatedAt);
    assert.equal(stored?.createdAt, result.updatedAt, "first write's createdAt equals its own updatedAt");
  });

  it("a second save for the SAME id updates the payload but preserves the original createdAt", async () => {
    const db = new FakeSqliteConnection();
    const first = await saveViaConnection(db, submissionInput({ payload: { coreJob: { customer: "First", unitNumber: "U1" } } }));
    const second = await saveViaConnection(db, submissionInput({ payload: { coreJob: { customer: "Second", unitNumber: "U1" } } }));
    const stored = db.rows.get("local-sub-1");
    assert.equal(JSON.parse(stored?.payload as string).coreJob.customer, "Second");
    assert.equal(stored?.createdAt, first.updatedAt, "createdAt must survive the second save unchanged");
    assert.notEqual(second.updatedAt, undefined);
  });

  it("a failed write leaves the previously stored submission completely untouched", async () => {
    const db = new FakeSqliteConnection();
    const first = await saveViaConnection(db, submissionInput());
    const before = structuredClone(db.rows.get("local-sub-1"));

    await assert.rejects(
      () => saveViaConnection(db, submissionInput({ userId: TRIGGER_FAILURE })),
      /simulated write failure/,
    );

    assert.deepEqual(db.rows.get("local-sub-1"), before, "previous submission must survive a failed write untouched");
    assert.equal(before?.updatedAt, first.updatedAt);
  });

  it("different local submission ids never collide", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(db, submissionInput({ localSubmissionId: "local-sub-1" }));
    await saveViaConnection(db, submissionInput({ localSubmissionId: "local-sub-2" }));
    assert.equal(db.rows.size, 2);
  });

  it("the same project for different users never collides (user isolation)", async () => {
    const db = new FakeSqliteConnection();
    await saveViaConnection(
      db,
      submissionInput({ localSubmissionId: "local-sub-a", userId: "user-A", payload: { coreJob: { customer: "A", unitNumber: "U1" } } }),
    );
    await saveViaConnection(
      db,
      submissionInput({ localSubmissionId: "local-sub-b", userId: "user-B", payload: { coreJob: { customer: "B", unitNumber: "U1" } } }),
    );
    assert.equal(db.rows.get("local-sub-a")?.userId, "user-A");
    assert.equal(db.rows.get("local-sub-b")?.userId, "user-B");
  });
});
