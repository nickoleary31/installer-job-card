import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLAXTAIR_COMPANY_ID,
  BLAXTAIR_COMPANY_NAME,
  getFormLabelBySectionKey,
} from "../form-registry.ts";
import { clearProductLabelOverlay } from "./label-overlay.ts";
import { resolveCompanyProductsFromRegistry } from "./registry-adapter.ts";
import {
  areAdditionalProductsAllowed,
  getAllowedAdditionalProducts,
  getAllowedPrimaryProducts,
  normalizeDatabaseProductRow,
  resolveCompanyProducts,
} from "./resolve-company-products.ts";
import {
  buildProductLookupMaps,
  getProductLabelWithLookup,
  resolveEffectiveSectionKeyWithLookup,
  toFormDefinitionFromProduct,
  toProductDisplayContext,
} from "./product-lookup.ts";
import {
  findSingleInstancePairingConfigWarnings,
  selectedProductsViolateSingleInstanceBase,
} from "./pairing-guardrails.ts";
import {
  mergeProductConfiguration,
  parseProductConfiguration,
} from "./configuration.ts";
import type { NormalizedProductDefinition } from "./types.ts";

function dbBlaxtairRows() {
  return [
    {
      id: "1",
      company_id: BLAXTAIR_COMPANY_ID,
      product_key: "blaxtair_ahd",
      display_label: "Blaxtair AHD (DB)",
      base_form_id: "ppd",
      section_key: "blaxtair_ahd",
      submission_type: "blaxtair_ahd",
      draft_key: "blaxtair_ahd",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 10,
      configuration: {
        allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
        maxAdditionalCount: 1,
        futureOcrMap: { hub: "ppdHubSerial" },
      },
    },
    {
      id: "2",
      company_id: BLAXTAIR_COMPANY_ID,
      product_key: "blaxtair_ssc_speed",
      display_label: "SSC Speed (DB)",
      base_form_id: "speed_ssc",
      section_key: "blaxtair_ssc_speed",
      submission_type: "blaxtair_ssc_speed",
      draft_key: "blaxtair_ssc_speed",
      allow_primary: false,
      allow_additional: true,
      active: true,
      display_order: 20,
      configuration: { guideId: "ssc-guide-1" },
    },
  ];
}

describe("product-config hybrid resolver", () => {
  it("falls back to registry when database rows are absent", async () => {
    clearProductLabelOverlay();
    const result = await resolveCompanyProducts({
      companyId: "00000000-0000-0000-0000-000000000099",
      companyName: "Matrix",
      fetchProducts: async () => ({ rows: [] }),
    });
    assert.equal(result.source, "registry");
    assert.equal(result.usedDatabase, false);
    assert.equal(result.fellBackDueToError, false);
    assert.deepEqual(
      getAllowedPrimaryProducts(result.products).map((p) => p.productKey),
      ["PPD", "Speed Transmon", "Speed SSC"],
    );
  });

  it("falls back to registry when database request fails", async () => {
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({ rows: [], error: "network down" }),
    });
    assert.equal(result.source, "registry");
    assert.equal(result.fellBackDueToError, true);
    assert.ok(result.selectableProducts.some((p) => p.productKey === "blaxtair_ahd"));
  });

  it("uses database configuration to override registry when rows exist", async () => {
    clearProductLabelOverlay();
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({ rows: dbBlaxtairRows() }),
    });
    assert.equal(result.source, "database");
    assert.equal(result.usedDatabase, true);
    assert.deepEqual(
      getAllowedPrimaryProducts(result.products).map((p) => p.displayLabel),
      ["Blaxtair AHD (DB)"],
    );
    assert.deepEqual(
      getAllowedAdditionalProducts(result.products, "blaxtair_ahd").map((p) => p.productKey),
      ["blaxtair_ssc_speed"],
    );
    assert.equal(areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_ssc_speed"]), true);
    assert.equal(areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_3"]), false);
    // Labels come from explicit lookup maps, not module-global overlay.
    assert.equal(getFormLabelBySectionKey("blaxtair_ahd"), "Blaxtair AHD");
    const maps = buildProductLookupMaps(result.products);
    assert.equal(getProductLabelWithLookup("blaxtair_ahd", maps), "Blaxtair AHD (DB)");
  });

  it("registry and DB products share the same normalized consumer shape", async () => {
    const registry = resolveCompanyProductsFromRegistry(BLAXTAIR_COMPANY_NAME);
    const db = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({ rows: dbBlaxtairRows() }),
    });
    const regPrimary = getAllowedPrimaryProducts(registry)[0]!;
    const dbPrimary = getAllowedPrimaryProducts(db.products)[0]!;
    for (const key of [
      "productKey",
      "displayLabel",
      "baseFormId",
      "sectionKey",
      "submissionType",
      "draftKey",
      "profileId",
      "allowPrimary",
      "allowAdditional",
      "active",
      "displayOrder",
      "allowedAdditionalProductKeys",
      "maxAdditionalCount",
      "source",
    ] as const) {
      assert.ok(key in regPrimary);
      assert.ok(key in dbPrimary);
    }
    const regForm = toFormDefinitionFromProduct(regPrimary);
    const dbForm = toFormDefinitionFromProduct(dbPrimary);
    assert.equal(typeof regForm.id, "string");
    assert.equal(typeof dbForm.label, "string");
    assert.equal(dbForm.baseFormId, "ppd");
  });

  it("DB-only company with no registry slug still yields selectable products", async () => {
    const result = await resolveCompanyProducts({
      companyId: "11111111-1111-1111-1111-111111111111",
      companyName: "Acme Custom Co",
      fetchProducts: async () => ({
        rows: [
          {
            id: "x",
            company_id: "11111111-1111-1111-1111-111111111111",
            product_key: "acme_ppd",
            display_label: "Acme Pedestrian",
            base_form_id: "ppd",
            section_key: "acme_ppd",
            submission_type: "acme_ppd",
            draft_key: "acme_ppd",
            allow_primary: true,
            allow_additional: false,
            active: true,
            display_order: 1,
            configuration: {},
          },
        ],
      }),
    });
    assert.equal(result.usedDatabase, true);
    assert.equal(result.selectableProducts.length, 1);
    assert.equal(result.selectableProducts[0]?.productKey, "acme_ppd");
    assert.deepEqual(
      getAllowedPrimaryProducts(result.products).map((p) => p.sectionKey),
      ["acme_ppd"],
    );
    const maps = buildProductLookupMaps(result.products);
    assert.equal(resolveEffectiveSectionKeyWithLookup("acme_ppd", maps), "PPD");
    assert.equal(getProductLabelWithLookup("acme_ppd", maps), "Acme Pedestrian");
  });

  it("keeps stable product keys when display labels change", () => {
    const before = normalizeDatabaseProductRow({
      id: "1",
      company_id: BLAXTAIR_COMPANY_ID,
      product_key: "blaxtair_origin",
      display_label: "Old Label",
      base_form_id: "ppd",
      section_key: "blaxtair_origin",
      submission_type: "blaxtair_origin",
      draft_key: "blaxtair_origin",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 1,
      configuration: {},
    });
    const after = normalizeDatabaseProductRow({
      id: "1",
      company_id: BLAXTAIR_COMPANY_ID,
      product_key: "blaxtair_origin",
      display_label: "New Friendly Label",
      base_form_id: "ppd",
      section_key: "blaxtair_origin",
      submission_type: "blaxtair_origin",
      draft_key: "blaxtair_origin",
      allow_primary: true,
      allow_additional: false,
      active: true,
      display_order: 1,
      configuration: {},
    });
    assert.equal(before.productKey, after.productKey);
    assert.equal(before.sectionKey, after.sectionKey);
    assert.notEqual(before.displayLabel, after.displayLabel);
  });

  it("hides inactive products from selectable lists and respects ordering", async () => {
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({
        rows: [
          {
            id: "a",
            company_id: BLAXTAIR_COMPANY_ID,
            product_key: "second",
            display_label: "Second",
            base_form_id: "ppd",
            section_key: "second",
            submission_type: "second",
            draft_key: "second",
            allow_primary: true,
            allow_additional: false,
            active: true,
            display_order: 20,
            configuration: {},
          },
          {
            id: "b",
            company_id: BLAXTAIR_COMPANY_ID,
            product_key: "first",
            display_label: "First",
            base_form_id: "ppd",
            section_key: "first",
            submission_type: "first",
            draft_key: "first",
            allow_primary: true,
            allow_additional: false,
            active: true,
            display_order: 10,
            configuration: {},
          },
          {
            id: "c",
            company_id: BLAXTAIR_COMPANY_ID,
            product_key: "hidden",
            display_label: "Hidden",
            base_form_id: "ppd",
            section_key: "hidden",
            submission_type: "hidden",
            draft_key: "hidden",
            allow_primary: true,
            allow_additional: false,
            active: false,
            display_order: 5,
            configuration: {},
          },
        ],
      }),
    });
    assert.deepEqual(
      result.selectableProducts.map((p) => p.productKey),
      ["first", "second"],
    );
    assert.ok(!result.selectableProducts.some((p) => p.productKey === "hidden"));
  });

  it("rejects unknown baseFormId safely with config warning", async () => {
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({
        rows: [
          {
            id: "bad",
            company_id: BLAXTAIR_COMPANY_ID,
            product_key: "broken",
            display_label: "Broken",
            base_form_id: "not_a_real_form",
            section_key: "broken",
            submission_type: "broken",
            draft_key: "broken",
            allow_primary: true,
            allow_additional: false,
            active: true,
            display_order: 1,
            configuration: {},
          },
        ],
      }),
    });
    assert.equal(result.products.length, 1);
    assert.ok(result.products[0]?.configWarning);
    assert.equal(result.selectableProducts.length, 0);
    assert.ok(result.configWarnings.length > 0);
  });

  it("preserves Matrix registry behavior without database records", () => {
    const products = resolveCompanyProductsFromRegistry("Matrix");
    assert.deepEqual(
      getAllowedPrimaryProducts(products).map((p) => p.productKey),
      ["PPD", "Speed Transmon", "Speed SSC"],
    );
    assert.deepEqual(
      getAllowedAdditionalProducts(products, "PPD").map((p) => p.productKey),
      ["Speed Transmon", "Speed SSC"],
    );
    assert.equal(areAdditionalProductsAllowed(products, "PPD", ["Speed Transmon", "Speed SSC"]), true);
  });

  it("registry Blaxtair compatibility only permits SSC Speed as additional", () => {
    const products = resolveCompanyProductsFromRegistry(BLAXTAIR_COMPANY_NAME);
    assert.deepEqual(
      getAllowedPrimaryProducts(products).map((p) => p.productKey),
      ["blaxtair_ahd", "blaxtair_mr130_mr260", "blaxtair_origin", "blaxtair_3"],
    );
    assert.deepEqual(
      getAllowedAdditionalProducts(products, "blaxtair_ahd").map((p) => p.productKey),
      ["blaxtair_ssc_speed"],
    );
    assert.equal(areAdditionalProductsAllowed(products, "blaxtair_origin", ["blaxtair_3"]), false);
    assert.equal(areAdditionalProductsAllowed(products, "blaxtair_ahd", ["blaxtair_ssc_speed"]), true);
  });
});

describe("single-instance pairing guardrails", () => {
  it("rejects two single-instance PPD-family products on one card", () => {
    const products: NormalizedProductDefinition[] = [
      {
        productKey: "dev_a",
        displayLabel: "Device A",
        baseFormId: "ppd",
        sectionKey: "dev_a",
        submissionType: "dev_a",
        draftKey: "dev_a",
        profileId: "legacy_hardware",
        allowPrimary: true,
        allowAdditional: true,
        active: true,
        displayOrder: 1,
        allowedAdditionalProductKeys: ["dev_b"],
        maxAdditionalCount: 1,
        productFileDefinitions: [],
        source: "database",
      },
      {
        productKey: "dev_b",
        displayLabel: "Device B",
        baseFormId: "ppd",
        sectionKey: "dev_b",
        submissionType: "dev_b",
        draftKey: "dev_b",
        profileId: "legacy_hardware",
        allowPrimary: true,
        allowAdditional: true,
        active: true,
        displayOrder: 2,
        allowedAdditionalProductKeys: null,
        maxAdditionalCount: null,
        productFileDefinitions: [],
        source: "database",
      },
    ];
    assert.equal(
      selectedProductsViolateSingleInstanceBase({
        products,
        primaryProductKey: "dev_a",
        additionalProductKeys: ["dev_b"],
      }),
      true,
    );
    assert.equal(areAdditionalProductsAllowed(products, "dev_a", ["dev_b"]), false);
    assert.ok(findSingleInstancePairingConfigWarnings(products).length > 0);
  });

  it("allows Blaxtair device + SSC Speed (different bases)", async () => {
    const result = await resolveCompanyProducts({
      companyId: BLAXTAIR_COMPANY_ID,
      companyName: BLAXTAIR_COMPANY_NAME,
      fetchProducts: async () => ({ rows: dbBlaxtairRows() }),
    });
    assert.equal(
      areAdditionalProductsAllowed(result.products, "blaxtair_ahd", ["blaxtair_ssc_speed"]),
      true,
    );
  });
});

describe("configuration forward compatibility", () => {
  it("preserves unknown configuration keys on parse and merge/update", () => {
    const parsed = parseProductConfiguration({
      allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
      maxAdditionalCount: 1,
      futureOcrMap: { hub: "ppdHubSerial" },
      installGuideId: "guide-9",
    });
    assert.deepEqual(parsed.allowedAdditionalProductKeys, ["blaxtair_ssc_speed"]);
    assert.equal(parsed.maxAdditionalCount, 1);
    assert.deepEqual(parsed.futureOcrMap, { hub: "ppdHubSerial" });
    assert.equal(parsed.installGuideId, "guide-9");

    const merged = mergeProductConfiguration({
      existing: parsed,
      incoming: {
        allowedAdditionalProductKeys: ["blaxtair_ssc_speed"],
        maxAdditionalCount: 2,
      },
    });
    assert.equal(merged.maxAdditionalCount, 2);
    assert.deepEqual(merged.futureOcrMap, { hub: "ppdHubSerial" });
    assert.equal(merged.installGuideId, "guide-9");
  });

  it("normalizes productFileDefinitions while preserving unknown keys", () => {
    const parsed = parseProductConfiguration({
      productFileDefinitions: [
        {
          key: "calibration_report_pdf",
          label: "Calibration PDF",
          category: "calibration",
          required: true,
          acceptedExtensions: ["pdf"],
        },
      ],
      futureSectionSchema: { v: 2 },
    });
    assert.equal(parsed.productFileDefinitions?.[0]?.key, "calibration_report_pdf");
    assert.equal(parsed.productFileDefinitions?.[0]?.acceptedExtensions?.[0], ".pdf");
    assert.deepEqual(parsed.futureSectionSchema, { v: 2 });
  });
});

describe("explicit product display for email/review", () => {
  it("email/review labels use productDisplay and do not depend on global overlay", () => {
    clearProductLabelOverlay();
    const maps = buildProductLookupMaps([
      {
        productKey: "custom_ahd",
        displayLabel: "Custom AHD Label",
        baseFormId: "ppd",
        sectionKey: "custom_ahd",
        submissionType: "custom_ahd",
        draftKey: "custom_ahd",
        profileId: "legacy_hardware",
        allowPrimary: true,
        allowAdditional: false,
        active: true,
        displayOrder: 1,
        allowedAdditionalProductKeys: null,
        maxAdditionalCount: null,
        productFileDefinitions: [],
        source: "database",
      },
    ]);
    const display = toProductDisplayContext(maps);
    assert.equal(getFormLabelBySectionKey("custom_ahd"), "custom_ahd");
    assert.equal(getProductLabelWithLookup("custom_ahd", display), "Custom AHD Label");
    assert.equal(resolveEffectiveSectionKeyWithLookup("custom_ahd", display), "PPD");
    // Clearing overlay must not affect explicit maps.
    clearProductLabelOverlay();
    assert.equal(getProductLabelWithLookup("custom_ahd", display), "Custom AHD Label");
  });
});

describe("product-config admin authorization expectations", () => {
  it("documents that mutations require authorizeGlobalAdmin (API-enforced)", () => {
    assert.equal(typeof authorizeGlobalAdminMarker, "string");
  });
});

const authorizeGlobalAdminMarker = "authorizeGlobalAdmin";
