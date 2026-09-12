import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCompletedSubmissionCount } from "./project-progress-display.ts";

describe("formatCompletedSubmissionCount", () => {
  it("uses Target as the denominator when Finalized is null", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 0, saTargetAssetCount: 4, saFinalizedAssetCount: null }),
      "0 / 4",
    );
  });

  it("still uses Target when Finalized is 0 — Finalized never overrides the denominator, even at zero", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 0, saTargetAssetCount: 4, saFinalizedAssetCount: 0 }),
      "0 / 4",
    );
  });

  it("still uses Target when Finalized is populated with a real number — Finalized being set does not by itself mean the batch was intentionally finalized", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 0, saTargetAssetCount: 4, saFinalizedAssetCount: 2 }),
      "0 / 4",
    );
  });

  it("Target stays the denominator as completed submissions rise, regardless of Finalized", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 2, saTargetAssetCount: 4, saFinalizedAssetCount: 2 }),
      "2 / 4",
    );
  });

  it("preserves the existing plain-count display when Target is null, regardless of Finalized's value", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 7, saTargetAssetCount: null, saFinalizedAssetCount: null }),
      "7",
    );
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 7, saTargetAssetCount: null, saFinalizedAssetCount: 17 }),
      "7",
    );
  });

  it("treats Target = 0 as a real target value, not as missing/null", () => {
    const result = formatCompletedSubmissionCount({
      completedSubmissionCount: 0,
      saTargetAssetCount: 0,
      saFinalizedAssetCount: null,
    });
    assert.equal(result, "0 / 0");
    assert.notEqual(result, "0");
  });
});
