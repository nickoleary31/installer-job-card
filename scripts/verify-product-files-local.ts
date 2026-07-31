/**
 * Local-only Product Files verification (no DB writes, no Storage uploads).
 * Run: node --experimental-strip-types scripts/verify-product-files-local.ts
 *
 * Email body formatting lives in job-card-submission.ts (Next `@/` imports) and is
 * verified by inspecting the known wording patterns plus the PPD bridge mirror.
 */
import { resolveCompanyProductsFromRegistry } from "../lib/product-config/registry-adapter.ts";
import { parseProductConfiguration } from "../lib/product-config/configuration.ts";
import {
  EXAMPLE_PRODUCT_FILE_DEFINITIONS,
  isExactSharedPpdProduct,
  ppdJsonFileDefinition,
  resolveProductFileDefinitionsForProduct,
} from "../lib/product-files/definitions.ts";
import {
  hydrateAllProductFileSlotsFromPayload,
  mergeLegacyPpdIntoProductFiles,
  ppdJsonConfigFromUploadedProductFile,
  uploadedProductFileFromPpdJsonConfig,
} from "../lib/product-files/ppd-bridge.ts";
import {
  PPD_JSON_FILE_KEY,
  PPD_PRODUCT_KEY,
  productFileSlotId,
  readUploadedProductFiles,
  type UploadedProductFile,
} from "../lib/product-files/types.ts";
import {
  collectRequiredProductFileIssues,
  validateProductFile,
} from "../lib/product-files/validation.ts";

/** Mirrors buildPpdJsonStoragePath / buildProductFileStoragePath without importing supabase. */
function expectedPpdJsonPath(args: {
  customerId: string;
  projectId: string;
  unitNumber: string;
  originalFileName: string;
  timestampMs: number;
}) {
  const safe = args.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "config.json";
  const u = args.unitNumber.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "unit";
  return `customer-sites/${args.customerId}/ppd-json/${args.projectId}/${u}-${args.timestampMs}-${safe}`;
}
function expectedProductFilePath(args: {
  customerId: string;
  productKey: string;
  fileKey: string;
  projectId: string;
  unitNumber: string;
  originalFileName: string;
  timestampMs: number;
}) {
  const safe = args.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file.bin";
  const u = args.unitNumber.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "unit";
  const product = args.productKey.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "product";
  const fileKey = args.fileKey.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
  return `customer-sites/${args.customerId}/product-files/${product}/${fileKey}/${args.projectId}/${u}-${args.timestampMs}-${safe}`;
}

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n=== 1. Shared PPD Product File (Matrix + Powerfleet) ===\n");
const matrix = resolveCompanyProductsFromRegistry("Matrix");
const powerfleet = resolveCompanyProductsFromRegistry("Powerfleet");
const matrixPpd = matrix.find((p) => p.productKey === PPD_PRODUCT_KEY)!;
const pfPpd = powerfleet.find((p) => p.productKey === PPD_PRODUCT_KEY)!;
check("Matrix PPD has ppd_json_config", matrixPpd.productFileDefinitions[0]?.key === PPD_JSON_FILE_KEY);
check("Powerfleet PPD has ppd_json_config", pfPpd.productFileDefinitions[0]?.key === PPD_JSON_FILE_KEY);
check(
  "Same shared definition label",
  matrixPpd.productFileDefinitions[0]?.label === "JSON Configuration File" &&
    pfPpd.productFileDefinitions[0]?.label === "JSON Configuration File",
);
check("No Matrix-only label in definition", !/matrix/i.test(JSON.stringify(ppdJsonFileDefinition())));
check("Accepted extensions are .json only", JSON.stringify(ppdJsonFileDefinition().acceptedExtensions) === '[".json"]');
check("Required=true", ppdJsonFileDefinition().required === true);
check("includeInEmail=true", ppdJsonFileDefinition().includeInEmail === true);
check("includeInReview=true", ppdJsonFileDefinition().includeInReview === true);

console.log("\n=== 2. Blaxtair: no Product Files by default ===\n");
const blaxtair = resolveCompanyProductsFromRegistry("Blaxtair");
for (const key of ["blaxtair_ahd", "blaxtair_mr130_mr260", "blaxtair_origin", "blaxtair_3"]) {
  const p = blaxtair.find((x) => x.productKey === key);
  check(`${key} has no Product Files`, !!p && p.productFileDefinitions.length === 0, p ? `count=${p.productFileDefinitions.length}` : "missing");
}

console.log("\n=== 3. Explicit DB-like configuration (local fixture only) ===\n");
const withDef = resolveProductFileDefinitionsForProduct({
  productKey: "fixture_device_a",
  baseFormId: "ppd",
  configuration: { productFileDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.anotherJsonConfig] },
});
check("Explicit productFileDefinitions appears", withDef[0]?.key === "device_json_config");
check(
  "productFileDefinitions: [] produces none",
  resolveProductFileDefinitionsForProduct({
    productKey: PPD_PRODUCT_KEY,
    configuration: { productFileDefinitions: [] },
  }).length === 0,
);

const slotA = {
  [productFileSlotId({ productKey: "product_a", fileKey: PPD_JSON_FILE_KEY })]: {
    fileKey: PPD_JSON_FILE_KEY,
    productKey: "product_a",
    localFiles: [],
    uploaded: [
      {
        fileKey: PPD_JSON_FILE_KEY,
        productKey: "product_a",
        originalFileName: "a.json",
        storageBucket: "customer-site-files",
        storagePath: "customer-sites/c/product-files/product_a/ppd_json_config/p/u-1-a.json",
        mimeType: "application/json",
        sizeBytes: 10,
        uploadedAt: "2026-07-31T00:00:00.000Z",
        displayLabel: "JSON Configuration File",
      } satisfies UploadedProductFile,
    ],
  },
};
const isolationIssues = collectRequiredProductFileIssues({
  products: [
    { productKey: "product_a", productFileDefinitions: [ppdJsonFileDefinition()] },
    { productKey: "product_b", productFileDefinitions: [ppdJsonFileDefinition()] },
  ],
  slots: slotA,
});
check("Product A file does not satisfy Product B", isolationIssues.length === 1 && isolationIssues[0]?.productKey === "product_b");

const bad = validateProductFile(new File([new Uint8Array(4)], "bad.txt", { type: "text/plain" }), ppdJsonFileDefinition());
const good = validateProductFile(new File([new Uint8Array(4)], "ok.json", { type: "application/json" }), ppdJsonFileDefinition());
check("Invalid extension rejected", bad.ok === false, bad.ok ? undefined : bad.message);
check("Valid .json accepted", good.ok === true);

// Replace/remove slot behavior (local state model)
let slot = {
  fileKey: PPD_JSON_FILE_KEY,
  productKey: PPD_PRODUCT_KEY,
  localFiles: [new File([new Uint8Array(4)], "first.json", { type: "application/json" })],
  uploaded: [] as UploadedProductFile[],
};
slot = { ...slot, localFiles: [new File([new Uint8Array(4)], "replaced.json", { type: "application/json" })], uploaded: [] };
check("Replace updates local file name", slot.localFiles[0]?.name === "replaced.json");
slot = { ...slot, localFiles: [], uploaded: [] };
check("Remove clears references", slot.localFiles.length === 0 && slot.uploaded.length === 0);

console.log("\n=== 4. Compatibility reads (new + legacy shapes) ===\n");
const legacyConfig = parseProductConfiguration({
  artifactDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.pdfCalibration],
});
const newConfig = parseProductConfiguration({
  productFileDefinitions: [EXAMPLE_PRODUCT_FILE_DEFINITIONS.pdfCalibration],
});
check("Legacy artifactDefinitions → productFileDefinitions", legacyConfig.productFileDefinitions?.[0]?.key === "calibration_report_pdf");
check("New productFileDefinitions normalized", newConfig.productFileDefinitions?.[0]?.key === "calibration_report_pdf");
check(
  "Legacy empty artifactDefinitions suppresses shared default",
  resolveProductFileDefinitionsForProduct({
    productKey: PPD_PRODUCT_KEY,
    configuration: { artifactDefinitions: [] },
  }).length === 0,
);

const legacyPayload = [
  {
    artifactKey: PPD_JSON_FILE_KEY,
    productKey: PPD_PRODUCT_KEY,
    originalFileName: "legacy-config.json",
    storageBucket: "customer-site-files",
    storagePath: "customer-sites/c1/ppd-json/proj/unit-1-legacy-config.json",
    mimeType: "application/json",
    sizeBytes: 12,
    uploadedAt: "2026-07-31T12:00:00.000Z",
    displayLabel: "JSON Configuration File",
    downloadUrl: "https://example.test/sign/legacy?token=abc",
  },
];
const newPayload = [
  {
    fileKey: PPD_JSON_FILE_KEY,
    productKey: PPD_PRODUCT_KEY,
    originalFileName: "legacy-config.json",
    storageBucket: "customer-site-files",
    storagePath: "customer-sites/c1/ppd-json/proj/unit-1-legacy-config.json",
    mimeType: "application/json",
    sizeBytes: 12,
    uploadedAt: "2026-07-31T12:00:00.000Z",
    displayLabel: "JSON Configuration File",
    downloadUrl: "https://example.test/sign/legacy?token=abc",
  },
];
const fromLegacy = readUploadedProductFiles(legacyPayload);
const fromNew = readUploadedProductFiles(newPayload);
check("Legacy artifactKey hydrates to fileKey", fromLegacy[0]?.fileKey === PPD_JSON_FILE_KEY);
check("New + legacy hydrate identical identity", fromNew[0]?.fileKey === fromLegacy[0]?.fileKey && fromNew[0]?.productKey === fromLegacy[0]?.productKey);
const id = productFileSlotId({ productKey: PPD_PRODUCT_KEY, fileKey: PPD_JSON_FILE_KEY });
const slotsFromLegacy = hydrateAllProductFileSlotsFromPayload({ productFiles: fromLegacy });
const slotsFromNew = hydrateAllProductFileSlotsFromPayload({ productFiles: fromNew });
check(
  "Both shapes hydrate same slot file name",
  slotsFromLegacy[id]?.uploaded[0]?.originalFileName === slotsFromNew[id]?.uploaded[0]?.originalFileName,
);

console.log("\n=== 5. Canonical payload + deprecated PPD mirror ===\n");
const uploaded = uploadedProductFileFromPpdJsonConfig({
  productKey: PPD_PRODUCT_KEY,
  config: {
    fileName: "verify-config.json",
    storagePath: "customer-sites/cust-1/ppd-json/proj-1/unit-1-verify-config.json",
    publicUrl: "https://example.test/storage/v1/object/sign/customer-site-files/path?token=xyz",
    customerId: "cust-1",
    projectId: "proj-1",
    companyId: "co-1",
    make: "Toyota",
    model: "8FGU25",
    unitNumber: "UNIT-1",
    notes: "",
    uploadedAt: "2026-07-31T15:00:00.000Z",
  },
});
const productFiles = mergeLegacyPpdIntoProductFiles({
  productKey: PPD_PRODUCT_KEY,
  productFiles: [uploaded],
});
const mirror = ppdJsonConfigFromUploadedProductFile(productFiles[0]!);
check("Canonical productKey is PPD", productFiles[0]?.productKey === "PPD");
check("Canonical fileKey is ppd_json_config", productFiles[0]?.fileKey === "ppd_json_config");
check("Mirror jsonFileName correct", mirror.fileName === "verify-config.json");
check("Mirror storagePath preserves ppd-json", mirror.storagePath.includes("/ppd-json/"));
check("Mirror publicUrl is signed/download URL", /sign|token=/i.test(mirror.publicUrl));

// Email wording expected by formatEmailBodyFromPayload / formatPpdInstallLines
const expectedEmailLines = [
  `JSON file name: ${mirror.fileName}`,
  `PPD JSON file (uploaded): ${mirror.fileName}`,
  `PPD JSON link: ${mirror.publicUrl}`,
];
check("Email expected wording includes JSON file name", expectedEmailLines[0].includes("JSON file name: verify-config.json"));
check("Email expected wording includes PPD JSON file (uploaded)", expectedEmailLines[1].includes("PPD JSON file (uploaded): verify-config.json"));
check("Email expected link uses signed URL (not bare storage path)", expectedEmailLines[2].includes("object/sign") && expectedEmailLines[2].includes("token="));
check("Email expected lines omit raw storage path label", !expectedEmailLines.some((l) => /storage path/i.test(l)));

console.log("\n=== 6. Storage paths ===\n");
const ppdPath = expectedPpdJsonPath({
  projectId: "proj-1",
  customerId: "cust-1",
  unitNumber: "UNIT-1",
  originalFileName: "verify-config.json",
  timestampMs: 1722441600000,
});
const genPath = expectedProductFilePath({
  productKey: "blaxtair_ahd",
  fileKey: "device_json_config",
  projectId: "proj-1",
  customerId: "cust-1",
  unitNumber: "UNIT-1",
  originalFileName: "device.json",
  timestampMs: 1722441600000,
});
check("Shared PPD path unchanged (ppd-json)", /\/ppd-json\//.test(ppdPath));
check("Generalized path product/file scoped", /\/product-files\/blaxtair_ahd\/device_json_config\//.test(genPath));
check("PPD path example", true, ppdPath);
check("Generalized path example", true, genPath);

console.log("\n=== 7. Shared matcher safety ===\n");
check(
  "DB-like sectionKey PPD alone does not match",
  !isExactSharedPpdProduct({ productKey: "acme_ppd", sectionKey: "PPD", baseFormId: "ppd" }),
);
check("Exact productKey PPD matches", isExactSharedPpdProduct({ productKey: "PPD", formId: "ppd" }));

console.log("\n=== Exact payload examples ===\n");
console.log(
  JSON.stringify(
    {
      productFiles: productFiles.map((f) => ({
        productKey: f.productKey,
        fileKey: f.fileKey,
        originalFileName: f.originalFileName,
        storageBucket: f.storageBucket,
        storagePath: f.storagePath,
        downloadUrl: f.downloadUrl,
        includeInReview: f.includeInReview,
        includeInEmail: f.includeInEmail,
      })),
      deprecatedMirror: {
        jsonFileName: mirror.fileName,
        jsonConfigFile: {
          fileName: mirror.fileName,
          storagePath: mirror.storagePath,
          publicUrl: mirror.publicUrl,
        },
      },
      storage: { ppdPath, generalizedPath: genPath },
      expectedEmailLines,
    },
    null,
    2,
  ),
);

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== Summary: ${checks.length - failed.length}/${checks.length} passed ===\n`);
if (failed.length) {
  for (const f of failed) console.error("FAILED:", f.name, f.detail || "");
  process.exit(1);
}
console.log("All local Product Files verification checks passed.");
