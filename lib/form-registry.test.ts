import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLAXTAIR_COMPANY_ID,
  BLAXTAIR_COMPANY_NAME,
  areAdditionalSectionKeysAllowed,
  formatSectionKeysAsLabels,
  getAllowedAdditionalSectionKeys,
  getAllowedPrimaryForms,
  getFormLabelBySectionKey,
  getFormsForCompanyName,
  getFormsForCompanySlug,
  isBlaxtairDeviceSectionKey,
  resolveCompanySlug,
  resolveEffectiveSectionKey,
  selectedSectionsIncludeEffective,
} from "./form-registry.ts";

describe("form-registry Blaxtair association", () => {
  it("resolves existing Blaxtair company name to slug without seeding", () => {
    assert.equal(resolveCompanySlug(BLAXTAIR_COMPANY_NAME), "blaxtair");
    assert.equal(resolveCompanySlug("blaxtair"), "blaxtair");
    assert.equal(BLAXTAIR_COMPANY_ID, "b3d9abe4-e457-4bb4-935b-4bb01920df89");
  });

  it("assigns five Blaxtair products with unique ids (SSC remains for secondary)", () => {
    const forms = getFormsForCompanySlug("blaxtair");
    assert.deepEqual(
      forms.map((f) => f.id),
      [
        "blaxtair_ahd",
        "blaxtair_mr130_mr260",
        "blaxtair_origin",
        "blaxtair_3",
        "blaxtair_ssc_speed",
      ],
    );
    assert.deepEqual(
      forms.map((f) => f.label),
      [
        "Blaxtair AHD",
        "Blaxtair MR130-MR260",
        "Blaxtair Origin",
        "Blaxtair 3",
        "SSC Speed",
      ],
    );
    const sectionKeys = new Set(forms.map((f) => f.sectionKey));
    assert.equal(sectionKeys.size, 5);
  });

  it("offers only Blaxtair devices as primary; SSC Speed is secondary-only", () => {
    assert.deepEqual(
      getAllowedPrimaryForms(BLAXTAIR_COMPANY_NAME).map((f) => f.id),
      ["blaxtair_ahd", "blaxtair_mr130_mr260", "blaxtair_origin", "blaxtair_3"],
    );
    assert.ok(!getAllowedPrimaryForms(BLAXTAIR_COMPANY_NAME).some((f) => f.id === "blaxtair_ssc_speed"));
  });

  it("maps Blaxtair products to Matrix PPD / Speed SSC bases", () => {
    assert.equal(resolveEffectiveSectionKey("blaxtair_ahd"), "PPD");
    assert.equal(resolveEffectiveSectionKey("blaxtair_mr130_mr260"), "PPD");
    assert.equal(resolveEffectiveSectionKey("blaxtair_origin"), "PPD");
    assert.equal(resolveEffectiveSectionKey("blaxtair_3"), "PPD");
    assert.equal(resolveEffectiveSectionKey("blaxtair_ssc_speed"), "Speed SSC");
    assert.equal(resolveEffectiveSectionKey("PPD"), "PPD");
    assert.equal(resolveEffectiveSectionKey("Speed SSC"), "Speed SSC");
  });

  it("treats Blaxtair PPD aliases as including PPD for shared UI/email", () => {
    assert.equal(selectedSectionsIncludeEffective(["blaxtair_ahd"], "PPD"), true);
    assert.equal(selectedSectionsIncludeEffective(["blaxtair_ssc_speed"], "PPD"), false);
    assert.equal(selectedSectionsIncludeEffective(["blaxtair_ssc_speed"], "Speed SSC"), true);
    assert.equal(selectedSectionsIncludeEffective(["blaxtair_ahd", "blaxtair_ssc_speed"], "PPD"), true);
    assert.equal(selectedSectionsIncludeEffective(["blaxtair_ahd", "blaxtair_ssc_speed"], "Speed SSC"), true);
  });

  it("preserves Matrix assignments and primary options unchanged", () => {
    const matrix = getFormsForCompanyName("Matrix");
    assert.deepEqual(
      matrix.map((f) => f.id),
      ["ppd", "speed_transmon", "speed_ssc"],
    );
    assert.deepEqual(
      getAllowedPrimaryForms("Matrix").map((f) => f.id),
      ["ppd", "speed_transmon", "speed_ssc"],
    );
    assert.deepEqual(getAllowedAdditionalSectionKeys("Matrix", "PPD"), [
      "Speed Transmon",
      "Speed SSC",
    ]);
    assert.equal(areAdditionalSectionKeysAllowed("Matrix", "PPD", ["Speed SSC"]), true);
    assert.equal(areAdditionalSectionKeysAllowed("Matrix", "PPD", ["Speed Transmon", "Speed SSC"]), true);
  });

  it("allows Blaxtair device + SSC Speed and rejects two Blaxtair devices together", () => {
    for (const primary of [
      "blaxtair_ahd",
      "blaxtair_mr130_mr260",
      "blaxtair_origin",
      "blaxtair_3",
    ]) {
      assert.equal(isBlaxtairDeviceSectionKey(primary), true);
      assert.deepEqual(getAllowedAdditionalSectionKeys(BLAXTAIR_COMPANY_NAME, primary), [
        "blaxtair_ssc_speed",
      ]);
      assert.equal(
        areAdditionalSectionKeysAllowed(BLAXTAIR_COMPANY_NAME, primary, ["blaxtair_ssc_speed"]),
        true,
      );
      assert.equal(
        areAdditionalSectionKeysAllowed(BLAXTAIR_COMPANY_NAME, primary, ["blaxtair_3"]),
        false,
      );
      assert.equal(
        areAdditionalSectionKeysAllowed(BLAXTAIR_COMPANY_NAME, primary, [
          "blaxtair_origin",
          "blaxtair_ssc_speed",
        ]),
        false,
      );
    }

    assert.equal(
      areAdditionalSectionKeysAllowed(BLAXTAIR_COMPANY_NAME, "blaxtair_origin", ["blaxtair_3"]),
      false,
    );
    assert.equal(
      areAdditionalSectionKeysAllowed(BLAXTAIR_COMPANY_NAME, "blaxtair_ahd", ["blaxtair_mr130_mr260"]),
      false,
    );
  });

  it("exposes friendly labels for Blaxtair IDs without changing stored keys", () => {
    assert.equal(getFormLabelBySectionKey("blaxtair_ahd"), "Blaxtair AHD");
    assert.equal(getFormLabelBySectionKey("blaxtair_mr130_mr260"), "Blaxtair MR130-MR260");
    assert.equal(getFormLabelBySectionKey("blaxtair_origin"), "Blaxtair Origin");
    assert.equal(getFormLabelBySectionKey("blaxtair_3"), "Blaxtair 3");
    assert.equal(getFormLabelBySectionKey("blaxtair_ssc_speed"), "SSC Speed");
    assert.equal(
      formatSectionKeysAsLabels(["blaxtair_ahd", "blaxtair_ssc_speed"]),
      "Blaxtair AHD, SSC Speed",
    );
    assert.equal(getFormLabelBySectionKey("PPD"), "PPD");
    assert.equal(getFormLabelBySectionKey("Speed SSC"), "Speed SSC");
  });
});
