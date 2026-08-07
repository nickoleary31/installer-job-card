import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VALIDATION_MODE, loadValidationMode, saveValidationMode } from "./blaxtair-validation-mode.ts";

describe("blaxtair validation mode (no-window fallback)", () => {
  it("defaults to qa_relaxed", () => {
    assert.equal(DEFAULT_VALIDATION_MODE, "qa_relaxed");
  });

  it("loadValidationMode falls back to the default outside a browser (no window)", () => {
    assert.equal(loadValidationMode(), DEFAULT_VALIDATION_MODE);
  });

  it("saveValidationMode is a safe no-op outside a browser (no window)", () => {
    const result = saveValidationMode("technician_strict");
    assert.equal(result.ok, true);
  });
});
