import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatProofMarker } from "./persistence-proof.ts";

describe("lib/native/persistence-proof.ts formatProofMarker", () => {
  it("embeds an ISO timestamp with a stable prefix", () => {
    const marker = formatProofMarker(new Date("2026-01-02T03:04:05.000Z"));
    assert.equal(marker, "proof-2026-01-02T03:04:05.000Z");
  });

  it("produces distinct markers for distinct instants", () => {
    const a = formatProofMarker(new Date("2026-01-01T00:00:00.000Z"));
    const b = formatProofMarker(new Date("2026-01-01T00:00:00.001Z"));
    assert.notEqual(a, b);
  });
});
