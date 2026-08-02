import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestCorrections } from "./corrections.ts";

describe("AT3 ambiguous-character suggestions", () => {
  it("suggests I→1 and E→6 for activation without auto-apply", () => {
    const suggestions = suggestCorrections({
      fieldKey: "activationCode",
      value: "EEI-RVY",
      validationOk: true,
    });
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.every((s) => s.autoApply === false));
    assert.ok(suggestions.some((s) => s.to === "EE1-RVY" || s.to.includes("1")));
    assert.ok(suggestions.some((s) => /E→6|I→1|Combined/i.test(s.reason)));
  });

  it("suggests E→6 for serial 68WE… without replacing OCR", () => {
    const suggestions = suggestCorrections({
      fieldKey: "serial",
      value: "68WE61200312",
      validationOk: true,
    });
    assert.ok(suggestions.some((s) => s.to === "68W661200312"));
    assert.ok(suggestions.every((s) => s.from === "68WE61200312"));
  });

  it("covers O/0 and S/5 pairs", () => {
    const suggestions = suggestCorrections({
      fieldKey: "activationCode",
      value: "GOS-81S",
      validationOk: true,
    });
    assert.ok(suggestions.some((s) => s.reason.includes("O→0") || s.to.includes("0")));
    assert.ok(suggestions.some((s) => s.reason.includes("S→5") || s.to.includes("5")));
  });
});
