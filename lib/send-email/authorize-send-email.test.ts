import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEND_EMAIL_SIGN_IN_MESSAGE,
  authorizeSendEmailRequest,
  normalizeRecipientEmailList,
  type SendEmailAuthDeps,
} from "./authorize-send-email.ts";
import type { JobCardSubmissionPayload } from "../job-card-submission.ts";

const WEB_PHOTO = "sub-1/vehicle/vehicleFrontPhoto/1718000000000-front.jpg";
const NATIVE_PHOTO = "company-A/project-1/user-tech/sub-1/vehicle/vehicleFrontPhoto/photo-1.jpg";

function payload(overrides: Partial<JobCardSubmissionPayload> & Record<string, unknown> = {}): JobCardSubmissionPayload {
  return {
    submissionId: "sub-1",
    submissionTimestamp: "2026-06-01T00:00:00.000Z",
    status: "Submitted",
    companyId: "company-A",
    projectId: "project-1",
    projectRecipientEmails: ["attacker@evil.example"],
    coreJobInfo: { customer: "Jane" } as JobCardSubmissionPayload["coreJobInfo"],
    hardwareSelection: { primary: "VAC4", hasAdditional: "no", additional: [] },
    selectedSections: ["VAC4"],
    photoUploads: [{ fieldName: "vehicleFrontPhoto", group: "vehicle", label: "Front", filename: "front.jpg", storagePath: WEB_PHOTO, publicUrl: "", uploadedAt: "" }],
    vac4: {} as JobCardSubmissionPayload["vac4"],
    ...overrides,
  } as JobCardSubmissionPayload;
}

function deps(overrides: Partial<SendEmailAuthDeps> = {}) {
  const calls: string[] = [];
  const d: SendEmailAuthDeps & { calls: string[] } = {
    calls,
    async loadSubmissionScope(submissionId) {
      calls.push(`scope:${submissionId}`);
      if (submissionId === "sub-1") return { scope: { companyId: "company-A", projectId: "project-1" } };
      if (submissionId === "sub-B") return { scope: { companyId: "company-B", projectId: "project-B1" } };
      return { scope: null };
    },
    async authorizeProject({ accessToken, companyId, projectId }) {
      calls.push(`authorize:${accessToken}:${companyId}:${projectId}`);
      if (accessToken === "tok-tech-A" && companyId === "company-A" && projectId === "project-1") return { ok: true, requesterUserId: "user-tech" };
      if (accessToken === "tok-admin-A" && companyId === "company-A") return { ok: true, requesterUserId: "user-admin" };
      return { ok: false, status: 403, error: "no access" };
    },
    async loadProjectRecipientEmails(projectId) {
      calls.push(`recipients:${projectId}`);
      return { emails: projectId === "project-1" ? ["site@customer.example"] : [] };
    },
    ...overrides,
  };
  return d;
}

describe("authorizeSendEmailRequest — R", () => {
  it("R: an unauthenticated request is rejected with 401 before any lookup", async () => {
    const d = deps();
    const result = await authorizeSendEmailRequest({ accessToken: "", payload: payload() }, d);
    assert.deepEqual(result, { ok: false, status: 401, error: SEND_EMAIL_SIGN_IN_MESSAGE });
    assert.deepEqual(d.calls, []);
  });

  it("R: the legitimate post-submit flow (assigned technician, web photo paths) succeeds, with the sender and recipients derived server-side", async () => {
    const d = deps();
    const result = await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload() }, d);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.requesterUserId, "user-tech");
      assert.equal(result.companyId, "company-A");
      assert.deepEqual(result.payload.projectRecipientEmails, ["site@customer.example"], "the body's own recipient list is discarded");
      assert.equal((result.payload as { externalRecipientEmails?: unknown }).externalRecipientEmails, undefined);
    }
  });

  it("R: a company admin resending a technician's native submission succeeds (any uploader namespace within the submission)", async () => {
    const result = await authorizeSendEmailRequest(
      { accessToken: "tok-admin-A", payload: payload({ photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: NATIVE_PHOTO, publicUrl: "", uploadedAt: "" }] }) },
      deps(),
    );
    assert.equal(result.ok, true);
  });

  it("scope comes from the STORED row, never the body: a body claiming company A for a submission that belongs to company B is authorized against company B and denied", async () => {
    const d = deps();
    const result = await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload({ submissionId: "sub-B", companyId: "company-A", projectId: "project-1" }) }, d);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.ok(d.calls.includes("authorize:tok-tech-A:company-B:project-B1"));
  });

  it("R: an arbitrary bucket or path in the body is rejected (400) even for an authorized user", async () => {
    const productFile = { fileKey: "k", productKey: "p", originalFileName: "x", storageBucket: "private-backups", storagePath: "customer-sites/c/product-files/p/k/project-1/x", mimeType: "application/json", sizeBytes: 1, uploadedAt: "", displayLabel: "X" };
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload({ productFiles: [productFile] }) }, deps())).status, 400);
    const traversal = payload({ photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: "../../keys.json", publicUrl: "", uploadedAt: "" }] });
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: traversal }, deps())).status, 400);
  });

  it("R: a cross-tenant object (another submission's or another company's photo) is rejected", async () => {
    const otherSubmission = payload({ photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: WEB_PHOTO.replace("sub-1", "sub-victim"), publicUrl: "", uploadedAt: "" }] });
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: otherSubmission }, deps())).status, 400);
    const otherCompany = payload({ photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: NATIVE_PHOTO.replace("company-A", "company-B"), publicUrl: "", uploadedAt: "" }] });
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: otherCompany }, deps())).status, 400);
  });

  it("a submission that is not stored yet -> 404; a failed lookup -> 500; an invalid submissionId -> 400 — all fail closed", async () => {
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload({ submissionId: "sub-unknown" }) }, deps())).status, 404);
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload({ submissionId: "../x" }) }, deps())).status, 400);
    const failing = deps({ async loadSubmissionScope() { return { scope: null, error: true }; } });
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload() }, failing)).status, 500);
    const failingRecipients = deps({ async loadProjectRecipientEmails() { return { emails: [], error: true }; } });
    assert.equal((await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload() }, failingRecipients)).status, 500);
  });

  it("an authorized user with no access to the submission's project (unassigned technician) is denied", async () => {
    const d = deps({ async authorizeProject() { return { ok: false, status: 403, error: "Only global admins..." }; } });
    const result = await authorizeSendEmailRequest({ accessToken: "tok-tech-A", payload: payload() }, d);
    assert.equal(result.ok, false);
    assert.ok(!d.calls.some((c) => c.startsWith("recipients")), "nothing past authorization runs");
  });
});

describe("normalizeRecipientEmailList (pure)", () => {
  it("accepts a text[] column, a JSON-encoded array, or a single address; lowercases, dedupes, drops junk", () => {
    assert.deepEqual(normalizeRecipientEmailList(["A@X.com", "a@x.com", "bad", "", 5]), ["a@x.com"]);
    assert.deepEqual(normalizeRecipientEmailList('["one@x.com","two@y.org"]'), ["one@x.com", "two@y.org"]);
    assert.deepEqual(normalizeRecipientEmailList("solo@z.net"), ["solo@z.net"]);
    assert.deepEqual(normalizeRecipientEmailList(null), []);
    assert.deepEqual(normalizeRecipientEmailList("["), []);
  });
});
