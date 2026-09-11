import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCompletedSubmissionCount } from "./project-progress-display.ts";

describe("formatCompletedSubmissionCount", () => {
  it("uses Target as the denominator when Finalized is null (active / not finalized)", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 2, saTargetAssetCount: 6, saFinalizedAssetCount: null }),
      "2 / 6",
    );
  });

  it("uses Finalized as the denominator when it is populated, not Target (finalized)", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 2, saTargetAssetCount: 6, saFinalizedAssetCount: 2 }),
      "2 / 2",
    );
  });

  it("treats Finalized = 0 as a real finalized value, not as missing/null — never falls back to Target", () => {
    const result = formatCompletedSubmissionCount({
      completedSubmissionCount: 0,
      saTargetAssetCount: 6,
      saFinalizedAssetCount: 0,
    });
    assert.equal(result, "0 / 0");
    assert.notEqual(result, "0 / 6");
  });

  it("preserves the existing plain-count display when neither Target nor Finalized is present", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 7, saTargetAssetCount: null, saFinalizedAssetCount: null }),
      "7",
    );
  });

  it("uses Finalized even when Target is null (finalized takes priority regardless of Target's presence)", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 17, saTargetAssetCount: null, saFinalizedAssetCount: 17 }),
      "17 / 17",
    );
  });

  it("the 100 -> 17/17 example from the locked V1 progress model: original Target=100 is not shown once Finalized=17, but is never mutated by this function (display-only)", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 17, saTargetAssetCount: 100, saFinalizedAssetCount: 17 }),
      "17 / 17",
    );
  });

  it("0 completed submissions against a real Target with Finalized still null renders 0 / Target, not the plain count", () => {
    assert.equal(
      formatCompletedSubmissionCount({ completedSubmissionCount: 0, saTargetAssetCount: 100, saFinalizedAssetCount: null }),
      "0 / 100",
    );
  });
});
