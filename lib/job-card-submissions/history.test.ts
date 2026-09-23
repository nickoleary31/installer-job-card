import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleHistoryRequest, type HistoryAccess, type JobCardSubmissionsHistoryRepo, type SubmissionHistoryDto } from "./history.ts";

function row(overrides: Partial<SubmissionHistoryDto> = {}): SubmissionHistoryDto {
  return {
    submissionId: "sub-1",
    submissionSnapshotHash: "hash-abc",
    customer: "Jane Doe",
    unitNumber: "UNIT-1",
    technicianSubmittedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:05:00.000Z",
    ...overrides,
  };
}

function fakeRepo(rows: SubmissionHistoryDto[]): JobCardSubmissionsHistoryRepo & { calls: Array<{ companyId: string; projectId: string }> } {
  const calls: Array<{ companyId: string; projectId: string }> = [];
  return {
    calls,
    async listForProject(companyId, projectId) {
      calls.push({ companyId, projectId });
      return { rows, error: null };
    },
  };
}

function okAccess(repo: JobCardSubmissionsHistoryRepo): HistoryAccess {
  return { authorize: async () => ({ ok: true, repo }) };
}

function deniedAccess(status: number, error: string): HistoryAccess {
  return { authorize: async () => ({ ok: false, status, error }) };
}

describe("handleHistoryRequest — authentication/authorization", () => {
  it("propagates a 401 from a missing/invalid access token, before ever touching the repo", async () => {
    const access: HistoryAccess = { authorize: async () => ({ ok: false, status: 401, error: "Unauthorized requester." }) };
    const result = await handleHistoryRequest({ accessToken: "", companyId: "company-1", projectId: "project-1" }, access);
    assert.equal(result.status, 401);
  });

  it("propagates a 403 for a requester with no project access", async () => {
    const result = await handleHistoryRequest({ accessToken: "t", companyId: "company-1", projectId: "project-1" }, deniedAccess(403, "no access"));
    assert.equal(result.status, 403);
  });

  it("Phase 2H security reconciliation — propagates a 409 when the project does not belong to the specified company, before ever querying the repo", async () => {
    const result = await handleHistoryRequest(
      { accessToken: "t", companyId: "company-A", projectId: "project-in-company-B" },
      deniedAccess(409, "Project does not belong to the specified company."),
    );
    assert.equal(result.status, 409);
  });

  it("Phase 2H security reconciliation — propagates a 500 when no privileged server key is configured", async () => {
    const result = await handleHistoryRequest(
      { accessToken: "t", companyId: "company-1", projectId: "project-1" },
      deniedAccess(500, "This operation is unavailable because SUPABASE_SECRET_KEY is not configured on the server."),
    );
    assert.equal(result.status, 500);
  });
});

describe("handleHistoryRequest — project filtering", () => {
  it("queries the repo scoped to exactly the requested companyId/projectId", async () => {
    const repo = fakeRepo([row()]);
    await handleHistoryRequest({ accessToken: "t", companyId: "company-9", projectId: "project-42" }, okAccess(repo));
    assert.deepEqual(repo.calls, [{ companyId: "company-9", projectId: "project-42" }]);
  });
});

describe("handleHistoryRequest — DTO shape", () => {
  it("returns submissionSnapshotHash (including when null) alongside the minimal identity fields", async () => {
    const repo = fakeRepo([row({ submissionSnapshotHash: null }), row({ submissionId: "sub-2", submissionSnapshotHash: "hash-2" })]);
    const result = await handleHistoryRequest({ accessToken: "t", companyId: "c", projectId: "p" }, okAccess(repo));
    assert.equal(result.status, 200);
    const submissions = (result.body as { submissions: SubmissionHistoryDto[] }).submissions;
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].submissionSnapshotHash, null);
    assert.equal(submissions[1].submissionSnapshotHash, "hash-2");
  });

  it("never includes the raw stored payload — only the minimal identity/status fields", async () => {
    const repo = fakeRepo([row()]);
    const result = await handleHistoryRequest({ accessToken: "t", companyId: "c", projectId: "p" }, okAccess(repo));
    const submissions = (result.body as { submissions: Record<string, unknown>[] }).submissions;
    assert.deepEqual(
      Object.keys(submissions[0]).sort(),
      ["createdAt", "customer", "submissionId", "submissionSnapshotHash", "technicianSubmittedAt", "unitNumber"],
    );
    assert.ok(!("payload" in submissions[0]), "the DTO must never carry the raw job_card_submissions.payload column");
  });

  it("an empty project returns an empty array, not an error", async () => {
    const repo = fakeRepo([]);
    const result = await handleHistoryRequest({ accessToken: "t", companyId: "c", projectId: "p" }, okAccess(repo));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { submissions: [] });
  });
});

describe("handleHistoryRequest — repo failure surfaces honestly", () => {
  it("a repo error is reported as a 500, not an empty/false-success list", async () => {
    const repo: JobCardSubmissionsHistoryRepo = { async listForProject() { return { rows: [], error: "connection reset" }; } };
    const result = await handleHistoryRequest({ accessToken: "t", companyId: "c", projectId: "p" }, okAccess(repo));
    assert.equal(result.status, 500);
  });
});
