import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Phase 2H architecture fix — regression guard proving that native local-first
 * durability (LocalSubmission creation/autosave, LocalPhoto durability) is
 * gated on isNativeRuntime(), never on isOfflineAuthorized, so an ONLINE
 * native session gets the exact same durable-local-first behavior as an
 * OFFLINE-AUTHORIZED one. Before this fix, every one of these call sites was
 * gated on isOfflineAuthorized — true only while genuinely offline — meaning
 * a technician using the app while online never got Phase 2F/2G durability
 * during editing (see submission ff7c3f1e-8442-4d91-a71b-117ce03e6ca0, which
 * has zero local_photos rows and legacy timestamp-prefixed Storage paths).
 *
 * No React component test harness exists anywhere in this codebase (see
 * lib/local-submission-photo-boundary.test.ts's own doc), so — matching that
 * file's established approach — this inspects the REAL source rather than a
 * reimplementation.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_SUBMISSION_FORM_PATH = join(__dirname, "..", "components", "NewSubmissionForm.tsx");
const source = readFileSync(NEW_SUBMISSION_FORM_PATH, "utf8");

/** Brace-depth extraction — robust to nested object literals/ternaries inside the function body. */
function extractFunctionBody(src: string, signatureNeedle: string): string {
  const sigIdx = src.indexOf(signatureNeedle);
  assert.ok(sigIdx >= 0, `Could not find "${signatureNeedle}" in NewSubmissionForm.tsx — has it been renamed/moved? Update this test's needle.`);
  const braceStart = src.indexOf("{", sigIdx);
  assert.ok(braceStart >= 0, "Could not find the opening brace of the target function");
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting the function body — source may have changed shape");
}

/**
 * Same brace-depth technique, but anchored on distinctive text (typically a
 * doc comment) that precedes a `useEffect(() => { ... }, [...])` call, so
 * effect bodies (which have no unique "signature" of their own) can be
 * extracted just as reliably as named functions.
 */
function extractEffectBodyAfter(src: string, anchorText: string): string {
  const anchorIdx = src.indexOf(anchorText);
  assert.ok(anchorIdx >= 0, `Could not find anchor "${anchorText}" in NewSubmissionForm.tsx — update this test's anchor.`);
  const effectSigIdx = src.indexOf("useEffect(() => {", anchorIdx);
  assert.ok(effectSigIdx >= 0, `Could not find a "useEffect(() => {" after anchor "${anchorText}"`);
  const braceStart = effectSigIdx + "useEffect(() => ".length;
  assert.equal(src[braceStart], "{", "computed offset did not land on the effect callback's opening brace");
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting the effect body — source may have changed shape");
}

describe("Phase 2H — LocalSubmission creation/resume on mount is native-gated, not connectivity-gated", () => {
  const body = extractEffectBodyAfter(source, "Phase 2H — resolves the native resume gate on mount");

  it("sanity check: extracted the real mount-resolve effect body", () => {
    assert.ok(body.length > 200, "extracted body looks suspiciously short — extraction may have failed silently");
    assert.match(body, /findUnsubmittedLocalSubmissions/);
  });

  it("[test 1] native ONLINE new submission creates a LocalSubmission — the outer gate is isNativeRuntime(), not isOfflineAuthorized", () => {
    assert.match(body, /if\s*\(\s*!isNativeRuntime\(\)\s*\)\s*\{/);
    assert.ok(!body.includes("isOfflineAuthorized"), "this effect must never branch on connectivity — isNativeRuntime() alone decides whether a LocalSubmission is created/resumed");
  });

  it("[test 2] native OFFLINE-AUTHORIZED new submission creates a LocalSubmission via the exact SAME code path — no separate offline-only branch exists", () => {
    assert.match(body, /outcome\.kind === "none"/);
    const noneIdx = body.indexOf('outcome.kind === "none"');
    const createIdx = body.indexOf('persistLocalSubmissionNow("working")');
    assert.ok(createIdx > noneIdx, "the eager-create call must be inside the outcome.kind === 'none' branch");
    // Already proven isOfflineAuthorized-free above; re-asserted here as the specific
    // guarantee this test is named for — online and offline-authorized share one path.
    assert.ok(!body.includes("isOfflineAuthorized"));
  });
});

describe("Phase 2H — periodic autosave is native-gated, not connectivity-gated", () => {
  const body = extractEffectBodyAfter(source, "Phase 2F — the periodic safety-net writer for free-text edits");

  it("[test 3] native ONLINE edit autosaves the SAME LocalSubmission on a 1.5s interval — gated on isNativeRuntime(), not isOfflineAuthorized", () => {
    assert.match(body, /if\s*\(\s*!isNativeRuntime\(\)\s*\)\s*return;/);
    assert.ok(!body.includes("isOfflineAuthorized"));
    assert.match(body, /window\.setInterval/);
    assert.match(body, /persistLocalSubmissionNow\("working"\)/);
  });
});

describe("Phase 2H — the structural-event immediate flush is native-gated, not connectivity-gated", () => {
  const body = extractEffectBodyAfter(source, "Phase 2F — immediate durable write for structural/progression events");

  it("gated on isNativeRuntime(), not isOfflineAuthorized", () => {
    assert.match(body, /if\s*\(\s*!isNativeRuntime\(\)\s*\)\s*return;/);
    assert.ok(!body.includes("isOfflineAuthorized"));
    assert.match(body, /persistLocalSubmissionNow\("working"\)/);
  });
});

/**
 * Strips `//`-style line comments so prose mentioning a variable name
 * doesn't false-positive a "no reference" assertion. Matches up to (not
 * including) the next "\n" rather than using "." + "$" — this source file
 * has CRLF line endings, and "." never matches "\r" in a non-multiline
 * regex, which would otherwise leave a trailing "\r" that prevents "$" from
 * anchoring.
 */
function stripLineComments(body: string): string {
  return body.replace(/\/\/[^\n]*/g, "");
}

describe("Phase 2H — photo selection uses LocalPhoto durability natively, not by connectivity", () => {
  const body = extractFunctionBody(
    source,
    "const uploadPhotosToStorage = async (group: PhotoStorageGroup, fieldName: UploadFieldName, files: File[]) => {",
  );
  const nativeGateMatch = body.match(/if\s*\(\s*isNativeRuntime\(\)\s*\)\s*\{/);

  it("[test 4] native ONLINE selected photo uses LocalPhoto durability (savePhotoDurably) — gated on isNativeRuntime()", () => {
    assert.ok(nativeGateMatch, "expected an `if (isNativeRuntime()) {` branch guarding the durable-local photo save");
    const nativeGateIdx = nativeGateMatch!.index!;
    const savePhotoIdx = body.indexOf("savePhotoDurably(", nativeGateIdx);
    assert.ok(savePhotoIdx > nativeGateIdx, "savePhotoDurably must be called inside the isNativeRuntime() branch");
  });

  it("[test 5] native OFFLINE-AUTHORIZED selected photo uses the exact SAME LocalPhoto durability path — no separate offline-only branch", () => {
    assert.ok(
      !stripLineComments(body).includes("isOfflineAuthorized"),
      "uploadPhotosToStorage must never branch on connectivity in actual code — the same isNativeRuntime() branch serves both online and offline-authorized native sessions",
    );
  });

  it("[test 6] native ONLINE photo does NOT require the legacy immediate-upload path for durability — the native branch `continue`s before ever reaching the Supabase Storage upload code", () => {
    const nativeGateIdx = nativeGateMatch!.index!;
    const continueIdx = body.indexOf("continue;", nativeGateIdx);
    const legacyUploadIdx = body.indexOf("supabase.storage.from(PHOTO_BUCKET).upload(");
    assert.ok(continueIdx > nativeGateIdx, "the native branch must `continue` (skip the rest of the loop body) after a durable local save");
    assert.ok(legacyUploadIdx > continueIdx, "the legacy real-time Supabase Storage upload must be textually AFTER the native branch's `continue` — i.e. unreachable for native");
  });
});

describe("Phase 2H — web/PWA behavior is unchanged", () => {
  it("[test 12a] handleSaveDraft (the legacy Cloud Draft mechanism) is still disabled while isOffline || isOfflineAuthorized — untouched by this fix", () => {
    const body = extractFunctionBody(source, "const handleSaveDraft = async (): Promise<boolean> => {");
    assert.match(body, /if\s*\(\s*isOffline\s*\|\|\s*isOfflineAuthorized\s*\)\s*\{/);
  });

  it("[test 12b] the legacy real-time Supabase Storage photo upload branch still exists, reachable only for the web/PWA runtime (native always continues past it)", () => {
    const body = extractFunctionBody(
      source,
      "const uploadPhotosToStorage = async (group: PhotoStorageGroup, fieldName: UploadFieldName, files: File[]) => {",
    );
    assert.match(body, /supabase\.storage\.from\(PHOTO_BUCKET\)\.upload\(/);
    assert.match(body, /getPublicUrl\(objectPath\)/);
  });

  it("[test 12c] the 'Save Draft (online only)' button's disabled state still reflects isOffline || isOfflineAuthorized — untouched by this fix", () => {
    assert.match(source, /disabled=\{isOffline \|\| isOfflineAuthorized\}/);
  });
});
