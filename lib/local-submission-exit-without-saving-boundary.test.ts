import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Phase 2H fix — regression guard proving the actual production gating in
 * NewSubmissionForm.tsx's handleExitWithoutSavingConfirm(): a LocalSubmission
 * created BY THIS FORM SESSION (never a resumed one, never a
 * technician-submitted one) is discarded — via the SAME
 * deleteLocalSubmissionDurably() lib/local-submission.test.ts already proves
 * correct in isolation — when the technician taps Exit Without Saving ->
 * Leave. No React component test harness exists anywhere in this codebase
 * (see local-submission-photo-boundary.test.ts's own doc), so — matching
 * that file's established approach — this inspects the REAL source rather
 * than a reimplementation.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_SUBMISSION_FORM_PATH = join(__dirname, "..", "components", "NewSubmissionForm.tsx");
const source = readFileSync(NEW_SUBMISSION_FORM_PATH, "utf8");

/** Brace-depth extraction — robust to nested object literals/ternaries inside the function body. */
function extractFunctionBody(src: string, signatureNeedle: string): string {
  const sigIdx = src.indexOf(signatureNeedle);
  assert.ok(sigIdx >= 0, `Could not find "${signatureNeedle}" in NewSubmissionForm.tsx — has it been renamed/moved? Update this test's needle.`);
  const braceStart = src.indexOf("{", sigIdx);
  assert.ok(braceStart >= 0, "Could not find the opening brace of the target function");
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting the function body — source may have changed shape");
}

describe("Phase 2H — handleExitWithoutSavingConfirm only discards a session-created draft, never a resumed or submitted one", () => {
  const body = extractFunctionBody(source, "const handleExitWithoutSavingConfirm = async () => {");

  it("extracted a real, non-trivial function body (sanity check the extraction itself)", () => {
    assert.ok(body.length > 200, "handleExitWithoutSavingConfirm's body looks suspiciously short — extraction may have failed silently");
    assert.match(body, /clearMatchingAutosave/, "extracted body doesn't look like handleExitWithoutSavingConfirm — sanity check failed");
  });

  it("calls deleteLocalSubmissionDurably at all (the actual fix, not just the pre-existing web-autosave cleanup)", () => {
    assert.match(body, /deleteLocalSubmissionDurably\(submissionId\)/);
  });

  it("gates the delete on !restoredFromDraftRef.current — a RESUMED draft's local_submissions row must never be deleted here", () => {
    assert.match(body, /restoredFromDraftRef\.current/);
    // The exact conjunctive guard, not just a reference to the ref somewhere else in the body.
    assert.match(body, /if\s*\(\s*isNativeRuntime\(\)\s*&&\s*!restoredFromDraftRef\.current\s*&&\s*!isJobCardSubmitted\s*\)/);
  });

  it("[test 10/11] is gated on isNativeRuntime(), not isOfflineAuthorized — an ONLINE native new-draft Exit Without Saving must remove its row/photos exactly like an offline-authorized one, and a RESUMED draft must still be preserved regardless of connectivity", () => {
    assert.ok(!body.includes("isOfflineAuthorized"), "Exit Without Saving's delete guard must never depend on connectivity — only on whether this session created (vs resumed) the draft");
  });

  it("also guards on !isJobCardSubmitted as a second, structural safeguard against ever deleting a submitted item through this path", () => {
    assert.match(body, /!isJobCardSubmitted/);
  });

  it("the delete call is nested inside the guard condition, not a sibling unconditional call", () => {
    const guardIdx = body.search(/if\s*\(\s*isNativeRuntime\(\)\s*&&\s*!restoredFromDraftRef\.current\s*&&\s*!isJobCardSubmitted\s*\)/);
    const deleteIdx = body.indexOf("deleteLocalSubmissionDurably(submissionId)");
    assert.ok(guardIdx >= 0 && deleteIdx > guardIdx, "deleteLocalSubmissionDurably must appear textually after (i.e. nested inside) the guard condition");
    // The guard's own opening brace must come before the delete call, and its matching close after it —
    // i.e. the delete call is genuinely inside the if-block, not merely later in the function.
    const braceStart = body.indexOf("{", guardIdx);
    let depth = 0;
    let guardEnd = -1;
    for (let i = braceStart; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") {
        depth--;
        if (depth === 0) {
          guardEnd = i;
          break;
        }
      }
    }
    assert.ok(guardEnd > deleteIdx, "deleteLocalSubmissionDurably must be inside the guard's if-block, not after it");
  });

  it("the delete is best-effort (wrapped in try/catch) — a cleanup failure must never block the technician from leaving", () => {
    const deleteIdx = body.indexOf("deleteLocalSubmissionDurably(submissionId)");
    const precedingTry = body.lastIndexOf("try {", deleteIdx);
    assert.ok(precedingTry >= 0 && precedingTry < deleteIdx, "deleteLocalSubmissionDurably should be inside a try block");
  });

  it("still navigates home unconditionally (handleExitToHome), regardless of whether the delete ran", () => {
    assert.match(body, /handleExitToHome\(\)\s*;\s*\}?\s*$/);
  });
});

describe("Phase 2H — restoredFromDraftRef is genuinely the resume signal this fix relies on", () => {
  it("is only ever set true inside restoreFromDraftData (the actual resume path), never inside the auto-create-blank or Start Another paths", () => {
    const restoreBody = extractFunctionBody(
      source,
      'const restoreFromDraftData = (draft: StoredJobCardDraft["data"], restoredSubmissionId: string) => {',
    );
    assert.match(restoreBody, /restoredFromDraftRef\.current\s*=\s*true/);

    const startAnotherBody = extractFunctionBody(source, "const handleStartAnotherLocalSubmission = () => {");
    assert.ok(
      !startAnotherBody.includes("restoredFromDraftRef.current = true"),
      "Start Another Submission must NOT mark restoredFromDraftRef true — it creates a brand-new session-owned draft, not a resume",
    );
  });
});
