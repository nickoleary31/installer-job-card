import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPublicPhotoUrl,
  normalizePayloadStorageUrls,
  validatePayloadStorageReferences,
  validatePhotoStoragePath,
  validateProductFileReference,
  type StorageScope,
} from "./storage-references.ts";

const scope = (overrides: Partial<StorageScope> = {}): StorageScope => ({
  companyId: "company-A",
  projectId: "project-1",
  submissionId: "sub-1",
  uploaderUserId: "user-1",
  allowLegacyWebPhotoPaths: false,
  ...overrides,
});

const NATIVE = "company-A/project-1/user-1/sub-1/vehicle/vehicleFrontPhoto/photo-1.jpg";
const NATIVE_OLD = "company-A/project-1/sub-1/vehicle/vehicleFrontPhoto/photo-1.jpg";
const WEB = "sub-1/vehicle/vehicleFrontPhoto/1718000000000-front.jpg";

describe("validatePhotoStoragePath — native finalize scope (uploader-bound, no legacy web paths)", () => {
  it("accepts the requester's own path inside the authorized submission", () => {
    assert.deepEqual(validatePhotoStoragePath(NATIVE, scope()), { ok: true });
    assert.equal(validatePhotoStoragePath(NATIVE.replace(".jpg", ".png"), scope()).ok, true);
    assert.equal(validatePhotoStoragePath(NATIVE.replace(".jpg", ".webp"), scope()).ok, true);
  });

  it("rejects another company, another project, another submission, another uploader", () => {
    assert.equal(validatePhotoStoragePath(NATIVE.replace("company-A", "company-B"), scope()).ok, false);
    assert.equal(validatePhotoStoragePath(NATIVE.replace("project-1", "project-2"), scope()).ok, false);
    assert.equal(validatePhotoStoragePath(NATIVE.replace("/sub-1/", "/sub-2/"), scope()).ok, false);
    assert.equal(validatePhotoStoragePath(NATIVE.replace("user-1", "user-2"), scope()).ok, false);
  });

  it("rejects the pre-Checkpoint-2 native family and the legacy web family when the uploader must be proven", () => {
    assert.equal(validatePhotoStoragePath(NATIVE_OLD, scope()).ok, false);
    assert.equal(validatePhotoStoragePath(WEB, scope()).ok, false);
  });

  it("rejects traversal, separators, unsafe characters, non-image extensions and a still-local sentinel", () => {
    for (const bad of [
      "",
      "../secrets",
      "company-A/project-1/user-1/sub-1/vehicle/f/../../../x.jpg",
      "company-A/project-1/user-1/sub-1/vehicle/f/photo.html",
      "company-A/project-1/user-1/sub-1/vehicle/f/photo",
      "company-A/project-1/user-1/sub-1/vehicle/f/.photo.jpg",
      "company-A/project-1/user-1/sub-1/vehicle/f/pho to.jpg",
      "local-photo://photo-1",
      "https://x.supabase.co/storage/v1/object/public/job-card-photos/company-A/project-1/user-1/sub-1/vehicle/f/photo-1.jpg",
    ]) {
      assert.equal(validatePhotoStoragePath(bad, scope()).ok, false, bad);
    }
  });
});

describe("validatePhotoStoragePath — send-email scope (any uploader in the submission, legacy web paths allowed)", () => {
  const emailScope = scope({ uploaderUserId: null, allowLegacyWebPhotoPaths: true });

  it("accepts the current native family for any uploader, the old native family, and the web family for this submission", () => {
    assert.equal(validatePhotoStoragePath(NATIVE, emailScope).ok, true);
    assert.equal(validatePhotoStoragePath(NATIVE.replace("user-1", "user-other"), emailScope).ok, true);
    assert.equal(validatePhotoStoragePath(NATIVE_OLD, emailScope).ok, true);
    assert.equal(validatePhotoStoragePath(WEB, emailScope).ok, true);
  });

  it("still rejects another submission, another project and another company in every family", () => {
    assert.equal(validatePhotoStoragePath(WEB.replace("sub-1", "sub-2"), emailScope).ok, false);
    assert.equal(validatePhotoStoragePath(NATIVE_OLD.replace("sub-1", "sub-2"), emailScope).ok, false);
    assert.equal(validatePhotoStoragePath(NATIVE.replace("project-1", "project-2"), emailScope).ok, false);
    assert.equal(validatePhotoStoragePath(NATIVE.replace("company-A", "company-B"), emailScope).ok, false);
  });
});

describe("validateProductFileReference", () => {
  const PRODUCT = "customer-sites/cust-1/product-files/ssc/ssc_config/project-1/u-1718000000000-config.json";
  const PPD = "customer-sites/cust-1/ppd-json/project-1/u-1718000000000-config.json";

  it("accepts product-file and ppd-json paths for this project in the customer-site-files bucket (bucket defaults when omitted)", () => {
    assert.equal(validateProductFileReference({ storageBucket: "customer-site-files", storagePath: PRODUCT }, scope()).ok, true);
    assert.equal(validateProductFileReference({ storageBucket: "", storagePath: PPD }, scope()).ok, true);
    assert.equal(validateProductFileReference({ storagePath: PRODUCT }, scope()).ok, true);
  });

  it("rejects any other bucket — the bucket is never taken from the client", () => {
    assert.equal(validateProductFileReference({ storageBucket: "job-card-photos", storagePath: PRODUCT }, scope()).ok, false);
    assert.equal(validateProductFileReference({ storageBucket: "private-backups", storagePath: PRODUCT }, scope()).ok, false);
  });

  it("rejects another project's file, an unrelated path in the bucket, traversal and an empty path", () => {
    assert.equal(validateProductFileReference({ storagePath: PRODUCT.replace("project-1", "project-9") }, scope()).ok, false);
    assert.equal(validateProductFileReference({ storagePath: PPD.replace("project-1", "project-9") }, scope()).ok, false);
    assert.equal(validateProductFileReference({ storagePath: "customer-sites/cust-1/site-docs/wifi.pdf" }, scope()).ok, false);
    assert.equal(validateProductFileReference({ storagePath: "customer-sites/../cust-1/product-files/a/b/project-1/x" }, scope()).ok, false);
    assert.equal(validateProductFileReference({ storagePath: "" }, scope()).ok, false);
  });
});

describe("validatePayloadStorageReferences — the whole payload", () => {
  const productFile = (storagePath: string, storageBucket = "customer-site-files") => ({
    fileKey: "ssc_config",
    productKey: "SSC",
    originalFileName: "c.json",
    storageBucket,
    storagePath,
    mimeType: "application/json",
    sizeBytes: 1,
    uploadedAt: "2026-06-01T00:00:00.000Z",
    displayLabel: "Config",
  });

  it("passes an empty payload and a fully in-scope one", () => {
    assert.deepEqual(validatePayloadStorageReferences({ photoUploads: [] }, scope()), { ok: true });
    const ok = validatePayloadStorageReferences(
      {
        photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: NATIVE, publicUrl: "", uploadedAt: "" }],
        productFiles: [productFile("customer-sites/c/product-files/ssc/ssc_config/project-1/u-1-c.json")],
      },
      scope(),
    );
    assert.deepEqual(ok, { ok: true });
  });

  it("fails on the first out-of-scope photo, product file, or ppd mirror", () => {
    assert.equal(
      validatePayloadStorageReferences({ photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: NATIVE.replace("company-A", "company-B"), publicUrl: "", uploadedAt: "" }] }, scope()).ok,
      false,
    );
    assert.equal(validatePayloadStorageReferences({ photoUploads: [], productFiles: [productFile("customer-sites/c/product-files/ssc/k/project-2/x.json")] }, scope()).ok, false);
    assert.equal(
      validatePayloadStorageReferences(
        { photoUploads: [], ppd: { jsonConfigFile: { fileName: "c.json", storagePath: "customer-sites/c/ppd-json/project-2/x.json", publicUrl: "", customerId: null, projectId: "project-2", companyId: "company-A", make: "", model: "", unitNumber: "", notes: "", uploadedAt: "" } } as never },
        scope(),
      ).ok,
      false,
    );
  });

  it("the ppd mirror's own companyId/projectId must match the scope when present", () => {
    const mirror = { fileName: "c.json", storagePath: "customer-sites/c/ppd-json/project-1/x.json", publicUrl: "", customerId: null, projectId: "project-1", companyId: "company-B", make: "", model: "", unitNumber: "", notes: "", uploadedAt: "" };
    assert.equal(validatePayloadStorageReferences({ photoUploads: [], ppd: { jsonConfigFile: mirror } as never }, scope()).ok, false);
    assert.equal(validatePayloadStorageReferences({ photoUploads: [], ppd: { jsonConfigFile: { ...mirror, companyId: "company-A" } } as never }, scope()).ok, true);
  });
});

describe("normalizePayloadStorageUrls — derived URLs are rebuilt server-side", () => {
  const url = "https://example.supabase.co/";

  it("photo publicUrl is always the public object URL for the validated path, whatever the client sent", () => {
    const out = normalizePayloadStorageUrls(
      { photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: NATIVE, publicUrl: "https://phish.example/x.jpg", uploadedAt: "" }] },
      url,
    );
    assert.equal(out.photoUploads[0].publicUrl, `https://example.supabase.co/storage/v1/object/public/job-card-photos/${NATIVE}`);
    assert.equal(buildPublicPhotoUrl(url, NATIVE), out.photoUploads[0].publicUrl);
  });

  it("a product file downloadUrl is kept only when it is a signed URL for its own path", () => {
    const path = "customer-sites/c/product-files/ssc/k/project-1/x.json";
    const base = { fileKey: "k", productKey: "ssc", originalFileName: "x.json", storageBucket: "customer-site-files", storagePath: path, mimeType: "application/json", sizeBytes: 1, uploadedAt: "", displayLabel: "X" };
    const kept = normalizePayloadStorageUrls({ photoUploads: [], productFiles: [{ ...base, downloadUrl: `https://example.supabase.co/storage/v1/object/sign/customer-site-files/${path}?token=abc` }] }, url);
    assert.ok(kept.productFiles?.[0].downloadUrl);
    const dropped = normalizePayloadStorageUrls({ photoUploads: [], productFiles: [{ ...base, downloadUrl: "https://phish.example/x" }] }, url);
    assert.equal(dropped.productFiles?.[0].downloadUrl, undefined);
    const other = normalizePayloadStorageUrls({ photoUploads: [], productFiles: [{ ...base, downloadUrl: `https://example.supabase.co/storage/v1/object/sign/customer-site-files/other/path.json?token=abc` }] }, url);
    assert.equal(other.productFiles?.[0].downloadUrl, undefined);
  });

  it("never touches text content", () => {
    const input = { photoUploads: [], coreJobInfo: { customer: "Jane" } } as never;
    const out = normalizePayloadStorageUrls(input, url) as { coreJobInfo: { customer: string } };
    assert.equal(out.coreJobInfo.customer, "Jane");
  });
});
