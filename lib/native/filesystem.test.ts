import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base64ToBlob, blobToBase64 } from "./filesystem.ts";

describe("lib/native/filesystem.ts blobToBase64 / base64ToBlob", () => {
  it("round-trips plain text through base64", async () => {
    const original = new Blob(["hello native filesystem"], { type: "text/plain" });
    const base64 = await blobToBase64(original);
    const restored = base64ToBlob(base64);
    assert.equal(await restored.text(), "hello native filesystem");
  });

  it("round-trips binary data byte-for-byte", async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 127, 128]);
    const original = new Blob([bytes]);
    const base64 = await blobToBase64(original);
    const restored = base64ToBlob(base64);
    const restoredBytes = new Uint8Array(await restored.arrayBuffer());
    assert.deepEqual(Array.from(restoredBytes), Array.from(bytes));
  });

  it("round-trips an empty blob", async () => {
    const base64 = await blobToBase64(new Blob([]));
    const restored = base64ToBlob(base64);
    assert.equal(restored.size, 0);
  });
});
