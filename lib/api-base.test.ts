import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiUrl } from "./api-base.ts";

function withApiOrigin(value: string | undefined, run: () => void): void {
  const original = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (value === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
  else process.env.NEXT_PUBLIC_API_ORIGIN = value;
  try {
    run();
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
    else process.env.NEXT_PUBLIC_API_ORIGIN = original;
  }
}

describe("apiUrl", () => {
  it("web build (NEXT_PUBLIC_API_ORIGIN unset): returns the path unchanged — same-origin", () => {
    withApiOrigin(undefined, () => {
      assert.equal(apiUrl("/api/x"), "/api/x");
    });
  });

  it("mobile build (NEXT_PUBLIC_API_ORIGIN set): prefixes the configured remote origin", () => {
    withApiOrigin("https://installer-job-card.vercel.app", () => {
      assert.equal(apiUrl("/api/x"), "https://installer-job-card.vercel.app/api/x");
    });
  });

  it("strips a trailing slash from the configured origin before concatenating", () => {
    withApiOrigin("https://installer-job-card.vercel.app/", () => {
      assert.equal(apiUrl("/api/x"), "https://installer-job-card.vercel.app/api/x");
    });
  });

  it("requires a leading slash on the path", () => {
    withApiOrigin(undefined, () => {
      assert.throws(() => apiUrl("api/x"));
    });
  });
});
