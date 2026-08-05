import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "./photo-fingerprint.ts";

describe("sha256Hex", () => {
  it("matches the well-known SHA-256 of an empty input", async () => {
    const hex = await sha256Hex(new ArrayBuffer(0));
    assert.equal(hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is deterministic for identical bytes", async () => {
    const bytes = new TextEncoder().encode("blaxtair camera label photo bytes").buffer;
    const a = await sha256Hex(bytes);
    const b = await sha256Hex(bytes);
    assert.equal(a, b);
  });

  it("differs for different content", async () => {
    const a = await sha256Hex(new TextEncoder().encode("photo A").buffer);
    const b = await sha256Hex(new TextEncoder().encode("photo B").buffer);
    assert.notEqual(a, b);
  });
});
