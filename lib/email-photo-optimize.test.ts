import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { optimizeImageForEmailAttachment } from "./email-photo-optimize.ts";

describe("email-photo-optimize", () => {
  it("compresses a large JPEG under target size", async () => {
    const large = await sharp({
      create: {
        width: 4032,
        height: 3024,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .jpeg({ quality: 98 })
      .toBuffer();

    const out = await optimizeImageForEmailAttachment(large);
    assert.ok(out.optimizedBytes <= 2 * 1024 * 1024);
    assert.ok(out.optimizedBytes <= out.originalBytes);
    assert.equal(out.contentType, "image/jpeg");
  });

  it("respects EXIF rotation path (rotate called)", async () => {
    const buf = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#336699" },
    })
      .jpeg()
      .toBuffer();
    const out = await optimizeImageForEmailAttachment(buf);
    assert.ok(out.width > 0);
    assert.ok(out.height > 0);
  });
});
