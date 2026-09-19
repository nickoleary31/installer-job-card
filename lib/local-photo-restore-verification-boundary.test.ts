import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Phase 2G cleanup pass — regression guard proving the actual production
 * restore path (components/NewSubmissionForm.tsx's restoreFromDraftData())
 * really does route restored durable-local photo references through
 * verifyDurablePhotoReferences() before they can be trusted, rather than
 * this being a claim only true in a design doc. Inspects the real source
 * file — no React component test harness exists in this codebase (see
 * local-submission-photo-boundary.test.ts's own doc for why that's the
 * right tool here).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_SUBMISSION_FORM_PATH = join(__dirname, "..", "components", "NewSubmissionForm.tsx");
const source = readFileSync(NEW_SUBMISSION_FORM_PATH, "utf8");

/** Brace-depth extraction — robust to nested object literals/ternaries inside the function body. */
function extractFunctionBody(src: string, signatureNeedle: string): string {
  const sigIdx = src.indexOf(signatureNeedle);
  assert.ok(sigIdx >= 0, `Could not find "${signatureNeedle}" in NewSubmissionForm.tsx — has it been renamed/moved? Update this test's needle.`);
  const braceStart = src.indexOf("{", sigIdx);
  assert.ok(braceStart >= 0, "Could not find the opening brace of restoreFromDraftData");
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting restoreFromDraftData's body — source may have changed shape");
}

describe("Phase 2G cleanup — restoreFromDraftData verifies durable-local photo references before trusting them", () => {
  const body = extractFunctionBody(
    source,
    'const restoreFromDraftData = (draft: StoredJobCardDraft["data"], restoredSubmissionId: string) => {',
  );

  it("extracted a real, non-trivial function body (sanity check the extraction itself)", () => {
    assert.ok(body.length > 2000, "restoreFromDraftData's body looks suspiciously short — extraction may have failed silently");
    assert.match(body, /restoredMetadataByField/, "extracted body doesn't look like restoreFromDraftData — sanity check failed");
  });

  it("calls verifyDurablePhotoReferences on the restored photo metadata rather than trusting it unconditionally", () => {
    assert.match(body, /verifyDurablePhotoReferences\(/);
  });

  it("a dropped reference is removed from photoMetadataByField via setPhotoMetadataByFieldSafe — the same state every required-photo count/collectReviewValidationIssues reads from", () => {
    assert.match(body, /droppedLocalPhotoIds/);
    assert.match(body, /setPhotoMetadataByFieldSafe/);
  });

  it("never calls deleteLocalPhotoDurably/deleteJobCardPhotoObject as part of this verification — dropping a stale reference must not repair/delete the underlying durable row or file", () => {
    // Scope the check to the verification block specifically (from
    // verifyDurablePhotoReferences( to the end of the extracted body) so a
    // legitimate delete call elsewhere in restoreFromDraftData (there is
    // none today) wouldn't produce a false failure here.
    const verificationBlockStart = body.indexOf("verifyDurablePhotoReferences(");
    assert.ok(verificationBlockStart >= 0);
    const verificationBlock = body.slice(verificationBlockStart);
    assert.ok(!verificationBlock.includes("deleteLocalPhotoDurably"), "verification must never delete the durable LocalPhoto row");
    assert.ok(!verificationBlock.includes("deleteJobCardPhotoObject"), "verification must never trigger the delete choke point");
  });
});
