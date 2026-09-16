import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * NewSubmissionForm (components/NewSubmissionForm.tsx — relocated from app/page.tsx in Phase 1C,
 * see git history) is a giant "use client" component (offline-capable PWA — the browser writes to
 * Supabase directly, not via a Next.js server action). This repo has no test harness for
 * exercising a client component's runtime behavior (no jsdom/RTL, no precedent anywhere in the
 * existing test suite — see every other *.test.ts in this repo, which all test extracted lib/*
 * functions instead). These are therefore source-level guards, not behavioral tests: they pin the
 * exact call-site pattern the auto-publish handoff depends on, so a regression back to
 * fire-and-forget (or wiring the trigger into the draft path) fails CI instead of only being
 * caught by a human re-reading the diff.
 */
const pageSource = readFileSync(fileURLToPath(new URL("../../components/NewSubmissionForm.tsx", import.meta.url)), "utf8");

describe("NewSubmissionForm auto-publish wiring (source-level guard)", () => {
  it("awaits the internal auto-publish handoff — never fire-and-forgets it", () => {
    assert.match(pageSource, /await notifyZohoAutoPublish\(/, "the handoff call must be awaited");
    assert.doesNotMatch(
      pageSource,
      /void notifyZohoAutoPublish\(/,
      "the handoff must not be an un-awaited fire-and-forget call",
    );
  });

  it("awaits the handoff strictly after persistSubmittedJobCard has already resolved", () => {
    const persistCallIndex = pageSource.indexOf("await persistSubmittedJobCard(payload)");
    const notifyCallIndex = pageSource.indexOf("await notifyZohoAutoPublish(");
    assert.ok(persistCallIndex >= 0, "persistSubmittedJobCard call site not found");
    assert.ok(notifyCallIndex >= 0, "notifyZohoAutoPublish call site not found");
    assert.ok(
      persistCallIndex < notifyCallIndex,
      "the IS submission must be durably persisted before the auto-publish handoff is even attempted",
    );
  });

  it("the handoff request itself is bounded by a timeout rather than able to hang indefinitely", () => {
    assert.match(pageSource, /notifyZohoAutoPublish[\s\S]{0,600}AbortController/);
  });

  it("is wired into exactly one call site (handleFinalSubmit) — never into the draft save path", () => {
    const occurrences = pageSource.split("notifyZohoAutoPublish").length - 1;
    // Exactly 2: the function's own declaration, plus its single call site.
    assert.equal(occurrences, 2, `expected exactly 2 occurrences of notifyZohoAutoPublish, found ${occurrences}`);

    const draftFnStart = pageSource.indexOf("const handleSaveDraft = ");
    assert.ok(draftFnStart >= 0, "handleSaveDraft not found");
    // handleSaveDraftAndExit is defined after handleSaveDraft and wraps it — bounding the search
    // to the source between them covers handleSaveDraft's own body.
    const nextFnStart = pageSource.indexOf("const handleSaveDraftAndExit = ", draftFnStart);
    assert.ok(nextFnStart > draftFnStart, "handleSaveDraftAndExit not found after handleSaveDraft");
    const draftFnBody = pageSource.slice(draftFnStart, nextFnStart);
    assert.equal(
      draftFnBody.includes("notifyZohoAutoPublish"),
      false,
      "draft save must never trigger the Zoho auto-publish handoff",
    );
  });
});
