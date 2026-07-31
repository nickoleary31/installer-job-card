import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProductConfiguration } from "../product-config/configuration.ts";
import { resolveCompanyProductsFromRegistry } from "../product-config/registry-adapter.ts";
import {
  EXAMPLE_PRODUCT_FILE_DEFINITIONS,
  isExactSharedPpdProduct,
  ppdJsonFileDefinition,
  resolveProductFileDefinitionsForProduct,
} from "./definitions.ts";
import {
  findPpdJsonProductFile,
  hydrateAllProductFileSlotsFromPayload,
  mergeLegacyPpdIntoProductFiles,
  ppdJsonConfigFromUploadedProductFile,
  uploadedProductFileFromPpdJsonConfig,
} from "./ppd-bridge.ts";
import {
  PPD_JSON_FILE_KEY,
  PPD_PRODUCT_KEY,
  productFileSlotId,
  readUploadedProductFiles,
  mergeDurableProductFiles,
  type ProductFileDefinition,
  type ProductFileUploadSlot,
} from "./types.ts";
import {
  collectRequiredProductFileIssues,
  flattenUploadedProductFiles,
  validateProductFile,
} from "./validation.ts";

function makeFile(name: string, type = "application/json", size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

function slotWithUploaded(productKey: string, fileKey: string): ProductFileUploadSlot {
  return {
    fileKey,
    productKey,
    localFiles: [],
    uploaded: [
      {
        fileKey,
        productKey,
        originalFileName: "config.json",
        storageBucket: "customer-site-files",
        storagePath: "path/config.json",
        mimeType: "application/json",
        sizeBytes: 10,
        uploadedAt: "2026-07-12T00:00:00.000Z",
        displayLabel: "JSON Configuration File",
      },
    ],
  };
}

describe("shared PPD Product File assignment", () => {
  it("gives Matrix and Powerfleet PPD ppd_json_config", () => {
    for (const company of ["Matrix", "Powerfleet"]) {
      const ppd = resolveCompanyProductsFromRegistry(company).find(
        (product) => product.productKey === PPD_PRODUCT_KEY,
      );
      assert.ok(ppd, `${company} PPD product`);
      assert.deepEqual(
        ppd.productFileDefinitions.map((definition) => definition.key),
        [PPD_JSON_FILE_KEY],
      );
    }
  });

  it("gives every Blaxtair product no files by default", () => {
    const products = resolveCompanyProductsFromRegistry("Blaxtair");
    assert.ok(products.length >= 5);
    for (const product of products) {
      assert.deepEqual(product.productFileDefinitions, []);
    }
  });

  it("does not match a PPD base alias or a DB-like sectionKey PPD", () => {
    assert.equal(
      isExactSharedPpdProduct({
        productKey: "acme_ppd",
        sectionKey: "PPD",
        baseFormId: "ppd",
      }),
      false,
    );
    assert.deepEqual(
      resolveProductFileDefinitionsForProduct({
        productKey: "acme_ppd",
        sectionKey: "PPD",
        baseFormId: "ppd",
      }),
      [],
    );
  });

  it("matches only exact registry productKey PPD, with compatible form identity", () => {
    assert.equal(isExactSharedPpdProduct({ productKey: "PPD", formId: "ppd" }), true);
    assert.equal(isExactSharedPpdProduct({ productKey: "PPD" }), true);
    assert.equal(isExactSharedPpdProduct({ productKey: "PPD", formId: "other" }), false);
  });

  it("lets explicit definitions add files to any alias", () => {
    const definitions = resolveProductFileDefinitionsForProduct({
      productKey: "blaxtair_ahd",
      baseFormId: "ppd",
      configuration: {
        productFileDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.anotherJsonConfig],
      },
    });
    assert.equal(definitions[0]?.key, "device_json_config");
  });

  it("lets explicit [] suppress the shared PPD default", () => {
    assert.deepEqual(
      resolveProductFileDefinitionsForProduct({
        productKey: PPD_PRODUCT_KEY,
        formId: "ppd",
        configuration: { productFileDefinitions: [] },
      }),
      [],
    );
  });
});

describe("serialized compatibility", () => {
  it("reads legacy artifactDefinitions into canonical productFileDefinitions", () => {
    const parsed = parseProductConfiguration({
      artifactDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.pdfCalibration],
      futureKey: true,
    });
    assert.equal(parsed.productFileDefinitions?.[0]?.key, "calibration_report_pdf");
    assert.ok(Array.isArray(parsed.artifactDefinitions));
    assert.equal(parsed.futureKey, true);
  });

  it("honors legacy [] while canonical definitions take precedence", () => {
    assert.deepEqual(
      resolveProductFileDefinitionsForProduct({
        productKey: PPD_PRODUCT_KEY,
        configuration: { artifactDefinitions: [] },
      }),
      [],
    );
    assert.deepEqual(
      resolveProductFileDefinitionsForProduct({
        productKey: PPD_PRODUCT_KEY,
        configuration: {
          productFileDefinitions: [],
          artifactDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.anotherJsonConfig],
        },
      }),
      [],
    );
  });

  it("reads legacy productArtifacts and artifactKey", () => {
    const files = readUploadedProductFiles([
      {
        artifactKey: PPD_JSON_FILE_KEY,
        productKey: PPD_PRODUCT_KEY,
        originalFileName: "config.json",
        storageBucket: "customer-site-files",
        storagePath: "path/config.json",
        mimeType: "application/json",
        sizeBytes: 5,
        uploadedAt: "2026-07-12T00:00:00.000Z",
        displayLabel: "JSON Configuration File",
      },
    ]);
    assert.equal(files[0]?.fileKey, PPD_JSON_FILE_KEY);
  });

  it("protects cloud Product Files from thin empty memory payloads", () => {
    const cloud = [
      {
        fileKey: PPD_JSON_FILE_KEY,
        productKey: PPD_PRODUCT_KEY,
        originalFileName: "kept.json",
        storageBucket: "customer-site-files",
        storagePath: "customer-sites/c/ppd-json/p/u-kept.json",
        mimeType: "application/json",
        sizeBytes: 1,
        uploadedAt: "2026-07-31T00:00:00.000Z",
        displayLabel: "JSON Configuration File",
      },
    ];
    const protectedMerge = mergeDurableProductFiles({ cloudFiles: cloud, memoryFiles: [] });
    assert.equal(protectedMerge.thinPayloadProtected, true);
    assert.equal(protectedMerge.merged[0]?.originalFileName, "kept.json");
    const cleared = mergeDurableProductFiles({
      cloudFiles: cloud,
      memoryFiles: [],
      allowClear: true,
    });
    assert.equal(cleared.thinPayloadProtected, false);
    assert.equal(cleared.merged.length, 0);
  });
});

describe("canonical productFiles and PPD mirror", () => {
  it("hydrates canonical productFiles", () => {
    const file = slotWithUploaded(PPD_PRODUCT_KEY, PPD_JSON_FILE_KEY).uploaded[0]!;
    const slots = hydrateAllProductFileSlotsFromPayload({ productFiles: [file] });
    const id = productFileSlotId({
      productKey: PPD_PRODUCT_KEY,
      fileKey: PPD_JSON_FILE_KEY,
    });
    assert.equal(slots[id]?.uploaded[0]?.originalFileName, "config.json");
  });

  it("keeps deprecated ppd.jsonConfigFile mirror correct", () => {
    const uploaded = uploadedProductFileFromPpdJsonConfig({
      productKey: PPD_PRODUCT_KEY,
      config: {
        fileName: "config.json",
        storagePath: "path/config.json",
        publicUrl: "https://example.test/config.json",
        customerId: null,
        projectId: "project",
        companyId: "company",
        make: "M",
        model: "D",
        unitNumber: "1",
        notes: "",
        uploadedAt: "2026-07-12T00:00:00.000Z",
      },
    });
    const mirror = ppdJsonConfigFromUploadedProductFile(uploaded);
    assert.equal(mirror.fileName, "config.json");
    const merged = mergeLegacyPpdIntoProductFiles({
      productKey: PPD_PRODUCT_KEY,
      productFiles: [],
      ppd: { jsonConfigFile: mirror },
    });
    assert.equal(merged[0]?.fileKey, PPD_JSON_FILE_KEY);
  });
});

describe("Product File validation and isolation", () => {
  it("does not satisfy Product B with Product A's file", () => {
    const slots = {
      [productFileSlotId({ productKey: "product_a", fileKey: PPD_JSON_FILE_KEY })]:
        slotWithUploaded("product_a", PPD_JSON_FILE_KEY),
    };
    const definition = ppdJsonFileDefinition();
    const issues = collectRequiredProductFileIssues({
      products: [
        { productKey: "product_a", productFileDefinitions: [definition] },
        { productKey: "product_b", productFileDefinitions: [definition] },
      ],
      slots,
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.productKey, "product_b");
    assert.equal(findPpdJsonProductFile(flattenUploadedProductFiles(slots), "product_b"), undefined);
  });

  it("validates extension and optional definitions", () => {
    const definition: ProductFileDefinition = ppdJsonFileDefinition();
    assert.equal(validateProductFile(makeFile("bad.txt", "text/plain"), definition).ok, false);
    assert.equal(validateProductFile(makeFile("ok.json", ""), definition).ok, true);
    assert.deepEqual(
      collectRequiredProductFileIssues({
        products: [
          {
            productKey: "diagnostic",
            productFileDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.multiDiagnostic],
          },
        ],
        slots: {},
      }),
      [],
    );
  });
});
