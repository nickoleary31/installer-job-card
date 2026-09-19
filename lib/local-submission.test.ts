import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLocalSubmissionResumeOutcome, type LocalSubmission } from "./local-submission.ts";

type SamplePayload = { coreJob: { customer: string } };

function submission(overrides: Partial<LocalSubmission<SamplePayload>> = {}): LocalSubmission<SamplePayload> {
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
    payload: { coreJob: { customer: "Jane Doe" } },
    serverSubmissionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveLocalSubmissionResumeOutcome (pure)", () => {
  it("returns 'none' for a legitimately empty working set — Start New Submission should create one", () => {
    assert.deepEqual(resolveLocalSubmissionResumeOutcome([]), { kind: "none" });
  });

  it("returns 'single' with the one working submission when exactly one exists", () => {
    const sub = submission();
    const outcome = resolveLocalSubmissionResumeOutcome([sub]);
    assert.equal(outcome.kind, "single");
    if (outcome.kind === "single") assert.equal(outcome.submission.localSubmissionId, "local-sub-1");
  });

  it("returns 'multiple' with every working submission when more than one exists, preserving repository order", () => {
    const first = submission({ localSubmissionId: "local-sub-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    const second = submission({ localSubmissionId: "local-sub-2", updatedAt: "2026-01-01T00:00:00.000Z" });
    const outcome = resolveLocalSubmissionResumeOutcome([first, second]);
    assert.equal(outcome.kind, "multiple");
    if (outcome.kind === "multiple") {
      assert.deepEqual(
        outcome.submissions.map((s) => s.localSubmissionId),
        ["local-sub-1", "local-sub-2"],
      );
    }
  });
});
