import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSectionKeysAsLabels,
  getFormDefinitionById,
  getFormLabelBySectionKey,
} from "./form-registry.ts";

/**
 * Mirrors email subject/header product resolution (labels only; IDs stay on the payload).
 * Kept local to the test so we do not pull Next/@-path email modules into node:test.
 */
function resolveEmailProductDisplayLabel(args: {
  linxupProductLabel?: string | null;
  primarySectionKey?: string | null;
  formId?: string | null;
  submissionType?: string | null;
}): string {
  return (
    args.linxupProductLabel?.trim() ||
    getFormLabelBySectionKey(args.primarySectionKey) ||
    getFormDefinitionById(args.formId)?.label ||
    getFormDefinitionById(args.submissionType)?.label ||
    args.submissionType?.trim() ||
    args.formId?.trim() ||
    args.primarySectionKey?.trim() ||
    ""
  );
}

function formatEmailSubjectLike(productLabel: string, customer: string, unit: string): string {
  return `Installer Job Card - ${productLabel} - ${customer} - ${unit}`;
}

describe("Blaxtair review/email display labels", () => {
  it("resolves subject/header/primary/additional from registry labels, not raw IDs", () => {
    const primary = "blaxtair_ahd";
    const additional = ["blaxtair_ssc_speed"];
    const productName = resolveEmailProductDisplayLabel({
      primarySectionKey: primary,
      formId: primary,
      submissionType: primary,
    });
    const subject = formatEmailSubjectLike(productName, "Nucor Terrell", "UNIT-B1");
    const primaryLabel = getFormLabelBySectionKey(primary);
    const additionalLabel = formatSectionKeysAsLabels(additional);

    assert.equal(productName, "Blaxtair AHD");
    assert.equal(primaryLabel, "Blaxtair AHD");
    assert.equal(additionalLabel, "SSC Speed");
    assert.equal(subject, "Installer Job Card - Blaxtair AHD - Nucor Terrell - UNIT-B1");
    assert.doesNotMatch(subject, /blaxtair_ahd/);
    assert.doesNotMatch(primaryLabel, /blaxtair_/);
    assert.doesNotMatch(additionalLabel, /blaxtair_/);
  });

  it("labels every Blaxtair device and SSC Speed for review/email surfaces", () => {
    const cases = [
      ["blaxtair_ahd", "Blaxtair AHD"],
      ["blaxtair_mr130_mr260", "Blaxtair MR130-MR260"],
      ["blaxtair_origin", "Blaxtair Origin"],
      ["blaxtair_3", "Blaxtair 3"],
      ["blaxtair_ssc_speed", "SSC Speed"],
    ] as const;
    for (const [id, label] of cases) {
      assert.equal(getFormLabelBySectionKey(id), label);
      assert.equal(
        resolveEmailProductDisplayLabel({ primarySectionKey: id, formId: id, submissionType: id }),
        label,
      );
      assert.doesNotMatch(
        resolveEmailProductDisplayLabel({ primarySectionKey: id, formId: id, submissionType: id }),
        /blaxtair_/,
      );
    }
  });

  it("keeps Matrix display labels unchanged", () => {
    assert.equal(
      resolveEmailProductDisplayLabel({
        primarySectionKey: "PPD",
        formId: "ppd",
        submissionType: "PPD",
      }),
      "PPD",
    );
    assert.equal(formatSectionKeysAsLabels(["Speed Transmon", "Speed SSC"]), "Speed Transmon, Speed SSC");
  });
});
