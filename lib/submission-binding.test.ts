import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NATIVE_SUBMISSION_BINDING_MISMATCH_MESSAGE,
  NATIVE_SUBMISSION_UNBOUND_MESSAGE,
  SubmissionBindingError,
  resolveSubmissionContextIds,
  toSubmissionBinding,
  verifyNativeSubmitBinding,
  type SubmissionBinding,
} from "./submission-binding.ts";

const PROJECT_A: SubmissionBinding = { userId: "user-1", companyId: "company-A", projectId: "project-A" };
const PROJECT_B: SubmissionBinding = { userId: "user-1", companyId: "company-B", projectId: "project-B" };

function webDefaultSpy() {
  const calls = { count: 0 };
  return {
    calls,
    resolveWebDefault: async () => {
      calls.count += 1;
      return { companyId: "powerfleet-company", projectId: "powerfleet-default-project" };
    },
  };
}

describe("toSubmissionBinding (pure)", () => {
  it("requires all three ids — a partial binding is no binding", () => {
    assert.deepEqual(toSubmissionBinding("user-1", { companyId: "company-A", projectId: "project-A" }), PROJECT_A);
    assert.equal(toSubmissionBinding(null, { companyId: "company-A", projectId: "project-A" }), null);
    assert.equal(toSubmissionBinding("user-1", { companyId: "", projectId: "project-A" }), null);
    assert.equal(toSubmissionBinding("user-1", { companyId: "company-A", projectId: "  " }), null);
    assert.equal(toSubmissionBinding("user-1", null), null);
  });
});

describe("resolveSubmissionContextIds — the form's project context", () => {
  it("native: always the job card's own binding, even when the selected pointer now points at another project", async () => {
    const web = webDefaultSpy();
    const ids = await resolveSubmissionContextIds({
      isNative: true,
      nativeBinding: PROJECT_A,
      selectedCompanyId: PROJECT_B.companyId,
      selectedProjectId: PROJECT_B.projectId,
      resolveWebDefault: web.resolveWebDefault,
    });
    assert.deepEqual(ids, { companyId: "company-A", projectId: "project-A" });
    assert.equal(web.calls.count, 0);
  });

  it("B: native with no provable binding fails closed — never the selected pointer, never Powerfleet / Default Project", async () => {
    const web = webDefaultSpy();
    await assert.rejects(
      () =>
        resolveSubmissionContextIds({
          isNative: true,
          nativeBinding: null,
          selectedCompanyId: PROJECT_B.companyId,
          selectedProjectId: PROJECT_B.projectId,
          resolveWebDefault: web.resolveWebDefault,
        }),
      (e: unknown) => e instanceof SubmissionBindingError && e.message === NATIVE_SUBMISSION_UNBOUND_MESSAGE,
    );
    await assert.rejects(() =>
      resolveSubmissionContextIds({
        isNative: true,
        nativeBinding: null,
        selectedCompanyId: "",
        selectedProjectId: "",
        resolveWebDefault: web.resolveWebDefault,
      }),
    );
    assert.equal(web.calls.count, 0, "the web-only default project must be unreachable from native");
  });

  it("web: unchanged — the selected pointer when set", async () => {
    const web = webDefaultSpy();
    const ids = await resolveSubmissionContextIds({
      isNative: false,
      nativeBinding: null,
      selectedCompanyId: "company-A",
      selectedProjectId: "project-A",
      resolveWebDefault: web.resolveWebDefault,
    });
    assert.deepEqual(ids, { companyId: "company-A", projectId: "project-A" });
    assert.equal(web.calls.count, 0);
  });

  it("web: unchanged — falls back to the web-only default when nothing is selected", async () => {
    const web = webDefaultSpy();
    const ids = await resolveSubmissionContextIds({
      isNative: false,
      nativeBinding: null,
      selectedCompanyId: "",
      selectedProjectId: "",
      resolveWebDefault: web.resolveWebDefault,
    });
    assert.equal(ids.projectId, "powerfleet-default-project");
    assert.equal(web.calls.count, 1);
  });
});

describe("verifyNativeSubmitBinding — the final-submit check", () => {
  it("passes when the form's binding and the stored row agree and belong to the signed-in user", () => {
    const result = verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: PROJECT_A, storedBinding: PROJECT_A });
    assert.deepEqual(result, { ok: true, binding: PROJECT_A });
  });

  it("passes with no stored row yet (no autosave ever ran) — the atomic submit creates it under this binding", () => {
    const result = verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: PROJECT_A, storedBinding: null });
    assert.deepEqual(result, { ok: true, binding: PROJECT_A });
  });

  it("fails closed with no binding at all", () => {
    const result = verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: null, storedBinding: PROJECT_A });
    assert.deepEqual(result, { ok: false, error: NATIVE_SUBMISSION_UNBOUND_MESSAGE });
  });

  it("fails closed when the stored row names a different project than the form — never picks one", () => {
    const result = verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: PROJECT_B, storedBinding: PROJECT_A });
    assert.deepEqual(result, { ok: false, error: NATIVE_SUBMISSION_BINDING_MISMATCH_MESSAGE });
  });

  it("fails closed when the job card belongs to a different user than the one signed in", () => {
    const otherUsers = { ...PROJECT_A, userId: "user-2" };
    assert.equal(verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: otherUsers, storedBinding: otherUsers }).ok, false);
    assert.equal(verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: PROJECT_A, storedBinding: otherUsers }).ok, false);
    assert.equal(verifyNativeSubmitBinding({ currentUserId: null, sessionBinding: PROJECT_A, storedBinding: PROJECT_A }).ok, false);
  });
});
