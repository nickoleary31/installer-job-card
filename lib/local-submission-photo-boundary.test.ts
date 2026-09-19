import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Phase 2F — regression guard proving the actual production serialization
 * boundary (components/NewSubmissionForm.tsx's buildCurrentDraftData(), the
 * SAME function persistLocalSubmissionNow() feeds into local_submissions.payload
 * via buildAutosaveBaseRef) never references any of the known File[]-holding
 * photo-selection state variables. This inspects the REAL source file rather
 * than a reimplementation — see this file's own doc below for why a source
 * guard, not a rendered-component test, is the right tool here (no React
 * component test harness exists anywhere in this codebase).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_SUBMISSION_FORM_PATH = join(__dirname, "..", "components", "NewSubmissionForm.tsx");
const source = readFileSync(NEW_SUBMISSION_FORM_PATH, "utf8");

/** Brace-depth extraction — robust to nested object literals/ternaries inside the function body. */
function extractFunctionBody(src: string, signatureNeedle: string): string {
  const sigIdx = src.indexOf(signatureNeedle);
  assert.ok(sigIdx >= 0, `Could not find "${signatureNeedle}" in NewSubmissionForm.tsx — has it been renamed/moved? Update this test's needle.`);
  const braceStart = src.indexOf("{", sigIdx);
  assert.ok(braceStart >= 0, "Could not find the opening brace of buildCurrentDraftData");
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting buildCurrentDraftData's body — source may have changed shape");
}

// Every React state variable in NewSubmissionForm.tsx that ever holds actual
// File objects (local photo selections). None of these File[] arrays may
// ever be embedded whole inside buildCurrentDraftData's return value — see
// the "Photos — strict phase boundary" section of docs/Mobile_Development.md.
const FILE_ARRAY_STATE_VARIABLES = [
  "vehiclePictureFiles",
  "vacPhotoFiles",
  "ppdPhotoFiles",
  "cp4PhotoFiles",
  "linxupAtPhotoFiles",
  "linxupVtPhotoFiles",
  "linxupLcPhotoFiles",
] as const;

/**
 * ppdJsonLocalFile (a single File, not an array) is a narrower case: it's
 * legitimately referenced for its .name STRING (harmless filename metadata,
 * explicitly allowed), but must never be embedded as a bare object/value.
 * Every occurrence of the bare identifier inside the body must be
 * immediately followed by `.name` — anything else (a bare
 * `ppdJsonLocalFile,`/`: ppdJsonLocalFile` embedding the whole File object)
 * fails this check.
 */
function assertOnlyNameProjection(body: string, identifier: string) {
  const pattern = new RegExp(`${identifier}(\\?)?\\.(\\w+)`, "g");
  const bareOccurrences = body.split(identifier).length - 1;
  const projectedOccurrences = [...body.matchAll(pattern)].length;
  assert.equal(
    bareOccurrences,
    projectedOccurrences,
    `every reference to ${identifier} inside buildCurrentDraftData must be a property projection (e.g. .name), never the bare File object`,
  );
  const nameProjections = [...body.matchAll(pattern)].filter((m) => m[2] === "name");
  assert.ok(nameProjections.length > 0, `expected at least one ${identifier}.name projection (found none) — has this field been removed?`);
  const nonNameProjections = [...body.matchAll(pattern)].filter((m) => m[2] !== "name");
  assert.equal(
    nonNameProjections.length,
    0,
    `${identifier} must only ever be projected via .name (found: ${nonNameProjections.map((m) => m[0]).join(", ")})`,
  );
}

describe("Phase 2F — File/Blob exclusion at the actual production serialization boundary", () => {
  const body = extractFunctionBody(source, 'function buildCurrentDraftData(photoSnapshot: ReturnType<typeof getPhotoPersistenceSnapshot>): StoredJobCardDraft["data"] {');

  it("extracted a real, non-trivial function body (sanity check the extraction itself, not just its absence of forbidden names)", () => {
    assert.ok(body.length > 500, "buildCurrentDraftData's body looks suspiciously short — extraction may have failed silently");
    assert.match(body, /coreJob:\s*normalizedCoreJob/, "extracted body doesn't look like buildCurrentDraftData — sanity check failed");
  });

  for (const identifier of FILE_ARRAY_STATE_VARIABLES) {
    it(`buildCurrentDraftData's return value never references ${identifier} (a File[]-holding state variable)`, () => {
      assert.ok(
        !body.includes(identifier),
        `buildCurrentDraftData must never reference ${identifier} — actual photo/file bytes must never enter the ` +
          `local_submissions.payload SQLite JSON column (see docs/Mobile_Development.md's Phase 2F photo boundary)`,
      );
    });
  }

  it("ppdJsonLocalFile (a single File) is referenced only via its .name string — never embedded as the File object itself", () => {
    assertOnlyNameProjection(body, "ppdJsonLocalFile");
  });

  it("photoUploads/productFiles ARE present in the returned shape, but only as storage-path reference metadata", () => {
    // Confirms this is a deliberate inclusion of safe metadata, not an
    // accidental total absence of the photoUploads/productFiles fields.
    assert.match(body, /photoUploads:\s*photoSnapshot\.photoUploads/);
    assert.match(body, /productFiles:\s*\[/);
  });
});

describe("Phase 2F — the metadata types buildCurrentDraftData DOES include contain no File/Blob fields", () => {
  it("UploadedPhotoMetadata (lib/job-card-submission.ts) is plain string/metadata, never a File or Blob", () => {
    const jobCardSubmissionSource = readFileSync(join(__dirname, "job-card-submission.ts"), "utf8");
    const typeBody = extractFunctionBody(jobCardSubmissionSource, "export type UploadedPhotoMetadata = ");
    assert.ok(!/:\s*(File|Blob)\b/.test(typeBody), "UploadedPhotoMetadata must never declare a File/Blob-typed field");
  });

  it("UploadedProductFile (lib/product-files/types.ts) is plain string/metadata, never a File or Blob", () => {
    const productFilesTypesSource = readFileSync(join(__dirname, "product-files", "types.ts"), "utf8");
    const typeBody = extractFunctionBody(productFilesTypesSource, "export type UploadedProductFile = ");
    assert.ok(!/:\s*(File|Blob)\b/.test(typeBody), "UploadedProductFile must never declare a File/Blob-typed field");
  });
});

describe("Phase 2F — persistLocalSubmissionNow() feeds SQLite only via buildAutosaveBaseRef, never a separate photo-aware path", () => {
  it("persistLocalSubmissionNow reads its payload from buildAutosaveBaseRef.current().data — the same value buildCurrentDraftData produces, not a second interpretation", () => {
    const persistIdx = source.indexOf("const persistLocalSubmissionNow = async");
    assert.ok(persistIdx >= 0, "persistLocalSubmissionNow not found — has it been renamed/moved?");
    const body = extractFunctionBody(source, "const persistLocalSubmissionNow = async (status: LocalSubmissionStatus = \"working\"): Promise<void> => ");
    assert.match(body, /buildAutosaveBaseRef\.current\(\)/);
    assert.match(body, /payload:\s*base\.data/);
    for (const identifier of FILE_ARRAY_STATE_VARIABLES) {
      assert.ok(!body.includes(identifier), `persistLocalSubmissionNow must never directly reference ${identifier} either`);
    }
  });
});
